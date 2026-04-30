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
import { BulletEntity } from '../entities/bullets/BulletEntity';
import { DawnExplosionBulletEntity } from '../entities/bullets/DawnExplosionBulletEntity';
import { CharacterEntity } from '../entities/characters/CharacterEntity';
import { StaticEntity } from '../entities/static/StaticEntity';
import { FriendlyEntity } from '../entities/characters/FriendlyEntity';
import { EnemyEntity } from '../entities/characters/EnemyEntity';
import { StoneBugEnemy } from '../entities/characters/StoneBugEnemy';
import { TargetEntity } from '../entities/static/TargetEntity';
import { Box } from '../entities/static/Box';
import { playerCharacterManager } from '../systems/character/PlayerCharacterManager';
import { createBulletTrailTexture, createBulletTrailGeometry, createBulletTrailMaterial } from '../systems/textures/BulletTrailTexture';
import { TextureManager } from '../systems/textures/TextureManager';
import { TestBulletTrailTexture } from '../systems/textures/TestRedBlueTexture';
import { WaterEntity } from '../entities/water/WaterEntity';


const MovementController = ({ getHeightAtRef, shootingManager, sceneRef, setActiveShootingSystem, onActiveSystemChanged }: {
  getHeightAtRef: React.MutableRefObject<((x: number, z: number) => number) | null>;
  shootingManager: ShootingSystemManager | null;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  setActiveShootingSystem: (system: string) => void;
  onActiveSystemChanged: (system: string) => void;
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
    cameraStore.setCamera(camera as THREE.PerspectiveCamera);
    cameraStore.setRenderer(gl);
  }, [camera, gl]);

  useEffect(() => {
    if (scene) {
      sceneRef.current = scene;
      // 设置场景引用到 EntityManager，用于特效系统
      EntityManager.getInstance().setScene(scene);
      // 将场景引用存储到window对象，供ParticleFireEffect使用
      (window as any).gameScene = scene;
      // 将cameraStore引用存储到window对象，供ParticleFireEffect使用
      (window as any).cameraStore = cameraStore;
      // 将EntityManager引用存储到window对象，供UI使用
      (window as any).entityManager = EntityManager.getInstance();
    }
  }, [scene]);

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
    
    // 更新特效管理器
    EffectManager.getInstance().update(delta);

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
    
    // 更新玩家实体的位置
    playerCharacterManager.updateCurrentCharacterPosition(finalPos.x, finalPos.y, finalPos.z);

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
    
    // 同步玩家实体位置到characterPositionStore
    const playerChar = playerCharacterManager.getCurrentCharacter();
    if (playerChar) {
      characterPositionStore.setPosition(playerChar.position.x, playerChar.position.y, playerChar.position.z);
      
      // 检测周围敌人，自动切换模式
      const entities = EntityManager.getInstance().getAllEntities();
      const playerPos = playerChar.position;
      const enemyDetectionRadius = 50; // 敌人检测半径
      let hasEnemyNearby = false;
      
      for (const entity of entities) {
        if (entity.type === 'character' && 'faction' in entity && entity.faction === 'enemy') {
          const distance = playerPos.distanceTo(entity.position);
          if (distance <= enemyDetectionRadius) {
            hasEnemyNearby = true;
            break;
          }
        }
      }
      
      // 根据敌人检测结果切换模式
      const currentMode = useGameStore.getState().mode;
      if (hasEnemyNearby && currentMode !== GameMode.BATTLE) {
        // 有敌人，进入战斗模式并切换到自由射击
        useGameStore.getState().startBattle();
        if (shootingManager) {
          shootingManager.setActiveSystem('freestyle');
          setActiveShootingSystem('freestyle');
          onActiveSystemChanged('freestyle');
          console.log('检测到敌人，自动进入战斗模式和自由射击');
        }
      } else if (!hasEnemyNearby && currentMode === GameMode.BATTLE) {
        // 没有敌人，返回日常模式
        useGameStore.getState().setMode(GameMode.DAILY);
        if (shootingManager) {
          shootingManager.setActiveSystem('lockon');
          setActiveShootingSystem('lockon');
          onActiveSystemChanged('lockon');
          console.log('敌人已离开，自动返回日常模式和锁定射击');
        }
      }

    }
    
    // 更新特效
    EffectManager.getInstance().update(delta);
    
    // 更新所有纹理（包括测试纹理的流动效果）
    TextureManager.getInstance().updateAll(delta);
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

  const isDebug = useGameStore(s => s.isDebug);
  const getHeightAtRef = useRef<((x: number, z: number) => number) | null>(null);
  const [shootingManager, setShootingManager] = useState<ShootingSystemManager | null>(null);
  const [shootDirection, setShootDirection] = useState<{ x: number; y: number; z: number } | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const { triggerDialogue } = useDialogue();
  const [terrainReady, setTerrainReady] = useState(false);

  useEffect(() => {
    // 只在组件挂载时执行一次
    const entityManager = EntityManager.getInstance();
    
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
        // 调用子弹的onHit方法，触发范围伤害
        if (typeof (bulletEntity as any).onHit === 'function') {
          (bulletEntity as any).onHit(characterEntity);
        }
        bulletEntity.isActive = false;
      }
    });
    
    // 注册子弹 vs 静态物品（靶子）碰撞
    collisionManager.registerCollision('bullet', 'static', (bullet, staticObj) => {
      const bulletEntity = bullet as BulletEntity;
      const staticEntity = staticObj as StaticEntity;
      if (staticEntity.isShootable) {
        // 调用子弹的onHit方法，触发范围伤害
        if (typeof (bulletEntity as any).onHit === 'function') {
          (bulletEntity as any).onHit(staticEntity);
        }
        bulletEntity.isActive = false;
      }
    });
    
    // 注册角色 vs 静态物品碰撞
    collisionManager.registerCollision('character', 'static', (character, staticObj) => {
      const charEntity = character as CharacterEntity;
      const staticEntity = staticObj as StaticEntity;
      
      // 计算碰撞深度
      const distance = charEntity.position.distanceTo(staticEntity.position);
      const collisionDepth = charEntity.radius + staticEntity.radius - distance;
      
      if (collisionDepth > 0) {
        // 计算碰撞方向
        const direction = new THREE.Vector3()
          .subVectors(charEntity.position, staticEntity.position)
          .normalize();
        
        // 推开角色（静态物品不动）
        charEntity.position.add(direction.multiplyScalar(collisionDepth));
        
        // 更新网格位置
        charEntity.mesh.position.copy(charEntity.position);
      }
    });
    
    // 角色 vs 角色碰撞
    collisionManager.registerCollision('character', 'character', (a, b) => {
      const charA = a as CharacterEntity;
      const charB = b as CharacterEntity;
      
      // 计算碰撞深度
      const distance = charA.position.distanceTo(charB.position);
      const collisionDepth = charA.radius + charB.radius - distance;
      
      if (collisionDepth > 0) {
        // 计算碰撞方向
        const direction = new THREE.Vector3()
          .subVectors(charA.position, charB.position)
          .normalize();
        
        let pushDistanceA = collisionDepth / 2;
        let pushDistanceB = collisionDepth / 2;
        
        // 增强敌人对玩家的推动效果
        if (charA.isEnemy(charB)) {
          if (charA.isPlayerControlled) {
            // 敌人推玩家：玩家被推开更多
            pushDistanceA = collisionDepth * 0.7;
            pushDistanceB = collisionDepth * 0.3;
          } else if (charB.isPlayerControlled) {
            // 敌人推玩家：玩家被推开更多
            pushDistanceA = collisionDepth * 0.3;
            pushDistanceB = collisionDepth * 0.7;
          }
        }
        
        // 推开两个角色
        charA.position.add(direction.multiplyScalar(pushDistanceA));
        charB.position.sub(direction.multiplyScalar(pushDistanceB));
        
        // 更新网格位置
        charA.mesh.position.copy(charA.position);
        charB.mesh.position.copy(charB.position);
        
        // 战斗模式下，敌人和玩家碰撞扣血
        const mode = useGameStore.getState().mode;
        if (mode === GameMode.BATTLE && charA.isEnemy(charB)) {
          if (charA.isPlayerControlled) charA.takeDamage(10);
          if (charB.isPlayerControlled) charB.takeDamage(10);
        }
      }
    });
    
    // 创建敌人实体 - 远离玩家
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 30 + Math.random() * 20;
      const enemyEntity = new EnemyEntity(
        `enemy-${i}`,
        '/textures/character.png',
        new THREE.Vector3(
          Math.cos(angle) * distance,
          5 - 1.5 + 2,
          Math.sin(angle) * distance
        )
      );
      entityManager.addEntity(enemyEntity);
    }
    
    // 创建原石虫敌人 - 远离玩家
    for (let i = 0; i < 2; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 30;
      const stoneBugEnemy = new StoneBugEnemy(
        `stone-bug-${i}`,
        new THREE.Vector3(
          Math.cos(angle) * distance,
          5 - 1.5,
          Math.sin(angle) * distance
        )
      );
      entityManager.addEntity(stoneBugEnemy);
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
    
    // 创建箱子实体
    for (let i = 0; i < 3; i++) {
      const boxEntity = new Box(
        `box-${i}`,
        new THREE.Vector3(
          Math.random() * 30 - 15,
          0.5, // 箱子底部与地面平齐
          Math.random() * 30 - 15
        ),
        new THREE.Vector3(1, 1, 1) // 箱子尺寸
      );
      entityManager.addEntity(boxEntity);
    }

    // 在地图上创建一个持续时间无限的火焰特效
    // 先清理所有旧的粒子火焰特效，避免重复创建
    EffectManager.getInstance().clearAllParticleFireEffects();
    const firePosition = new THREE.Vector3(0, 3 - 1.5, 10); // 下调1.5
    EffectManager.getInstance().playParticleFireEffect(firePosition, Infinity);
    console.log('Infinite fire effect created at:', firePosition);

    // 创建子弹流体特效（基于物理模拟）
    const fluidPosition = new THREE.Vector3(5, 5, 0); // 抬高到空中
    EffectManager.getInstance().playBulletFluidEffect(fluidPosition, 60, 8); // 60秒持续时间，8单位大小
    console.log('Bullet fluid effect created at:', fluidPosition);

    // 在地面上创建一个三角形流体特效
    const trianglePosition = new THREE.Vector3(0, 8, 0); // 抬高到空中
    EffectManager.getInstance().playTriangleFluidEffect(trianglePosition, 60, 12); // 60秒持续时间，12单位大小
    console.log('Triangle fluid effect created at:', trianglePosition);

    // 创建测试纹理
    const textureManager = TextureManager.getInstance();
    const testTexture = new TestBulletTrailTexture();
    textureManager.register('test-bullet-trail', testTexture);
    
    // 在出生点附近创建一个平面来显示测试纹理
    const testPlaneGeometry = new THREE.PlaneGeometry(2, 2);
    const testPlaneMaterial = new THREE.MeshBasicMaterial({
      map: textureManager.getTexture('test-bullet-trail'),
      side: THREE.DoubleSide
    });
    const testPlane = new THREE.Mesh(testPlaneGeometry, testPlaneMaterial);
    testPlane.position.set(0, 3, 5); // 出生点附近
    testPlane.rotation.x = -Math.PI / 2; // 水平放置
    if (sceneRef.current) {
      sceneRef.current.add(testPlane);
    }
    console.log('Test bullet trail texture created and displayed at (0, 3, 5)');

    console.log('Entities created:', entityManager.getEntityCount());
  }, []);

  // 根据地形高度创建水面实体
  useEffect(() => {
    if (!terrainReady || !getHeightAtRef.current) {
      return;
    }

    const entityManager = EntityManager.getInstance();
    const getHeightAt = getHeightAtRef.current;

    // 使用洪水填充算法找到合适的河流生成位置
    const findRiverPosition = () => {
      const waterThreshold = 0.3; // 水面高度阈值
      const width = 100;
      const depth = 100;
      const gridSize = 32; // 网格大小
      const cellSize = width / gridSize;

      // 初始化网格
      const grid: boolean[][] = [];
      for (let i = 0; i < gridSize; i++) {
        grid[i] = [];
        for (let j = 0; j < gridSize; j++) {
          const x = (j / gridSize - 0.5) * width;
          const z = (i / gridSize - 0.5) * depth;
          const height = getHeightAt(x, z);
          grid[i][j] = height < waterThreshold;
        }
      }

      // 洪水填充算法找到最大的连续区域
      const visited: boolean[][] = [];
      for (let i = 0; i < gridSize; i++) {
        visited[i] = new Array(gridSize).fill(false);
      }

      let maxArea = 0;
      let bestRegion: { x: number; z: number; width: number; height: number } | null = null;

      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          if (grid[i][j] && !visited[i][j]) {
            // 洪水填充
            const stack = [{ i, j }];
            visited[i][j] = true;
            let area = 0;
            let minX = j, maxX = j, minY = i, maxY = i;

            while (stack.length > 0) {
              const { i: ci, j: cj } = stack.pop()!;
              area++;
              minX = Math.min(minX, cj);
              maxX = Math.max(maxX, cj);
              minY = Math.min(minY, ci);
              maxY = Math.max(maxY, ci);

              // 四个方向
              const directions = [
                { di: -1, dj: 0 },
                { di: 1, dj: 0 },
                { di: 0, dj: -1 },
                { di: 0, dj: 1 }
              ];

              for (const dir of directions) {
                const ni = ci + dir.di;
                const nj = cj + dir.dj;
                if (ni >= 0 && ni < gridSize && nj >= 0 && nj < gridSize && grid[ni][nj] && !visited[ni][nj]) {
                  visited[ni][nj] = true;
                  stack.push({ i: ni, j: nj });
                }
              }
            }

            if (area > maxArea) {
              maxArea = area;
              const regionWidth = (maxX - minX + 1) * cellSize;
              const regionHeight = (maxY - minY + 1) * cellSize;
              const centerX = ((minX + maxX) / 2 / gridSize - 0.5) * width;
              const centerZ = ((minY + maxY) / 2 / gridSize - 0.5) * depth;
              
              bestRegion = {
                x: centerX,
                z: centerZ,
                width: regionWidth,
                height: regionHeight
              };
            }
          }
        }
      }

      return bestRegion;
    };

    // 找到最佳河流位置
    const riverPosition = findRiverPosition();
    if (riverPosition) {
      const waterHeight = 0.3 + Math.random() * 0.3; // 随机水面高度 0.3-0.6
      
      // 生成河流
      const riverEntity = new WaterEntity(
        new THREE.Vector3(riverPosition.x, waterHeight, riverPosition.z), // 中心位置
        Math.max(riverPosition.width, 40), // 宽度
        Math.max(riverPosition.height, 10), // 高度
        256, // 分辨率
        64 // 网格分段数
      );
      entityManager.addEntity(riverEntity);
      console.log('River created at:', riverPosition, 'size:', riverPosition.width, 'x', riverPosition.height);
    }
  }, [terrainReady]);

  // 处理场景引用和子弹尾气创建
  const bulletTrailMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const bulletTrailCreatedRef = useRef(false);
  
  useEffect(() => {
    if (!scene || bulletTrailCreatedRef.current) {
      return;
    }
    
    bulletTrailCreatedRef.current = true;
    sceneRef.current = scene;
    EntityManager.getInstance().setScene(scene);
    
    const textureManager = new TextureManager();
    createBulletTrailTexture(textureManager);
    const bulletTrailTexture = textureManager.getTexture('bullet-trail');
    
    const bulletTrailGeometry = createBulletTrailGeometry();
    
    const bulletTrailMaterial = createBulletTrailMaterial(bulletTrailTexture);
    bulletTrailMaterialRef.current = bulletTrailMaterial;
    
    const bulletTrailMesh = new THREE.Mesh(bulletTrailGeometry, bulletTrailMaterial);
    bulletTrailMesh.position.set(8, 2, 0); // 向右移动3个单位
    bulletTrailMesh.scale.set(0.8, 2, 1); // 调整大小使尾气变瘦
    scene.add(bulletTrailMesh);
    console.log('Bullet trail created at:', bulletTrailMesh.position);
  }, []);

  useFrame(({ clock }) => {
    if (bulletTrailMaterialRef.current) {
      bulletTrailMaterialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  useEffect(() => {
    const manager = new ShootingSystemManager();
    const lockonSystem = new LockonShootingSystem();
    const freestyleSystem = new FreeStyleShootingSystem();
    manager.registerSystem('lockon', lockonSystem);
    manager.registerSystem('freestyle', freestyleSystem);
    manager.setActiveSystem('freestyle');
    manager.setCallbacks({
      onLockStateChanged: (locking, countdown) => {

        onLockStateChanged(locking, countdown);
      },
      onTargetLocked: (target) => {
        // console.log('Target locked:', target);
      },
      onShootDirectionChanged: (direction) => {
        setShootDirection(direction);
      },
      onBulletCreated: (bullet) => {
        console.log('Bullet created:', bullet);
        try {
          // 播放枪口闪光特效
          EffectManager.getInstance().playMuzzleFlash(new THREE.Vector3(bullet.position.x, bullet.position.y, bullet.position.z));
          
          const bulletEntity = new DawnExplosionBulletEntity(
            new THREE.Vector3(bullet.position.x, bullet.position.y, bullet.position.z),
            new THREE.Vector3(bullet.direction.x, bullet.direction.y, bullet.direction.z),
            bullet.velocity, // 使用bullet对象中的速度值
            0xfd4d74 // 子弹颜色：#fd4d74
          );
          EntityManager.getInstance().addEntity(bulletEntity);
          console.log('BulletEntity added to EntityManager');
        } catch (error) {
          console.error('Error creating bullet entity:', error);
        }
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
      }
    } else if (mode !== GameMode.BATTLE) {
      setActiveShootingSystem('lockon');
      if (shootingManager) {
        shootingManager.setActiveSystem('lockon');
      }
    }
  }, [mode, shootingManager]);

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
      // 按F键在当前角色位置创建火焰特效
      if (event.key === 'F') {
        const currentPos = characterPositionStore.getPositionCopy();
        EffectManager.getInstance().playParticleFireEffect(new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z));
        console.log('Particle fire effect created at:', currentPos);
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

          // 为所有角色设置地形高度获取函数
          const entityManager = EntityManager.getInstance();
          const characters = entityManager.getEntitiesByType('character');
          characters.forEach(character => {
            if (character instanceof CharacterEntity) {
              (character as CharacterEntity).setHeightAtFunction(getHeightAt);
            }
          });

          // 标记地形已准备好
          setTerrainReady(true);
        }}
      />
      <PaperCharacter characterId="player" onClick={handleCharacterClick} />
      <MovementController
        getHeightAtRef={getHeightAtRef}
        shootingManager={shootingManager}
        sceneRef={sceneRef}
        setActiveShootingSystem={setActiveShootingSystem}
        onActiveSystemChanged={onActiveSystemChanged}
      />
    </>
  );
};

export default GameWorld;
