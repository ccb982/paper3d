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
import RayVisualizer, { MultiRayVisualizer } from './components/debug/RayVisualizer';
import ShootDirectionVisualizer from './components/debug/ShootDirectionVisualizer';
import { EffectManager } from './core/EffectManager';

const LOCK_DURATION = 1000; // 锁定持续时间（毫秒）

function getCameraPitch(camera: THREE.Camera): number {
  // 强制更新相机矩阵，确保获取到最新的方向
  camera.updateMatrixWorld();
  
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}

function getCorrectedNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  characterPosition: THREE.Vector3,
  baseCompensation: number = 0.3
): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const pixelWidth = canvas.width;
  const pixelHeight = canvas.height;
  const scaleX = pixelWidth / rect.width;
  const scaleY = pixelHeight / rect.height;
  const pixelX = (clientX - rect.left) * scaleX;
  const pixelY = (clientY - rect.top) * scaleY;
  let ndcX = (pixelX / pixelWidth) * 2 - 1;
  let ndcY = -(pixelY / pixelHeight) * 2 + 1;
  
  const pitch = getCameraPitch(camera);
  
  // 计算角色到摄像机的距离
  const distanceToCamera = camera.position.distanceTo(characterPosition);
  
  // 动态距离补偿：距离越近，补偿强度越大
  // 降低补偿系数，使修正效果更加柔和
  const distanceCompensation = Math.max(0.8, Math.min(1.2, 20 / distanceToCamera));
  
  // 俯角补偿：俯角越高（pitch > 0，向下看），补偿效果越好
  // 大幅降低俯角补偿系数
  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
  
  // 综合补偿系数
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
  
  // 修复补偿方向：当相机向下看时（pitch > 0），应该向上偏移射线
  // 所以使用负的补偿值
  const correction = -pitch * totalCompensation;
  ndcY += correction;
  ndcY = Math.max(-1, Math.min(1, ndcY));
  
  console.log(`Pitch: ${pitch.toFixed(3)}, Distance: ${distanceToCamera.toFixed(2)}, DistanceComp: ${distanceCompensation.toFixed(3)}, PitchComp: ${pitchCompensation.toFixed(3)}, Total: ${totalCompensation.toFixed(3)}, Correction: ${correction.toFixed(3)}`);
  
  return new THREE.Vector2(ndcX, ndcY);
}

function App() {
  const { triggerDialogue } = useDialogue();

  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  const gameStore = useGameStore();
  const characterPos = gameStore.character.position;
  const [isLocking, setIsLocking] = useState(false); // 是否正在锁定
  const [lockCountdown, setLockCountdown] = useState(0); // 锁定倒计时

  return (
    <div className="game-container">
      <Canvas camera={{ position: [0, 2, 10] }}
        onCreated={({ scene }) => {
          // 设置场景引用，供特效系统使用
          (window as any).gameScene = scene;
        }}
      >
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
        <MovementController 
          isLocking={isLocking} 
          setIsLocking={setIsLocking}
          lockCountdown={lockCountdown}
          setLockCountdown={setLockCountdown}
        />
      </Canvas>
      <StatusPanel />
      <DialogBubble />
      <LoadingIndicator />
      <Crosshair 
        isLocking={isLocking} 
        lockProgress={1 - (lockCountdown / 1000)}
      />
    </div>
  );
}

// 移动控制器组件
interface MovementControllerProps {
  isLocking: boolean;
  setIsLocking: React.Dispatch<React.SetStateAction<boolean>>;
  lockCountdown: number;
  setLockCountdown: React.Dispatch<React.SetStateAction<number>>;
}

