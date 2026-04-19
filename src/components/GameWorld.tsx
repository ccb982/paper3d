import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SceneSetup } from '../systems/rendering/SceneSetup';
import { PaperCharacter } from '../systems/character/PaperCharacter';
import { useKeyboard } from '../systems/input/useKeyboard';
import { calculateNewPosition } from '../systems/character/CharacterController';
import { useGameStore, GameMode } from '../systems/state/gameStore';
import { useRef, useEffect, useState, useCallback } from 'react';
import { MapRenderer } from '../systems/scene/MapRenderer';
import { applyGravityToCharacter } from '../systems/physics/GravitySystem';
import { TerrainRenderer } from '../systems/terrain/TerrainRenderer';
import { CHARACTER_HEIGHT } from '../utils/constants';
import { ShootingSystemManager, LockonShootingSystem, FreeStyleShootingSystem } from '../systems/shooting';
import { useDialogue } from '../systems/dialogue/useDialogue';
import { characterPositionStore } from '../systems/character/CharacterPositionStore';
import { EntityManager } from '../core/EntityManager';
import { CollisionManager } from '../core/CollisionManager';
import { cameraStore } from '../core/CameraStore';
import { EffectManager } from '../core/EffectManager';
import { BulletEntity } from '../entities/BulletEntity';
import { CharacterEntity } from '../entities/CharacterEntity';
import { StaticEntity } from '../entities/StaticEntity';
import { FriendlyEntity } from '../entities/FriendlyEntity';
import { EnemyEntity } from '../entities/EnemyEntity';
import { TargetEntity } from '../entities/TargetEntity';
import { playerCharacterManager } from '../systems/character/PlayerCharacterManager';

