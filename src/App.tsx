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
<<<<<<< HEAD
import RayVisualizer from './components/debug/RayVisualizer';
import ShootDirectionVisualizer from './components/debug/ShootDirectionVisualizer';
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e

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
<<<<<<< HEAD
  const cameraRef = useRef(camera);
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7; // 跳跃力量
  const mousePosRef = useRef({ x: 0, y: 0 }); // 鼠标位置引用
  const [bullets, setBullets] = useState<Array<{ id: number; position: { x: number; y: number; z: number }; direction: THREE.Vector3 }>>([]);
  const [lockedTarget, setLockedTarget] = useState<{ point: THREE.Vector3; object: THREE.Object3D } | null>(null);
<<<<<<< HEAD
  const [rayOrigin, setRayOrigin] = useState(new THREE.Vector3());
  const [rayDirection, setRayDirection] = useState(new THREE.Vector3(0, 0, -1));
  const [shootDirection, setShootDirection] = useState(new THREE.Vector3(0, 0, -1));
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
  const bulletIdRef = useRef(0);
  const bulletVelocity = 50; // 子弹速度（增加速度）
  const isMouseDownRef = useRef(false); // 鼠标按下状态
  const lastFireTimeRef = useRef(0); // 上次发射时间
  const fireRate = 200; // 发射间隔（毫秒）
  const targetDetectedRef = useRef<THREE.Object3D | null>(null); // 检测到的目标
<<<<<<< HEAD
  const shootableObjectsRef = useRef<THREE.Object3D[]>([]);
  const lockedTargetRef = useRef(lockedTarget); // 实时锁定目标引用
=======
  const autoShootIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shootableObjectsRef = useRef<THREE.Object3D[]>([]);
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

<<<<<<< HEAD
  // 同步锁定目标到ref，避免闭包问题
  useEffect(() => {
    lockedTargetRef.current = lockedTarget;
  }, [lockedTarget]);

=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
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
<<<<<<< HEAD
    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      targetDetectedRef.current = null; // 重置目标检测
=======
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
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
    };
    
    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      targetDetectedRef.current = null; // 松开鼠标时销毁检测器
<<<<<<< HEAD
      // 更新射击状态
      gameStore.setShootInfo({ isFiring: false });
    };
    
    const handleMouseMove = (event: MouseEvent) => {
      const mousePos = { x: event.clientX, y: event.clientY };
      mousePosRef.current = mousePos;
      
      // 计算鼠标在游戏世界中的位置
      if (camera) {
        const rect = canvas.getBoundingClientRect();
        
        // 正确计算鼠标在canvas物理像素上的位置
        const pixelX = (event.clientX - rect.left) * (canvas.width / rect.width);
        const pixelY = (event.clientY - rect.top) * (canvas.height / rect.height);
        
        // 转换为标准化设备坐标
        const ndcX = (pixelX / canvas.width) * 2 - 1;
        const ndcY = -(pixelY / canvas.height) * 2 + 1;
        
        // 确保相机投影矩阵已更新
        if (camera.aspect !== canvas.width / canvas.height) {
          camera.aspect = canvas.width / canvas.height;
          camera.updateProjectionMatrix();
        }
        
        // 创建射线
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        
        // 更新射线可视化数据
        setRayOrigin(raycaster.ray.origin.clone());
        setRayDirection(raycaster.ray.direction.clone());
        
        // 只有当没有锁定目标时，才根据鼠标位置更新射击方向
        if (!lockedTargetRef.current) {
          // 同时更新射击方向，确保两者一致
          setShootDirection(raycaster.ray.direction.clone().normalize());
        }
        
        // 计算射线与地面的交点（Y=0平面）
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        
        if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
          gameStore.setMousePosition({
            x: event.clientX,
            y: event.clientY,
            gameX: intersectPoint.x,
            gameY: intersectPoint.y,
            gameZ: intersectPoint.z
          });
        } else {
          gameStore.setMousePosition({
            x: event.clientX,
            y: event.clientY
          });
        }
      } else {
        gameStore.setMousePosition(mousePos);
      }
=======
      stopAutoShoot();
    };
    
    const handleMouseMove = (event: MouseEvent) => {
      mousePosRef.current = { x: event.clientX, y: event.clientY };
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
    };
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
<<<<<<< HEAD
    };
  }, [lockedTarget, gameStore]); // 依赖项
