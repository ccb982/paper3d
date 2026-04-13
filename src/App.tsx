import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneSetup } from './systems/rendering/SceneSetup';
import { PaperCharacter } from './systems/character/PaperCharacter';
import { useKeyboard } from './systems/input/useKeyboard';
import { calculateNewPosition } from './systems/character/CharacterController';
import { useGameStore } from './systems/state/gameStore';
import './styles/global.css';
import { useRef, useEffect, useState } from 'react';
import DialogBubble from './components/UI/DialogBubble';
import StatusPanel from './components/UI/StatusPanel';
import LoadingIndicator from './components/UI/LoadingIndicator';
import Crosshair from './components/UI/Crosshair';
import Bullet from './systems/projectile/Bullet';
import { useDialogue } from './systems/dialogue/useDialogue';
import { MapRenderer } from './systems/scene/MapRenderer';
import { applyGravityToCharacter } from './systems/physics/GravitySystem';
import { OrbitControls } from '@react-three/drei';

function App() {
  const { triggerDialogue } = useDialogue();

  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  const gameStore = useGameStore();
  const characterPos = gameStore.character.position;

  return (
    <div className="game-container">
      <Canvas camera={{ position: [0, 2, 10] }}>
        <SceneSetup />
        <MapRenderer />
        <PaperCharacter 
          characterId="player" 
          onClick={handleCharacterClick} 
        />
        <OrbitControls 
          target={[characterPos.x, characterPos.y + 1, characterPos.z]} 
          enableZoom={true} 
          enablePan={false} 
          zoomSpeed={1.0} 
          rotateSpeed={1.0} 
        />
        <MovementController />
      </Canvas>
      <StatusPanel />
      <DialogBubble />
      <LoadingIndicator />
      <Crosshair />
    </div>
  );
}

