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

function App() {
  const { triggerDialogue } = useDialogue();

  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    triggerDialogue(id);
  };

  return (
    <div className="game-container">
      <Canvas camera={{ position: [0, 2, 10] }}>
        <SceneSetup />
        <MapRenderer />
        <PaperCharacter 
          characterId="player" 
          onClick={handleCharacterClick} 
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
  const { camera } = useThree();
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7; // 跳跃力量
  const [cameraDistance, setCameraDistance] = useState(8); // 摄像机距离角色的距离
  const [cameraHeight, setCameraHeight] = useState(3); // 摄像机的高度
  const [cameraYaw, setCameraYaw] = useState(0); // 摄像机绕Y轴旋转（左右）
  const [cameraPitch, setCameraPitch] = useState(0); // 摄像机绕X轴旋转（上下）
  const mouseRef = useRef({ x: 0, y: 0 }); // 鼠标位置引用
  const [bullets, setBullets] = useState<Array<{ id: number; position: { x: number; y: number; z: number }; direction: THREE.Vector3 }>>([]);
  const bulletIdRef = useRef(0);
  const bulletVelocity = 50; // 子弹速度（增加速度）
  const isMouseDownRef = useRef(false); // 鼠标按下状态
  const fireIntervalRef = useRef<NodeJS.Timeout | null>(null); // 发射子弹的定时器
  const fireRate = 200; // 发射间隔（毫秒）

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  // 鼠标滚轮控制摄像机距离和高度
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // 计算新的摄像机距离
      const distanceDelta = e.deltaY > 0 ? 0.5 : -0.5; // 滚轮向上减少距离，向下增加距离
      const newDistance = cameraDistance + distanceDelta;
      
      // 计算新的摄像机高度（使用Ctrl键调整高度）
      if (e.ctrlKey) {
        const heightDelta = e.deltaY > 0 ? -0.2 : 0.2; // 滚轮向上增加高度，向下减少高度
        const newHeight = cameraHeight + heightDelta;
        setCameraHeight(newHeight);
      } else {
        // 只调整距离，不限制范围
        setCameraDistance(newDistance);
      }
    };

    // 添加鼠标滚轮事件监听器
    window.addEventListener('wheel', handleWheel);

    // 清理事件监听器
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [cameraDistance, cameraHeight]);

  // 鼠标控制摄像机旋转
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 计算鼠标移动距离
      const deltaX = e.clientX - mouseRef.current.x;
      const deltaY = e.clientY - mouseRef.current.y;

      // 更新鼠标位置
      mouseRef.current = { x: e.clientX, y: e.clientY };

      // 计算旋转角度（灵敏度调整）
      const sensitivity = 0.01;
      const yawDelta = -deltaX * sensitivity; // 反向调整
      const pitchDelta = -deltaY * sensitivity; // 反向调整

      // 更新摄像机旋转角度
      setCameraYaw(prev => prev + yawDelta);
      // 限制俯仰角度，避免过度旋转
      setCameraPitch(prev => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, prev - pitchDelta)));
    };

    const fireBullet = () => {
      if (camera) {
        const characterPos = gameStore.character.position;
        
        // 计算子弹发射位置（从角色位置稍微向前）
        const bulletPosition = {
          x: characterPos.x,
          y: characterPos.y + 1, // 从角色胸部高度发射
          z: characterPos.z
        };

        // 计算子弹发射方向（从角色位置指向准心位置）
        // 创建一个射线投射器
        const raycaster = new THREE.Raycaster();
        // 使用鼠标当前位置作为射线起点
        const mouseVector = new THREE.Vector2(
          (mouseRef.current.x / window.innerWidth) * 2 - 1,
          -(mouseRef.current.y / window.innerHeight) * 2 + 1
        );
        // 从摄像机位置发射射线
        raycaster.setFromCamera(mouseVector, camera);
        
        // 计算射线与远平面的交点，作为准心在3D空间中的位置
        const farPlaneDistance = 1000; // 远平面距离
        const crosshairPosition = new THREE.Vector3();
        raycaster.ray.at(farPlaneDistance, crosshairPosition);
        
        // 计算从角色位置到准心位置的方向
        const bulletDirection = new THREE.Vector3();
        bulletDirection.subVectors(crosshairPosition, new THREE.Vector3(bulletPosition.x, bulletPosition.y, bulletPosition.z));
        bulletDirection.normalize();

        // 生成唯一的子弹ID
        const bulletId = bulletIdRef.current++;

        // 添加新子弹
        setBullets(prev => [...prev, { id: bulletId, position: bulletPosition, direction: bulletDirection }]);
      }
    };

    const handleMouseDown = () => {
      isMouseDownRef.current = true;
      fireBullet(); // 立即发射一颗子弹
      // 设置定时器，持续发射子弹
      fireIntervalRef.current = setInterval(fireBullet, fireRate);
    };

    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      // 清除定时器，停止发射子弹
      if (fireIntervalRef.current) {
        clearInterval(fireIntervalRef.current);
        fireIntervalRef.current = null;
      }
    };

    // 添加鼠标事件监听器
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    // 清理事件监听器
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gameStore.character.position, camera]);

  // 每帧更新角色位置和摄像机位置
  useFrame((_, delta) => {
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
    
    // 第三人称摄像机跟随和旋转
    if (camera) {
      // 根据旋转角度计算摄像机位置
      const cameraX = finalPos.x + Math.sin(cameraYaw) * cameraDistance;
      const cameraZ = finalPos.z + Math.cos(cameraYaw) * cameraDistance;
      const cameraY = finalPos.y + cameraHeight;
      
      // 考虑俯仰角度的影响
      const pitchFactor = Math.cos(cameraPitch);
      const cameraTargetX = finalPos.x + Math.sin(cameraYaw) * cameraDistance * pitchFactor;
      const cameraTargetZ = finalPos.z + Math.cos(cameraYaw) * cameraDistance * pitchFactor;
      const cameraTargetY = finalPos.y + cameraHeight + Math.sin(cameraPitch) * cameraDistance;
      
      // 平滑移动摄像机到目标位置
      camera.position.x += (cameraTargetX - camera.position.x) * 0.1;
      camera.position.y += (cameraTargetY - camera.position.y) * 0.1;
      camera.position.z += (cameraTargetZ - camera.position.z) * 0.1;
      
      // 让摄像机看向角色
      camera.lookAt(finalPos.x, finalPos.y + 1, finalPos.z);
    }
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