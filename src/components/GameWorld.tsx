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
import { BulletPool } from '../systems/projectile/BulletPool';
import { TerrainRenderer } from '../systems/terrain/TerrainRenderer';
import { CHARACTER_HEIGHT } from '../utils/constants';
import { ShootingSystemManager, LockonShootingSystem, FreeStyleShootingSystem } from '../systems/shooting';
import { useDialogue } from '../systems/dialogue/useDialogue';
import { characterPositionStore } from '../systems/character/CharacterPositionStore';

const MovementController = ({ getHeightAtRef, shootingManager, bulletPoolRef, sceneRef }: {
  getHeightAtRef: React.MutableRefObject<((x: number, z: number) => number) | null>;
  shootingManager: ShootingSystemManager | null;
  bulletPoolRef: React.MutableRefObject<BulletPool | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}) => {
  const { camera, gl, scene } = useThree();
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const isDebug = useGameStore(s => s.isDebug);
  const jumpForce = 7;
  const isMouseDownRef = useRef(false);

  useEffect(() => {
    sceneRef.current = scene;
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

    if (bulletPoolRef.current && sceneRef.current) {
      bulletPoolRef.current.update(delta, sceneRef.current);
    }
  });

  return null;
};

export const GameWorld = () => {
  const { gl, scene } = useThree();
  const gameStore = useGameStore();
  const setLockState = useGameStore(s => s.setLockState);
  const setActiveShootingSystem = useGameStore(s => s.setActiveShootingSystem);
  const activeShootingSystem = useGameStore(s => s.activeShootingSystem);
  const mode = useGameStore(s => s.mode);
  const isDebug = useGameStore(s => s.isDebug);
  const getHeightAtRef = useRef<((x: number, z: number) => number) | null>(null);
  const [shootingManager, setShootingManager] = useState<ShootingSystemManager | null>(null);
  const [shootDirection, setShootDirection] = useState<{ x: number; y: number; z: number } | null>(null);
  const bulletPoolRef = useRef<BulletPool | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const { triggerDialogue } = useDialogue();

  useEffect(() => {
    sceneRef.current = scene;
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
        setLockState(locking, countdown);
      },
      onTargetLocked: (target) => {
        console.log('Target locked:', target);
      },
      onShootDirectionChanged: (direction) => {
        setShootDirection(direction);
      },
      onBulletCreated: (bullet) => {
        if (bulletPoolRef.current && sceneRef.current) {
          const bulletMesh = bulletPoolRef.current.getBullet();
          if (bulletMesh) {
            const bulletPos = new THREE.Vector3(bullet.position.x, bullet.position.y, bullet.position.z);
            const bulletDir = new THREE.Vector3(bullet.direction.x, bullet.direction.y, bullet.direction.z);
            bulletPoolRef.current.setBulletProperties(
              bulletMesh.id,
              bulletPos,
              bulletDir,
              bullet.velocity,
              () => {}
            );
            if (!sceneRef.current.children.includes(bulletMesh.mesh)) {
              sceneRef.current.add(bulletMesh.mesh);
            }
          }
        }
      }
    });
    setShootingManager(manager);
    return () => {
      manager.dispose();
    };
  }, []);

  useEffect(() => {
    bulletPoolRef.current = new BulletPool();
    return () => {
      if (bulletPoolRef.current) {
        bulletPoolRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    if (mode === GameMode.DAILY) {
      setActiveShootingSystem('lockon');
      if (shootingManager) {
        shootingManager.setActiveSystem('lockon');
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
    } else {
      if (gameContainer?.requestPointerLock) {
        gameContainer.requestPointerLock();
      }
      if (gameContainer) {
        gameContainer.style.cursor = 'none';
      }
    }

    shootingManager.setActiveSystem(newSystem);
    setActiveShootingSystem(newSystem);
    console.log(`切换到${newSystem === 'lockon' ? '锁定式' : '自由式'}射击系统`);
  }, [shootingManager, activeShootingSystem, mode]);

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
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [switchShootingSystem]);

  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  const characterPos = gameStore.character.position;

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
      <PaperCharacter
        characterId="player"
        onClick={handleCharacterClick}
      />
      <MovementController
        getHeightAtRef={getHeightAtRef}
        shootingManager={shootingManager}
        bulletPoolRef={bulletPoolRef}
        sceneRef={sceneRef}
      />
    </>
  );
};

export default GameWorld;