const MovementController = ({ getHeightAtRef, shootingManager, sceneRef }: {
  getHeightAtRef: React.MutableRefObject<((x: number, z: number) => number) | null>;
  shootingManager: ShootingSystemManager | null;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}) => {
  const { camera, gl, scene } = useThree();
  const mode = useGameStore(s => s.mode);
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const isDebug = useGameStore(s => s.isDebug);
  const jumpForce = 7;
  const isMouseDownRef = useRef(false);

  // 设置相机和渲染器引用到全局存储
  useEffect(() => {
    cameraStore.setCamera(camera);
    cameraStore.setRenderer(gl);
  }, [camera, gl]);

  useEffect(() => {
    sceneRef.current = scene;
    // 设置场景引用到 EntityManager，用于特效系统
    EntityManager.getInstance().setScene(scene);
  }, [scene, sceneRef]);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  const cameraParamsRef = useRef({
    yaw: 0,
    pitch: 0,
    radius: 10,
    targetRadius: 10,
    minRadius: 2,
    maxRadius: 20,
    sensitivity: 0.010,
    zoomSpeed: 0.03,
    smoothFactor: 0.1
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (getHeightAtRef.current) {
        const currentPos = characterPositionStore.getPositionCopy();
        const terrainHeight = getHeightAtRef.current(currentPos.x, currentPos.z);
        characterPositionStore.setPosition(currentPos.x, terrainHeight + 1.5 - 0.90 + CHARACTER_HEIGHT / 2, currentPos.z);
      }
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const gameContainer = document.querySelector('.game-container');

    const lockMouse = () => {
      const needsLock = shootingManager?.requiresPointerLock();
      if (needsLock !== true) {
        return;
      }
      if (gameContainer) {
        gameContainer.requestPointerLock = gameContainer.requestPointerLock || (gameContainer as any).mozRequestPointerLock;
        if (gameContainer.requestPointerLock) {
          gameContainer.requestPointerLock();
        }
      }
    };

    const handleMouseEnter = () => {
      lockMouse();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        isMouseDownRef.current = true;
        shootingManager?.onMouseDown(event);
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        isMouseDownRef.current = false;
        shootingManager?.onMouseUp(event);
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.movementX || (event as any).mozMovementX || (event as any).webkitMovementX || 0;
      const deltaY = event.movementY || (event as any).mozMovementY || (event as any).webkitMovementY || 0;

      const needsPointerLock = shootingManager?.requiresPointerLock() ?? true;
      const canRotate = needsPointerLock || isMouseDownRef.current;

      if (canRotate) {
        cameraParamsRef.current.yaw -= deltaX * cameraParamsRef.current.sensitivity;
        cameraParamsRef.current.pitch -= deltaY * cameraParamsRef.current.sensitivity;

        cameraParamsRef.current.yaw = cameraParamsRef.current.yaw % (2 * Math.PI);
        if (cameraParamsRef.current.yaw < 0) {
          cameraParamsRef.current.yaw += 2 * Math.PI;
        }

        cameraParamsRef.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraParamsRef.current.pitch));
      }
      shootingManager?.onMouseMove(event);
    };

    const handleWheel = (event: WheelEvent) => {
      cameraParamsRef.current.targetRadius -= event.deltaY * cameraParamsRef.current.zoomSpeed;
      cameraParamsRef.current.targetRadius = Math.max(cameraParamsRef.current.minRadius, Math.min(cameraParamsRef.current.maxRadius, cameraParamsRef.current.targetRadius));
    };

    if (gameContainer) {
      gameContainer.addEventListener('mouseenter', handleMouseEnter);
      gameContainer.addEventListener('mousedown', handleMouseDown);
    }
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('wheel', handleWheel);

    return () => {
      if (gameContainer) {
        gameContainer.removeEventListener('mouseenter', handleMouseEnter);
        gameContainer.removeEventListener('mousedown', handleMouseDown);
      }
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [shootingManager]);

  const raycastFromCamera = (): { point: THREE.Vector3; object: THREE.Object3D | null } | null => {
    if (!camera) return null;

    const raycaster = new THREE.Raycaster();
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    raycaster.set(camera.position, direction);

    const shootableObjects: THREE.Object3D[] = [];
    scene.traverse(obj => {
      if (obj.userData.isShootable && obj !== camera) {
        shootableObjects.push(obj);
      }
    });

    const intersects = raycaster.intersectObjects(shootableObjects, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      return { point: hit.point, object: hit.object };
    }

    const farPoint = camera.position.clone().add(direction.multiplyScalar(100));
    return { point: farPoint, object: null };
  };

  const debugHelpersRef = useRef<THREE.Object3D[]>([]);

  const clearDebugHelpers = () => {
    debugHelpersRef.current.forEach(helper => {
      if (scene.children.includes(helper)) {
        scene.remove(helper);
      }
    });
    debugHelpersRef.current = [];
  };

  const addDebugHelper = (obj: THREE.Object3D, duration = 100) => {
    scene.add(obj);
    debugHelpersRef.current.push(obj);
    setTimeout(() => {
      if (scene.children.includes(obj)) {
        scene.remove(obj);
      }
      const index = debugHelpersRef.current.indexOf(obj);
      if (index !== -1) {
        debugHelpersRef.current.splice(index, 1);
      }
    }, duration);
  };

  useFrame(({ camera }, delta) => {
    if (mode !== GameMode.BATTLE && mode !== GameMode.DAILY) {
      return;
    }

    const currentPos = characterPositionStore.position;
    let currentVelocity = characterPositionStore.velocity.clone();
    const currentDirection = directionRef.current;

    if (currentDirection.jump && currentVelocity.y === 0) {
      currentVelocity.y = jumpForce;
    }

    const horizontalPos = calculateNewPosition(
      { x: currentPos.x, z: currentPos.z },
      currentDirection,
      undefined,
      delta
    );

    const tempPos = new THREE.Vector3(horizontalPos.x, currentPos.y, horizontalPos.z);
    const { position: newPosWithGravity, velocity: newVelocity } = applyGravityToCharacter(
      tempPos,
      currentVelocity,
      delta,
      getHeightAtRef.current || undefined
    );

    const finalPos = new THREE.Vector3(horizontalPos.x, newPosWithGravity.y, horizontalPos.z);

    characterPositionStore.setPosition(finalPos.x, finalPos.y, finalPos.z);
    characterPositionStore.setVelocity(newVelocity.x, newVelocity.y, newVelocity.z);
    characterPositionStore.setMoving(currentDirection.x !== 0 || currentDirection.z !== 0);

    if (camera) {
      cameraParamsRef.current.radius += (cameraParamsRef.current.targetRadius - cameraParamsRef.current.radius) * cameraParamsRef.current.smoothFactor;

      const { yaw, pitch, radius } = cameraParamsRef.current;
      const offsetX = radius * Math.sin(yaw) * Math.cos(pitch);
      const offsetY = radius * Math.sin(pitch);
      const offsetZ = radius * Math.cos(yaw) * Math.cos(pitch);

      camera.position.set(
        finalPos.x + offsetX,
        finalPos.y + 3 + offsetY,
        finalPos.z + offsetZ
      );

      camera.lookAt(finalPos.x, finalPos.y + 2, finalPos.z);

      clearDebugHelpers();

      if (isDebug) {
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);

        const rayOrigin = camera.position.clone();
        const rayEnd = rayOrigin.clone().add(direction.multiplyScalar(10));

        const rayGeometry = new THREE.BufferGeometry().setFromPoints([rayOrigin, rayEnd]);
        const rayMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        const rayLine = new THREE.Line(rayGeometry, rayMaterial);
        addDebugHelper(rayLine, 100);

        const raycastResult = raycastFromCamera();
        if (raycastResult) {
          const hitMarkerGeometry = new THREE.SphereGeometry(0.2, 8, 8);
          const hitMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
          const hitMarker = new THREE.Mesh(hitMarkerGeometry, hitMarkerMaterial);
          hitMarker.position.copy(raycastResult.point);
          addDebugHelper(hitMarker, 200);
        }
      }
    }

    if (shootingManager && camera && scene) {
      shootingManager.setCamera(camera);
      shootingManager.setScene(scene);
      shootingManager.setCanvas(gl.domElement);
      shootingManager.setCharacterPosition(finalPos);

      const shootableObjs: THREE.Object3D[] = [];
      scene.traverse(obj => {
        if (obj.userData.isShootable) {
          shootableObjs.push(obj);
        }
      });
      const activeSystemName = shootingManager.getActiveSystemName();
      if (activeSystemName === 'lockon') {
        const lockonSystem = shootingManager.getActiveSystem();
        if (lockonSystem && 'setShootableObjects' in lockonSystem) {
          (lockonSystem as LockonShootingSystem).setShootableObjects(shootableObjs);
        }
      } else if (activeSystemName === 'freestyle') {
        const freestyleSystem = shootingManager.getActiveSystem();
        if (freestyleSystem && 'setShootableObjects' in freestyleSystem) {
          (freestyleSystem as any).setShootableObjects(shootableObjs);
        }
      }

      shootingManager.update(delta);
    }

    // 更新当前操控角色的相机引用
    const currentChar = playerCharacterManager.getCurrentCharacter();
    if (currentChar && 'setCamera' in currentChar) {
      (currentChar as FriendlyEntity).setCamera(camera);
    }

    EntityManager.getInstance().update(delta);
    
    // 检测碰撞
    CollisionManager.getInstance().update();
    
    // 更新特效
    EffectManager.getInstance().update(delta);
  });

  return null;
};