const MovementController: React.FC<MovementControllerProps> = ({ 
  isLocking, 
  setIsLocking, 
  lockCountdown, 
  setLockCountdown 
}) => {
  const { camera, gl, scene } = useThree();
  const canvas = gl.domElement;
  const cameraRef = useRef(camera);
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7; // 跳跃力量
  const mousePosRef = useRef({ x: 0, y: 0 }); // 鼠标位置引用
  const [bullets, setBullets] = useState<Array<{ id: number; position: { x: number; y: number; z: number }; direction: THREE.Vector3 }>>([]);
  const [lockedTarget, setLockedTarget] = useState<{ point: THREE.Vector3; object: THREE.Object3D } | null>(null);
  const [rayOrigin, setRayOrigin] = useState(new THREE.Vector3());
  const [rayDirection, setRayDirection] = useState(new THREE.Vector3(0, 0, -1));
  const [shootDirection, setShootDirection] = useState(new THREE.Vector3(0, 0, -1));
  const [multiRayOrigins, setMultiRayOrigins] = useState<THREE.Vector3[]>([]);
  const [multiRayDirections, setMultiRayDirections] = useState<THREE.Vector3[]>([]);
  const rayOffsets = [
    { x: 0, y: 0 },
    { x: 0.05, y: 0 },
    { x: -0.05, y: 0 },
    { x: 0, y: 0.05 },
    { x: 0, y: -0.05 },
  ];
  const bulletIdRef = useRef(0);
  const bulletVelocity = 50; // 子弹速度（增加速度）
  const isMouseDownRef = useRef(false); // 鼠标按下状态
  const lastFireTimeRef = useRef(0); // 上次发射时间
  const fireRate = 200; // 发射间隔（毫秒）
  const targetDetectedRef = useRef<THREE.Object3D | null>(null); // 检测到的目标
  const autoShootIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shootableObjectsRef = useRef<THREE.Object3D[]>([]);
  const lockedTargetRef = useRef(lockedTarget); // 实时锁定目标引用
  const lockCountdownRef = useRef(0); // 锁定倒计时引用
  const isLockingRef = useRef(false); // 是否正在锁定引用

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  // 同步锁定目标到ref，避免闭包问题
  useEffect(() => {
    lockedTargetRef.current = lockedTarget;
  }, [lockedTarget]);

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
    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      targetDetectedRef.current = null; // 重置目标检测
      // 更新射击状态
      gameStore.setShootInfo({ isFiring: true });
    };
    
    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      targetDetectedRef.current = null; // 松开鼠标时销毁检测器
      // 松开鼠标时取消锁定倒计时
      lockCountdownRef.current = 0;
      isLockingRef.current = false;
      setLockCountdown(0);
      setIsLocking(false);
      console.log('取消锁定倒计时');
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
        
        // 确保相机投影矩阵已更新
        if (camera.aspect !== canvas.width / canvas.height) {
          camera.aspect = canvas.width / canvas.height;
          camera.updateProjectionMatrix();
          // 更新相机投影矩阵后，重新更新相机矩阵
          camera.updateMatrixWorld();
        }
        
        // 使用基于仰角的NDC修正
        const characterPos = new THREE.Vector3(gameStore.character.position.x, gameStore.character.position.y, gameStore.character.position.z);
        const correctedNDC = getCorrectedNDC(canvas, event.clientX, event.clientY, camera, characterPos, 0.3);
        
        // 创建射线
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(correctedNDC, camera);
        
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
    };
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [lockedTarget, gameStore]); // 依赖项

  // 实时计算子弹方向（纯函数，每次调用都用最新参数）
  const getBulletDirection = (
    camera: THREE.Camera,
    characterPos: { x: number; y: number; z: number },
    mouseX: number,
    mouseY: number,
    canvasElement: HTMLCanvasElement  // 传入 canvas 元素
  ): THREE.Vector3 => {
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

    // 2. 创建射线
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    
    // 3. 直接使用相机射线方向作为子弹方向
    // 这样可以确保射击方向与鼠标射线完全一致
    return raycaster.ray.direction.clone().normalize();
  };

  // 每帧更新角色位置
  useFrame(({ camera }, delta) => {
    // 强制更新相机矩阵，确保获取到最新的方向
    camera.updateMatrixWorld();
    
    // 更新相机引用
    cameraRef.current = camera;
    
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
    
    // 更新相机位置到状态管理
    if (camera) {
      gameStore.setCameraPosition({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      });
    }
    
    // 锁定倒计时逻辑
    if (isLockingRef.current && lockedTargetRef.current) {
      lockCountdownRef.current -= delta * 1000; // 将delta转换为毫秒
      console.log(`倒计时: ${lockCountdownRef.current.toFixed(0)}ms`);
      if (lockCountdownRef.current <= 0) {
        // 倒计时结束，锁定完成
        lockCountdownRef.current = 0;
        isLockingRef.current = false;
        setLockCountdown(0);
        setIsLocking(false);
        console.log('锁定完成，可以射击');
      } else {
        // 更新倒计时状态
        setLockCountdown(lockCountdownRef.current);
      }
    } else if (isLockingRef.current && !lockedTargetRef.current) {
      // 如果目标丢失，重置锁定状态
      lockCountdownRef.current = 0;
      isLockingRef.current = false;
      setLockCountdown(0);
      setIsLocking(false);
      console.log('目标丢失，取消锁定');
    }
    
    // 射线检测可射击目标
    if (camera) {
      // 强制更新相机矩阵，确保获取到最新的方向
      camera.updateMatrixWorld();
      
      const raycaster = new THREE.Raycaster();
      const rect = canvas.getBoundingClientRect();
      
      const pixelX = (mousePosRef.current.x - rect.left) * (canvas.width / rect.width);
      const pixelY = (mousePosRef.current.y - rect.top) * (canvas.height / rect.height);
      
      const ndcX = (pixelX / canvas.width) * 2 - 1;
      const ndcY = -(pixelY / canvas.height) * 2 + 1;
      
      if (camera.aspect !== canvas.width / canvas.height) {
        camera.aspect = canvas.width / canvas.height;
        camera.updateProjectionMatrix();
        // 更新相机投影矩阵后，重新更新相机矩阵
        camera.updateMatrixWorld();
      }
      
      // 使用基于仰角的NDC修正
      const characterPos = new THREE.Vector3(gameStore.character.position.x, gameStore.character.position.y, gameStore.character.position.z);
      const correctedNDC = getCorrectedNDC(canvas, mousePosRef.current.x, mousePosRef.current.y, camera, characterPos, 0.3);
      
      // 增加射线横截面积的检测：从1条增加到5条射线
      const rayOffsets = [
        { x: 0, y: 0 },
        { x: 0.05, y: 0 },
        { x: -0.05, y: 0 },
        { x: 0, y: 0.05 },
        { x: 0, y: -0.05 },
      ];
      
      // 每次都重新收集可射击物体，确保动态添加的物体也能被检测到
      const objects: THREE.Object3D[] = [];
      scene.traverse(obj => {
        if (obj.userData.isShootable) objects.push(obj);
      });
      shootableObjectsRef.current = objects;
      
      // 使用多条射线进行检测，同时计算修正前后的射线并取最高位置
      const allIntersects: THREE.Intersection[] = [];
      const rayOrigins: THREE.Vector3[] = [];
      const rayDirections: THREE.Vector3[] = [];
      
      for (const offset of rayOffsets) {
        // 原始射线（未修正）
        raycaster.setFromCamera(new THREE.Vector2(ndcX + offset.x, ndcY + offset.y), camera);
        const rawDirection = raycaster.ray.direction.clone();
        const rawIntersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
        
        // 修正后的射线
        raycaster.setFromCamera(new THREE.Vector2(correctedNDC.x + offset.x, correctedNDC.y + offset.y), camera);
        const correctedDirection = raycaster.ray.direction.clone();
        const correctedIntersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
        
        // 取两条射线中Y分量较大的方向（即更高的射线位置）
        // Y分量越大，射线越向上
        const finalDirection = rawDirection.y > correctedDirection.y ? rawDirection : correctedDirection;
        
        // 使用最终方向重新设置射线进行检测
        raycaster.set(camera.position, finalDirection);
        const finalIntersects = raycaster.intersectObjects(shootableObjectsRef.current, true);
        allIntersects.push(...finalIntersects);
        
        // 计算射线原点和方向用于可视化
        const rayOrigin = camera.position.clone();
        rayOrigins.push(rayOrigin);
        rayDirections.push(finalDirection);
      }
      
      // 更新多射线状态用于可视化
      setMultiRayOrigins(rayOrigins);
      setMultiRayDirections(rayDirections);
      
      console.log('可射击物体数量:', shootableObjectsRef.current.length);
      console.log('多射线检测结果数量:', allIntersects.length);
      
      let newLockedTarget: { point: THREE.Vector3; object: THREE.Object3D } | null = null;
      
      // 更新射线检测信息到游戏状态
      gameStore.setRaycastInfo({
        active: true,
        shootableObjects: shootableObjectsRef.current.length,
        intersects: allIntersects.length,
        locked: allIntersects.length > 0
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
      
      if (allIntersects.length > 0) {
        const hit = allIntersects[0];
        newLockedTarget = { point: hit.point, object: hit.object };
        
        // 调试：给锁定的目标添加发光效果
        if (hit.object instanceof THREE.Mesh) {
          // 创建发光材质
          const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.7 
          });
          hit.object.material = glowMaterial;
        }
        
        // 当锁定目标且鼠标按下时，开始锁定倒计时
        // 只有当之前没有锁定目标时才开始倒计时
        if (isMouseDownRef.current && !isLockingRef.current && !lockedTargetRef.current) {
          lockCountdownRef.current = 1000; // 1秒锁定时间
          isLockingRef.current = true;
          setLockCountdown(1000);
          setIsLocking(true);
          console.log('开始锁定倒计时');
        }
      } else {
        newLockedTarget = null;
        // 当目标丢失时，重置锁定状态
        if (isLockingRef.current) {
          lockCountdownRef.current = 0;
          isLockingRef.current = false;
          setLockCountdown(0);
          setIsLocking(false);
          console.log('目标丢失，取消锁定');
        }
      }
      
      // 直接更新ref，确保实时反映锁定状态
      lockedTargetRef.current = newLockedTarget;
      
      setLockedTarget(newLockedTarget);
    }
    
    // 目标检测
    if (isMouseDownRef.current && camera) {
      // 强制更新相机矩阵，确保获取到最新的方向
      camera.updateMatrixWorld();
      
      // 获取 canvas 相对坐标并应用仰角修正
      const characterPosForTarget = new THREE.Vector3(gameStore.character.position.x, gameStore.character.position.y, gameStore.character.position.z);
      const correctedNDCForTarget = getCorrectedNDC(canvas, mousePosRef.current.x, mousePosRef.current.y, camera, characterPosForTarget, 0.3);
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((mousePosRef.current.x - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((mousePosRef.current.y - rect.top) / rect.height) * 2 + 1;

      // 创建射线，同时计算修正前后的射线并取最高位置
      const raycaster = new THREE.Raycaster();
      
      // 原始射线（未修正）
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const rawDirection = raycaster.ray.direction.clone();
      
      // 修正后的射线
      raycaster.setFromCamera(correctedNDCForTarget, camera);
      const correctedDirection = raycaster.ray.direction.clone();
      
      // 取两条射线中Y分量较大的方向（即更高的射线位置）
      const finalDirection = rawDirection.y > correctedDirection.y ? rawDirection : correctedDirection;
      
      // 使用最终方向设置射线
      raycaster.set(camera.position, finalDirection);

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
    
    // 传统开火检测（只在锁定状态且倒计时结束后射击）
    if (isMouseDownRef.current && cameraRef.current && lockedTargetRef.current && !isLockingRef.current) {
      const now = Date.now();
      if (now - lastFireTimeRef.current >= fireRate) {
        lastFireTimeRef.current = now;
        
        // 实时获取最新值
        const realTimeCharacterPos = gameStore.character.position;
        
        // 有锁定目标：从角色位置指向锁定目标的击中点
        console.log('使用锁定目标射击');
        // 获取目标的世界位置，确保使用最新位置
        const targetPosition = new THREE.Vector3();
        lockedTargetRef.current.object.getWorldPosition(targetPosition);
        
        const direction = new THREE.Vector3().subVectors(
          targetPosition,
          new THREE.Vector3(realTimeCharacterPos.x, realTimeCharacterPos.y + 1.2, realTimeCharacterPos.z)
        ).normalize();
        
        // 更新射击方向
        setShootDirection(direction.clone());
        
        // 更新射击状态
        gameStore.setShootInfo({
          isFiring: true,
          fireCount: gameStore.shootInfo.fireCount + 1
        });
        
        const newBullet = {
          id: bulletIdRef.current++,
          position: { x: realTimeCharacterPos.x, y: realTimeCharacterPos.y + 1.2, z: realTimeCharacterPos.z }, // 增加发射高度，确保子弹能够接触到准心
          direction,
        };
        setBullets(prev => [...prev, newBullet]);
        console.log('发射子弹:', newBullet);
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
      {/* 渲染射线可视化 */}
      <RayVisualizer
        origin={rayOrigin}
        direction={rayDirection}
        length={100}
        color={0xff0000}
      />
      {/* 渲染多射线横截面积可视化 */}
      <MultiRayVisualizer
        origins={multiRayOrigins}
        directions={multiRayDirections}
        length={100}
        color={0x00ffff}
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
    </>
  );
};

export default App;