=======
      if (autoShootIntervalRef.current) clearInterval(autoShootIntervalRef.current);
    };
  }, [lockedTarget, gameStore, fireRate]); // 依赖项
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e

  // 实时计算子弹方向（纯函数，每次调用都用最新参数）
  const getBulletDirection = (
    camera: THREE.Camera,
    characterPos: { x: number; y: number; z: number },
    mouseX: number,
    mouseY: number,
    canvasElement: HTMLCanvasElement  // 传入 canvas 元素
  ): THREE.Vector3 => {
<<<<<<< HEAD
    // 1. 获取 canvas 相对坐标并考虑物理像素尺寸
    const rect = canvasElement.getBoundingClientRect();
    
    // 正确计算鼠标在canvas物理像素上的位置
    const pixelX = (mouseX - rect.left) * (canvasElement.width / rect.width);
    const pixelY = (mouseY - rect.top) * (canvasElement.height / rect.height);
    
    // 转换为标准化设备坐标
    const ndcX = (pixelX / canvasElement.width) * 2 - 1;
    const ndcY = -(pixelY / canvasElement.height) * 2 + 1;

    // 确保相机投影矩阵已更新
    if (camera.aspect !== canvasElement.width / canvasElement.height) {
      camera.aspect = canvasElement.width / canvasElement.height;
      camera.updateProjectionMatrix();
    }
=======
    // 1. 获取 canvas 相对坐标
    const rect = canvasElement.getBoundingClientRect();
    const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e

    // 2. 创建射线
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    
<<<<<<< HEAD
    // 3. 直接使用相机射线方向作为子弹方向
    // 这样可以确保射击方向与鼠标射线完全一致
    return raycaster.ray.direction.clone().normalize();
=======
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
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
  };

  // 每帧更新角色位置
  useFrame(({ camera }, delta) => {
<<<<<<< HEAD
    // 更新相机引用
    cameraRef.current = camera;
    
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
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
    
<<<<<<< HEAD
    // 更新相机位置到状态管理
    if (camera) {
      gameStore.setCameraPosition({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      });
    }
    
    // 射线检测可射击目标
    if (camera) {
      const raycaster = new THREE.Raycaster();
      // 使用鼠标位置并考虑物理像素尺寸
      const rect = canvas.getBoundingClientRect();
      
      // 正确计算鼠标在canvas物理像素上的位置
      const pixelX = (mousePosRef.current.x - rect.left) * (canvas.width / rect.width);
      const pixelY = (mousePosRef.current.y - rect.top) * (canvas.height / rect.height);
      
      // 转换为标准化设备坐标
      const ndcX = (pixelX / canvas.width) * 2 - 1;
      const ndcY = -(pixelY / canvas.height) * 2 + 1;
      
      // 确保相机投影矩阵已更新
      if (camera.aspect !== canvas.width / canvas.height) {
        camera.aspect = canvas.width / canvas.height;
        camera.updateProjectionMatrix();
      }
      
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      
      // 每次都重新收集可射击物体，确保动态添加的物体也能被检测到
      const objects: THREE.Object3D[] = [];
      scene.traverse(obj => {
        if (obj.userData.isShootable) objects.push(obj);
      });
      shootableObjectsRef.current = objects;
      
      // 调试：打印可射击物体数量
      console.log('可射击物体数量:', shootableObjectsRef.current.length);
      
      // 使用预收集的可射击物体数组
      const intersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
      
      // 调试：打印检测结果
      console.log('射线检测结果数量:', intersects.length);
      
      // 临时变量，用于存储新的锁定目标
      let newLockedTarget: { point: THREE.Vector3; object: THREE.Object3D } | null = null;
      
      // 更新射线检测信息到游戏状态
      gameStore.setRaycastInfo({
        active: true,
        shootableObjects: shootableObjectsRef.current.length,
        intersects: intersects.length,
        locked: intersects.length > 0
      });
      
      // 先恢复所有之前可能锁定的目标的材质
      if (lockedTargetRef.current) {
        if (lockedTargetRef.current.object instanceof THREE.Mesh) {
          // 直接设置初始材质（红色）
          const originalMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0x330000,
            emissiveIntensity: 0.5,
            side: 2 // 双面渲染
          });
          lockedTargetRef.current.object.material = originalMaterial;
        }
      }
      
=======
    // 射线检测可射击目标
    if (camera) {
      const raycaster = new THREE.Raycaster();
      // 使用鼠标位置
      const rect = canvas.getBoundingClientRect();
      const mouseX = ((mousePosRef.current.x - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((mousePosRef.current.y - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
      
      // 确保可射击物体数组已初始化
      if (shootableObjectsRef.current.length === 0) {
        const objects: THREE.Object3D[] = [];
        scene.traverse(obj => {
          if (obj.userData.isShootable) objects.push(obj);
        });
        shootableObjectsRef.current = objects;
      }
      
      // 使用预收集的可射击物体数组
      const intersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
      
      // 临时变量，用于存储新的锁定目标
      let newLockedTarget: { point: THREE.Vector3; object: THREE.Object3D } | null = null;
      
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
      if (intersects.length > 0) {
        const hit = intersects[0];
        newLockedTarget = { point: hit.point, object: hit.object };
        
        // 调试：给锁定的目标添加发光效果
        if (hit.object instanceof THREE.Mesh) {
<<<<<<< HEAD
=======
          // 保存原始材质
          if (!hit.object.userData.originalMaterial) {
            hit.object.userData.originalMaterial = hit.object.material;
          }
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
          // 创建发光材质
          const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.7 
          });
          hit.object.material = glowMaterial;
        }
<<<<<<< HEAD
      } else {
        newLockedTarget = null;
      }
      
      // 直接更新ref，确保实时反映锁定状态
      lockedTargetRef.current = newLockedTarget;
=======
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
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
      
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
    
<<<<<<< HEAD
    // 传统开火检测
    if (isMouseDownRef.current && cameraRef.current) {
=======
    // 传统开火检测（当没有锁定目标时使用）
    if (isMouseDownRef.current && camera && !lockedTarget) {
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
      const now = Date.now();
      if (now - lastFireTimeRef.current >= fireRate) {
        lastFireTimeRef.current = now;
        
        // 实时获取最新值
        const realTimeCharacterPos = gameStore.character.position;
        let direction: THREE.Vector3;
        
<<<<<<< HEAD
        // 检查是否有锁定目标
        if (lockedTargetRef.current) {
          // 有锁定目标：从角色位置指向锁定目标的击中点
          console.log('使用锁定目标射击');
          direction = new THREE.Vector3().subVectors(
            lockedTargetRef.current.point,
            new THREE.Vector3(realTimeCharacterPos.x, realTimeCharacterPos.y + 1.2, realTimeCharacterPos.z)
          ).normalize();
        } else if (targetDetectedRef.current) {
          // 如果检测到目标，自动瞄准目标
=======
        // 如果检测到目标，自动瞄准目标
        if (targetDetectedRef.current) {
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
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
<<<<<<< HEAD
          console.log('使用鼠标位置射击');
          direction = getBulletDirection(cameraRef.current, realTimeCharacterPos, mousePosRef.current.x, mousePosRef.current.y, canvas);
        }
        
        // 更新射击方向
        setShootDirection(direction.clone());
        
=======
          direction = getBulletDirection(camera, realTimeCharacterPos, mousePosRef.current.x, mousePosRef.current.y, canvas);
        }
        
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
        const newBullet = {
          id: bulletIdRef.current++,
          position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z }, // 增加发射高度，确保子弹能够接触到准心
          direction,
        };
        setBullets(prev => [...prev, newBullet]);
<<<<<<< HEAD
        
        // 更新射击状态
        gameStore.setShootInfo({
          isFiring: true,
          fireCount: gameStore.shootInfo.fireCount + 1
        });
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
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
<<<<<<< HEAD
      {/* 渲染射线可视化 */}
      <RayVisualizer
        origin={rayOrigin}
        direction={rayDirection}
        length={100}
        color={0xff0000}
      />
      {/* 渲染射击方向可视化 */}
      <ShootDirectionVisualizer
        origin={new THREE.Vector3(
          gameStore.character.position.x,
          gameStore.character.position.y + 1.2,
          gameStore.character.position.z
        )}
        direction={shootDirection}
        length={3}
        color={0x00ff00}
        thickness={0.1}
      />
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
    </>
  );
};

export default App;