interface GameWorldProps {
  onLockStateChanged: (isLocking: boolean, lockCountdown: number) => void;
  onActiveSystemChanged: (system: string) => void;
}

export const GameWorld = ({ onLockStateChanged, onActiveSystemChanged }: GameWorldProps) => {
  const { gl, scene, camera } = useThree();
  const mode = useGameStore(s => s.mode);
  const [activeShootingSystem, setActiveShootingSystem] = useState('freestyle');
  const [isLocking, setIsLocking] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const isDebug = useGameStore(s => s.isDebug);
  const getHeightAtRef = useRef<((x: number, z: number) => number) | null>(null);
  const [shootingManager, setShootingManager] = useState<ShootingSystemManager | null>(null);
  const [shootDirection, setShootDirection] = useState<{ x: number; y: number; z: number } | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const { triggerDialogue } = useDialogue();

  useEffect(() => {
    sceneRef.current = scene;
    const entityManager = EntityManager.getInstance();
    entityManager.setScene(scene);
    
    // 清理现有实体
    entityManager.clear();
    
    // 创建玩家实体
    const playerEntity = new FriendlyEntity(
      'player',
      '/textures/character.png',
      new THREE.Vector3(0, 5, 0)
    );
    entityManager.addEntity(playerEntity);
    
    // 注册当前操控角色到管理器
    playerCharacterManager.setCurrentCharacter(playerEntity);
    
    // 初始化碰撞管理器
    const collisionManager = CollisionManager.getInstance();
    
    // 注册子弹 vs 角色（敌人）碰撞
    collisionManager.registerCollision('bullet', 'character', (bullet, character) => {
      const bulletEntity = bullet as BulletEntity;
      const characterEntity = character as CharacterEntity;
      // 直接检查目标是否为敌人阵营，而不是使用 isEnemy 方法
      if (characterEntity.faction === 'enemy') {
        // 如果当前不是战斗模式，自动切换到战斗模式
        const currentMode = useGameStore.getState().mode;
        if (currentMode !== GameMode.BATTLE) {
          useGameStore.getState().setMode(GameMode.BATTLE);
        }
        // 播放命中特效
        EffectManager.getInstance().playHitFlash(bulletEntity.position);
        EffectManager.getInstance().playRingWave(characterEntity.position, 0xff4444);
        characterEntity.takeDamage(bulletEntity.getDamage() ?? 1);
        bulletEntity.isActive = false;
      }
    });
    
    // 注册子弹 vs 静态物品（靶子）碰撞
    collisionManager.registerCollision('bullet', 'static', (bullet, staticObj) => {
      const staticEntity = staticObj as StaticEntity;
      if (staticEntity.isShootable) {
        // 播放命中特效
        EffectManager.getInstance().playHitFlash(bullet.position);
        EffectManager.getInstance().playRingWave(staticEntity.position, 0x44ff44);
        staticEntity.takeDamage(1);
        bullet.isActive = false;
      }
    });
    
    // 角色 vs 敌人碰撞（玩家与敌人相撞扣血 - 仅在战斗模式下）
    collisionManager.registerCollision('character', 'character', (a, b) => {
      const mode = useGameStore.getState().mode;
      if (mode !== GameMode.BATTLE) return;
      
      const charA = a as CharacterEntity;
      const charB = b as CharacterEntity;
      if (charA.isEnemy(charB)) {
        // 敌人碰撞玩家：玩家扣血，敌人反弹或停止移动
        if (charA.isPlayerControlled) charA.takeDamage(10);
        if (charB.isPlayerControlled) charB.takeDamage(10);
      }
    });
    
    // 创建敌人实体
    for (let i = 0; i < 3; i++) {
      const enemyEntity = new EnemyEntity(
        `enemy-${i}`,
        '/textures/character.png', // 暂时使用相同的纹理
        new THREE.Vector3(
          Math.random() * 20 - 10,
          5,
          Math.random() * 20 - 10
        )
      );
      entityManager.addEntity(enemyEntity);
    }
    
    // 创建靶子实体
    for (let i = 0; i < 5; i++) {
      const targetEntity = new TargetEntity(
        `target-${i}`,
        new THREE.Vector3(
          Math.random() * 30 - 15,
          5,
          Math.random() * 30 - 15
        )
      );
      entityManager.addEntity(targetEntity);
    }
    
    console.log('Entities created:', entityManager.getEntityCount());
  }, [scene, sceneRef]);

  useEffect(() => {
    const manager = new ShootingSystemManager();
    const lockonSystem = new LockonShootingSystem();
    const freestyleSystem = new FreeStyleShootingSystem();
    manager.registerSystem('lockon', lockonSystem);
    manager.registerSystem('freestyle', freestyleSystem);
    manager.setActiveSystem('freestyle');
    manager.setCallbacks({
      onLockStateChanged: (locking, countdown) => {
        setIsLocking(locking);
        setLockCountdown(countdown);
        onLockStateChanged(locking, countdown);
      },
      onTargetLocked: (target) => {
        console.log('Target locked:', target);
      },
      onShootDirectionChanged: (direction) => {
        setShootDirection(direction);
      },
      onBulletCreated: (bullet) => {
        console.log('Bullet created:', bullet);
        try {
          // 播放枪口闪光特效
          EffectManager.getInstance().playMuzzleFlash(new THREE.Vector3(bullet.position.x, bullet.position.y, bullet.position.z));
          
          const bulletEntity = new BulletEntity(
            new THREE.Vector3(bullet.position.x, bullet.position.y, bullet.position.z),
            new THREE.Vector3(bullet.direction.x, bullet.direction.y, bullet.direction.z),
            bullet.velocity,
            0xffaa00
          );
          EntityManager.getInstance().addEntity(bulletEntity);
          console.log('BulletEntity added to EntityManager');
        } catch (error) {
          console.error('Error creating bullet entity:', error);
        }
      },
      onActiveSystemChanged: (system) => {
        setActiveShootingSystem(system);
        onActiveSystemChanged(system);
      }
    });
    setShootingManager(manager);
    return () => {
      manager.dispose();
    };
  }, []);

  useEffect(() => {
    if (mode === GameMode.DAILY) {
      setActiveShootingSystem('lockon');
      if (shootingManager) {
        shootingManager.setActiveSystem('lockon');
        onActiveSystemChanged('lockon');
      }
    } else if (mode !== GameMode.BATTLE) {
      // 在非战斗和非日常模式下，重置射击系统状态
      setActiveShootingSystem('lockon');
      if (shootingManager) {
        shootingManager.setActiveSystem('lockon');
        onActiveSystemChanged('lockon');
      }
    }
  }, [mode, shootingManager, onActiveSystemChanged]);

  useEffect(() => {
    if (shootingManager) {
      const shouldActivateShooting = mode === GameMode.BATTLE || mode === GameMode.DAILY;
      const activeSystem = shootingManager.getActiveSystem();
      if (activeSystem && 'setActive' in activeSystem) {
        activeSystem.setActive(shouldActivateShooting);
        console.log(`Shooting system ${shouldActivateShooting ? 'activated' : 'deactivated'} for mode: ${mode}`);
      }
    }
  }, [mode, shootingManager]);

  useEffect(() => {
    const gameContainer = document.querySelector('.game-container');
    const needsPointerLock = (mode === GameMode.BATTLE && activeShootingSystem === 'freestyle');

    if (needsPointerLock) {
      if (gameContainer) {
        gameContainer.style.cursor = 'none';
        gameContainer.requestPointerLock = gameContainer.requestPointerLock || (gameContainer as any).mozRequestPointerLock;
        if (gameContainer.requestPointerLock) {
          gameContainer.requestPointerLock();
        }
      }
    } else {
      document.exitPointerLock && document.exitPointerLock();
      if (gameContainer) {
        gameContainer.style.cursor = 'default';
      }
    }
  }, [mode, activeShootingSystem]);

  const switchShootingSystem = useCallback(() => {
    if (!shootingManager) return;
    if (mode === GameMode.DAILY) {
      console.log('日常模式下只能使用锁定射击');
      return;
    }
    const currentSystem = activeShootingSystem;
    const newSystem = currentSystem === 'lockon' ? 'freestyle' : 'lockon';

    const gameContainer = document.querySelector('.game-container');

    if (newSystem === 'lockon') {
      document.exitPointerLock && document.exitPointerLock();
      if (gameContainer) {
        gameContainer.style.cursor = 'default';
      }
    } else if (mode === GameMode.BATTLE) {
      if (gameContainer?.requestPointerLock) {
        gameContainer.requestPointerLock();
      }
      if (gameContainer) {
        gameContainer.style.cursor = 'none';
      }
    }

    shootingManager.setActiveSystem(newSystem);
    setActiveShootingSystem(newSystem);
    onActiveSystemChanged(newSystem);
    console.log(`切换到${newSystem === 'lockon' ? '锁定式' : '自由式'}射击系统`);
  }, [shootingManager, activeShootingSystem, mode, onActiveSystemChanged]);

  // 处理角色点击事件
  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  // 射线检测函数
  const raycastFromMouse = (event: MouseEvent): THREE.Object3D | null => {
    if (!camera || !sceneRef.current || !gl) return null;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // 计算鼠标在屏幕上的位置（归一化设备坐标）
    const rect = gl.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // 更新射线投射器
    raycaster.setFromCamera(mouse, camera);

    // 获取所有可点击的角色
    const characterObjects: THREE.Object3D[] = [];
    sceneRef.current.traverse(obj => {
      if (obj.userData.isCharacter) {
        characterObjects.push(obj);
      }
    });

    // 检测射线与角色的交集
    const intersects = raycaster.intersectObjects(characterObjects, true);

    if (intersects.length > 0) {
      return intersects[0].object;
    }

    return null;
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        switchShootingSystem();
      }
      if (event.key === 'Escape') {
        document.exitPointerLock = document.exitPointerLock || (document as any).mozExitPointerLock;
        if (document.exitPointerLock) {
          document.exitPointerLock();
        }
      }
    };

    const handleMouseClick = (event: MouseEvent) => {
      // 只处理左键点击
      if (event.button !== 0) return;

      const clickedObject = raycastFromMouse(event);
      if (clickedObject && clickedObject.userData.isCharacter) {
        const characterId = clickedObject.userData.characterId;
        handleCharacterClick(characterId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleMouseClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleMouseClick);
    };
  }, [switchShootingSystem, camera, gl]);

  const characterPos = characterPositionStore.getPositionCopy();

  return (
    <>
      <SceneSetup
        rayData={isDebug && activeShootingSystem === 'lockon' ? shootingManager?.getRayData() : []}
        shootDirection={isDebug && activeShootingSystem === 'lockon' ? shootDirection : null}
        characterPosition={characterPos}
      />
      <MapRenderer getHeightAt={getHeightAtRef.current || undefined} />
      <TerrainRenderer
        params={{
          width: 100,
          depth: 100,
          segments: 32,
          seed: 12345,
          heightScale: 8,
          noiseScale: 0.01,
          octaves: 4
        }}
        characterPosition={characterPos}
        onTerrainReady={(getHeightAt) => {
          getHeightAtRef.current = getHeightAt;
        }}
      />
      <PaperCharacter characterId="player" onClick={handleCharacterClick} />
      <MovementController
        getHeightAtRef={getHeightAtRef}
        shootingManager={shootingManager}
        sceneRef={sceneRef}
      />
    </>
  );
};

export default GameWorld;
