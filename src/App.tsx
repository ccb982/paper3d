import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneSetup } from './systems/rendering/SceneSetup';
import { PaperCharacter } from './systems/character/PaperCharacter';
import { useKeyboard } from './systems/input/useKeyboard';
import { calculateNewPosition } from './systems/character/CharacterController';
import { useGameStore, GameMode } from './systems/state/gameStore';
import { MenuPage, DailyPage, BattleHUD, ShopPage, GachaPage, SettingPage } from './ui/pages';
import './styles/global.css';
import { useRef, useEffect, useState, useCallback } from 'react';
import DialogBubble from './components/UI/DialogBubble';
import StatusPanel from './components/UI/StatusPanel';
import LoadingIndicator from './components/UI/LoadingIndicator';
import Crosshair from './components/UI/Crosshair';

import { useDialogue } from './systems/dialogue/useDialogue';
import { MapRenderer } from './systems/scene/MapRenderer';
import { applyGravityToCharacter } from './systems/physics/GravitySystem';
import { BulletPool } from './systems/projectile/BulletPool';
import { TerrainRenderer } from './systems/terrain/TerrainRenderer';
import { CHARACTER_HEIGHT } from './utils/constants';
import { ShootingSystemManager, LockonShootingSystem, FreeStyleShootingSystem } from './systems/shooting';