// 移动控制器组件
const MovementController = () => {
  const { camera, gl, scene } = useThree();
  const canvas = gl.domElement;
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7; // 跳跃力量
  const mousePosRef = useRef({ x: 0, y: 0 }); // 鼠标位置引用
  const [bullets, setBullets] = useState<Array<{ id: number; position: { x: number; y: number; z: number }; direction: THREE.Vector3 }>>([]);
  const [lockedTarget, setLockedTarget] = useState<{ point: THREE.Vector3; object: THREE.Object3D } | null>(null);
  const bulletIdRef = useRef(0);
  const bulletVelocity = 50; // 子弹速度（增加速度）
  const isMouseDownRef = useRef(false); // 鼠标按下状态
  const lastFireTimeRef = useRef(0); // 上次发射时间
  const fireRate = 200; // 发射间隔（毫秒）
  const targetDetectedRef = useRef<THREE.Object3D | null>(null); // 检测到的目标
  const autoShootIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shootableObjectsRef = useRef<THREE.Object3D[]>([]);

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoShootIntervalRef.current) clearInterval(autoShootIntervalRef.current);
    };
  }, []);

  // 初始化可射击物体数组
  useEffect(() => {
    const objects: THREE.Object3D[] = [];
    scene.traverse(obj => {
      if (obj.userData.isShootable) objects.push(obj);
    });
    shootableObjectsRef.current = objects;
  }, [scene]);

  // 鼠标事件处理
  useEffect(() => {
    // 自动射击函数
    const startAutoShoot = () => {
      if (autoShootIntervalRef.current) return;
      autoShootIntervalRef.current = setInterval(() => {
        // 每次射击前重新检测当前锁定的目标（确保目标还存在）
        if (lockedTarget && isMouseDownRef.current) {
          // 计算子弹方向：从角色位置指向锁定目标的击中点（或目标中心）
          const realTimeCharacterPos = gameStore.character.position;
          const direction = new THREE.Vector3().subVectors(
            lockedTarget.point,
            new THREE.Vector3(realTimeCharacterPos.x, realTimeCharacterPos.y + 1.2, realTimeCharacterPos.z)
          ).normalize();
          // 创建子弹
          const newBullet = {
            id: bulletIdRef.current++,
            position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z },
            direction,
          };
          setBullets(prev => [...prev, newBullet]);
        } else {
          // 没有目标，停止射击
          stopAutoShoot();
        }
      }, fireRate);
    };

    const stopAutoShoot = () => {
      if (autoShootIntervalRef.current) {
        clearInterval(autoShootIntervalRef.current);
        autoShootIntervalRef.current = null;
      }
    };

    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      targetDetectedRef.current = null; // 重置目标检测
      // 开启自动射击模式
      if (lockedTarget) {
        startAutoShoot();
      }
    };
    
    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      targetDetectedRef.current = null; // 松开鼠标时销毁检测器
      stopAutoShoot();
    };
    
    const handleMouseMove = (event: MouseEvent) => {
      mousePosRef.current = { x: event.clientX, y: event.clientY };
    };
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      if (autoShootIntervalRef.current) clearInterval(autoShootIntervalRef.current);
    };
  }, [lockedTarget, gameStore, fireRate]); // 依赖项

  // 实时计算子弹方向（纯函数，每次调用都用最新参数）
  const getBulletDirection = (
    camera: THREE.Camera,
    characterPos: { x: number; y: number; z: number },
    mouseX: number,
    mouseY: number,
    canvasElement: HTMLCanvasElement  // 传入 canvas 元素
  ): THREE.Vector3 => {
    // 1. 获取 canvas 相对坐标
    const rect = canvasElement.getBoundingClientRect();
    const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;

    // 2. 创建射线
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    
    // 3. 子弹发射点（角色胸部高度）
    const bulletOriginY = characterPos.y + 1.2;
    const bulletOrigin = new THREE.Vector3(characterPos.x, bulletOriginY, characterPos.z);

    // 4. 定义水平面（Y = bulletOriginY）
    const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), bulletOriginY);
    const targetPoint = new THREE.Vector3();

    // 5. 计算射线与水平面的交点
    if (raycaster.ray.intersectPlane(horizontalPlane, targetPoint)) {
      // 交点存在，从角色发射点指向交点
      return targetPoint.clone().sub(bulletOrigin).normalize();
    } else {
      // 射线与水平面平行（罕见，如相机完全水平且鼠标指向水平方向）
      // 此时直接使用射线方向，并强制 Y 分量为 0（水平射击）
      const dir = raycaster.ray.direction.clone().normalize();
      dir.y = 0;
      dir.normalize();
      return dir;
    }
  };

  // 每帧更新角色位置
  useFrame(({ camera }, delta) => {
    const currentPos = gameStore.character.position;
    let currentVelocity = gameStore.character.velocity;
    const currentDirection = directionRef.current;
    
    // 检查是否按下跳跃键且角色在地面上
    if (currentDirection.jump && currentVelocity.y === 0) {
      // 应用跳跃力量
      currentVelocity = {
        ...currentVelocity,
        y: jumpForce
      };
    }
    
    // 应用重力
    const { position: newPosWithGravity, velocity: newVelocity } = applyGravityToCharacter(
      currentPos,
      currentVelocity,
      delta
    );
    
    // 计算水平新位置
    const horizontalPos = calculateNewPosition(
      { x: newPosWithGravity.x, z: newPosWithGravity.z },
      currentDirection,
      undefined,
      delta
    );
    
    // 合并位置和速度更新
    const finalPos = {
      x: horizontalPos.x,
      y: newPosWithGravity.y,
      z: horizontalPos.z
    };
    
    // 更新角色位置和速度
    gameStore.setCharacterPosition(finalPos);
    gameStore.setCharacterVelocity(newVelocity);
    
    // 更新角色移动状态
    gameStore.setCharacterMoving(currentDirection.x !== 0 || currentDirection.z !== 0);
    
    // 射线检测可射击目标
    if (camera) {
      const raycaster = new THREE.Raycaster();
      // 使用鼠标位置
      const rect = canvas.getBoundingClientRect();
      const mouseX = ((mousePosRef.current.x - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((mousePosRef.current.y - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
      
      // 使用预收集的可射击物体数组
      const intersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
      
      // 临时变量，用于存储新的锁定目标
      let newLockedTarget: { point: THREE.Vector3; object: THREE.Object3D } | null = null;
      
      if (intersects.length > 0) {
        const hit = intersects[0];
        newLockedTarget = { point: hit.point, object: hit.object };
        
        // 调试：给锁定的目标添加发光效果
        if (hit.object instanceof THREE.Mesh) {
          // 保存原始材质
          if (!hit.object.userData.originalMaterial) {
            hit.object.userData.originalMaterial = hit.object.material;
          }
          // 创建发光材质
          const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.7 
          });
          hit.object.material = glowMaterial;
        }
      }
      
      // 如果之前有锁定目标，现在没有了，恢复原始材质
      if (lockedTarget && !newLockedTarget) {
        if (lockedTarget.object instanceof THREE.Mesh && lockedTarget.object.userData.originalMaterial) {
          lockedTarget.object.material = lockedTarget.object.userData.originalMaterial;
        }
      }
      
      // 如果锁定目标改变，恢复之前目标的材质
      if (lockedTarget && newLockedTarget && lockedTarget.object !== newLockedTarget.object) {
        if (lockedTarget.object instanceof THREE.Mesh && lockedTarget.object.userData.originalMaterial) {
          lockedTarget.object.material = lockedTarget.object.userData.originalMaterial;
        }
      }
      
      setLockedTarget(newLockedTarget);
    }
    
    // 目标检测
    if (isMouseDownRef.current && camera) {
      // 获取 canvas 相对坐标
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((mousePosRef.current.x - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((mousePosRef.current.y - rect.top) / rect.height) * 2 + 1;

      // 创建射线
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      // 检测鼠标是否指向了目标（敌人）
      const scene = camera.parent;
      if (scene) {
        // 递归遍历所有子物体，确保检测到所有目标
        const allObjects: THREE.Object3D[] = [];
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            allObjects.push(object);
          }
        });
        
        // 检测射线与所有物体的交点
        const intersects = raycaster.intersectObjects(allObjects, false);
        
        let targetFound = false;
        for (const intersect of intersects) {
          // 检查当前物体或其父物体是否是目标
          let currentObject: THREE.Object3D | null = intersect.object;
          while (currentObject) {
            if (currentObject.userData.isTarget) {
              // 鼠标指向了目标，设置目标检测
              targetDetectedRef.current = currentObject;
              targetFound = true;
              break;
            }
            currentObject = currentObject.parent;
          }
          if (targetFound) break;
        }
        
        if (!targetFound) {
          // 没有检测到目标，重置
          targetDetectedRef.current = null;
        }
      }
    }
    
    // 传统开火检测（当没有锁定目标时使用）
    if (isMouseDownRef.current && camera && !lockedTarget) {
      const now = Date.now();
      if (now - lastFireTimeRef.current >= fireRate) {
        lastFireTimeRef.current = now;
        
        // 实时获取最新值
        const realTimeCharacterPos = gameStore.character.position;
        let direction: THREE.Vector3;
        
        // 如果检测到目标，自动瞄准目标
        if (targetDetectedRef.current) {
          // 计算从角色到目标的方向
          const bulletOriginY = realTimeCharacterPos.y + 1.2;
          const bulletOrigin = new THREE.Vector3(realTimeCharacterPos.x, bulletOriginY, realTimeCharacterPos.z);
          
          // 获取目标的世界位置
          const targetPosition = new THREE.Vector3();
          targetDetectedRef.current.getWorldPosition(targetPosition);
          
          // 计算方向向量，考虑目标的高度
          const directionVector = new THREE.Vector3(
            targetPosition.x - bulletOrigin.x,
            targetPosition.y - bulletOrigin.y, // 考虑目标的高度
            targetPosition.z - bulletOrigin.z
          );
          direction = directionVector.normalize();
        } else {
          // 否则使用正常的子弹方向计算
          direction = getBulletDirection(camera, realTimeCharacterPos, mousePosRef.current.x, mousePosRef.current.y, canvas);
        }
        
        const newBullet = {
          id: bulletIdRef.current++,
          position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z }, // 增加发射高度，确保子弹能够接触到准心
          direction,
        };
        setBullets(prev => [...prev, newBullet]);
      }
    }
    
    // 更新子弹位置
    setBullets(prev => prev.filter(bullet => {
      bullet.position.x += bullet.direction.x * bulletVelocity * delta;
      bullet.position.y += bullet.direction.y * bulletVelocity * delta;
      bullet.position.z += bullet.direction.z * bulletVelocity * delta;
      // 超出边界后移除
      return Math.abs(bullet.position.x) < 100 && Math.abs(bullet.position.z) < 100 && bullet.position.y < 50;
    }));
  });

  // 处理子弹过期
  const handleBulletExpire = (id: number) => {
    setBullets(prev => prev.filter(bullet => bullet.id !== id));
  };

  return (
    <>
      {bullets.map(bullet => (
        <Bullet
          key={bullet.id}
          position={bullet.position}
          direction={bullet.direction}
          velocity={bulletVelocity}
          onExpire={() => handleBulletExpire(bullet.id)}
        />
      ))}
    </>
  );
};

export default App;