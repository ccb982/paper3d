import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
  const isMouseDownRef = useRef(false); // 鼠标按下状态

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

    // 添加鼠标移动事件监听器
    window.addEventListener('mousemove', handleMouseMove);

    // 清理事件监听器
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

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

  return null;
};

export default App;