function App() {
  const { triggerDialogue } = useDialogue();
  const mode = useGameStore(s => s.mode);
  const getHeightAtRef = useRef<((x: number, z: number) => number) | null>(null);
  const [activeShootingSystem, setActiveShootingSystem] = useState<string>('freestyle');
  const [shootingManager, setShootingManager] = useState<ShootingSystemManager | null>(null);
  // 日常模式下强制使用锁定射击
  useEffect(() => {
    if (mode === GameMode.DAILY) {
      setActiveShootingSystem('lockon');
      if (shootingManager) {
        shootingManager.setActiveSystem('lockon');
      }
    }
  }, [mode, shootingManager]);
  const [isLocking, setIsLocking] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [shootDirection, setShootDirection] = useState<{ x: number; y: number; z: number } | null>(null);
  const bulletPoolRef = useRef<BulletPool | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  const switchShootingSystem = useCallback(() => {
    if (!shootingManager) return;
    // 日常模式下禁用自由射击
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
    console.log(`shootingManager requiresPointerLock: ${shootingManager.requiresPointerLock()}`);
  }, [shootingManager, activeShootingSystem, mode]);

  useEffect(() => {
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.style.cursor = 'none';
    }
  }, []);

  useEffect(() => {
    const manager = new ShootingSystemManager();
    const lockonSystem = new LockonShootingSystem();
    const freestyleSystem = new FreeStyleShootingSystem();
    manager.registerSystem('lockon', lockonSystem);
    manager.registerSystem('freestyle', freestyleSystem);
    manager.setActiveSystem('freestyle');
    manager.setCallbacks({
      onLockStateChanged: (locking: boolean, countdown: number) => {
        setIsLocking(locking);
        setLockCountdown(countdown);
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

  const gameStore = useGameStore();
  const characterPos = gameStore.character.position;
  const [terrainHeight, setTerrainHeight] = useState(0);

  useEffect(() => {
    if (getHeightAtRef.current) {
      const height = getHeightAtRef.current(characterPos.x, characterPos.z);
      setTerrainHeight(height);
    }
  }, [characterPos.x, characterPos.z]);

  return (
    <div className="game-container">
      {mode === GameMode.MENU && <MenuPage />}
      {mode === GameMode.DAILY && <DailyPage />}
      {mode === GameMode.BATTLE && <BattleHUD />}
      {mode === GameMode.SHOP && <ShopPage />}
      {mode === GameMode.GACHA && <GachaPage />}
      {mode === GameMode.SETTING && <SettingPage />}

      {(mode === GameMode.BATTLE || mode === GameMode.DAILY) && (
        <>
          {mode === GameMode.BATTLE && (
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '10px',
              borderRadius: '5px',
              fontSize: '12px',
              zIndex: 1000
            }}>
              <div>角色 Y: {characterPos.y.toFixed(2)}</div>
              <div>地形 Y: {terrainHeight.toFixed(2)}</div>
              <div>角色脚 Y: {(characterPos.y - CHARACTER_HEIGHT / 2).toFixed(2)}</div>
              <div>期望脚 Y: {(terrainHeight + 1.5 - 0.75).toFixed(2)}</div>
              <div>射击系统: {activeShootingSystem === 'lockon' ? '锁定式' : '自由式'}</div>
              <button onClick={switchShootingSystem} style={{ marginTop: '5px', padding: '5px 10px' }}>
                切换射击系统 (Tab)
              </button>
            </div>
          )}
          <Canvas camera={{ position: [0, 2, 10] }} shadows>
        <SceneSetup
          rayData={activeShootingSystem === 'lockon' ? shootingManager?.getRayData() : []}
          shootDirection={activeShootingSystem === 'lockon' ? shootDirection : null}
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
        <MovementController getHeightAtRef={getHeightAtRef} shootingManager={shootingManager} bulletPoolRef={bulletPoolRef} sceneRef={sceneRef} />
      </Canvas>
        </>
      )}
      {(mode === GameMode.BATTLE || mode === GameMode.DAILY) && (
        <>
          {mode === GameMode.BATTLE && <div className="freestyle-crosshair" style={{ display: activeShootingSystem === 'freestyle' ? 'block' : 'none' }}></div>}
          <Crosshair
            isLockMode={mode === GameMode.DAILY || activeShootingSystem === 'lockon'}
            isLocking={isLocking}
            lockCountdown={lockCountdown}
          />
          <StatusPanel />
          <LoadingIndicator />
        </>
      )}
      <DialogBubble />
    </div>
  );
}

const MovementController = ({ getHeightAtRef, shootingManager, bulletPoolRef, sceneRef }: {
  getHeightAtRef: React.MutableRefObject<((x: number, z: number) => number) | null>;
  shootingManager: ShootingSystemManager | null;
  bulletPoolRef: React.MutableRefObject<BulletPool | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}) => {
  const { camera, gl, scene } = useThree();
  const canvas = gl.domElement;
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7;
  const bulletVelocity = 50;
  const isMouseDownRef = useRef(false);
  const lastFireTimeRef = useRef(0);
  const fireRate = 200;

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene, sceneRef]);

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
        const currentPos = gameStore.character.position;
        const terrainHeight = getHeightAtRef.current(currentPos.x, currentPos.z);
        gameStore.setCharacterPosition({ x: currentPos.x, y: terrainHeight + 1.5 - 0.90 + CHARACTER_HEIGHT / 2, z: currentPos.z });
      }
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    const gameContainer = document.querySelector('.game-container');

    const lockMouse = () => {
      const needsLock = shootingManager?.requiresPointerLock();
      console.log(`lockMouse called, requiresPointerLock: ${needsLock}`);
      if (needsLock !== true) {
        console.log('lockMouse skipped - pointer lock not needed');
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
  
  const calculateBulletDirection = (characterPos: { x: number; y: number; z: number }): THREE.Vector3 => {
    const raycastResult = raycastFromCamera();
    if (!raycastResult) return new THREE.Vector3(0, 0, 1);
    
    const bulletOrigin = new THREE.Vector3(characterPos.x, characterPos.y + 1.5, characterPos.z);
    const direction = raycastResult.point.clone().sub(bulletOrigin).normalize();
    
    return direction;
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
    const currentPos = gameStore.character.position;
    let currentVelocity = gameStore.character.velocity;
    const currentDirection = directionRef.current;
    
    if (currentDirection.jump && currentVelocity.y === 0) {
      currentVelocity = {
        ...currentVelocity,
        y: jumpForce
      };
    }
    
    const horizontalPos = calculateNewPosition(
      { x: currentPos.x, z: currentPos.z },
      currentDirection,
      undefined,
      delta
    );
    
    const tempPos = { x: horizontalPos.x, y: currentPos.y, z: horizontalPos.z };
    const { position: newPosWithGravity, velocity: newVelocity } = applyGravityToCharacter(
      tempPos,
      currentVelocity,
      delta,
      getHeightAtRef.current || undefined
    );
    
    const finalPos = {
      x: horizontalPos.x,
      y: newPosWithGravity.y,
      z: horizontalPos.z
    };
    
    gameStore.setCharacterPosition(finalPos);
    gameStore.setCharacterVelocity(newVelocity);
    
    gameStore.setCharacterMoving(currentDirection.x !== 0 || currentDirection.z !== 0);
    
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
      
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      
      const rayOrigin = camera.position.clone();
      const rayEnd = rayOrigin.clone().add(direction.multiplyScalar(10));
      
      const rayGeometry = new THREE.BufferGeometry().setFromPoints([rayOrigin, rayEnd]);
      const rayMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
      const rayLine = new THREE.Line(rayGeometry, rayMaterial);
      addDebugHelper(rayLine, 100);
      
      const raycastResult = raycastFromCamera();
      // 隐藏红点调试标记
      /*
      if (raycastResult) {
        const hitMarkerGeometry = new THREE.SphereGeometry(0.2, 8, 8);
        const hitMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const hitMarker = new THREE.Mesh(hitMarkerGeometry, hitMarkerMaterial);
        hitMarker.position.copy(raycastResult.point);
        addDebugHelper(hitMarker, 200);
      }
      */
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

export default App;