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
  const { camera, gl } = useThree();
  const canvas = gl.domElement;
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();
  const jumpForce = 7; // 跳跃力量
  const mousePosRef = useRef({ x: 0, y: 0 }); // 鼠标位置引用
  const [bullets, setBullets] = useState<Array<{ id: number; position: { x: number; y: number; z: number }; direction: THREE.Vector3 }>>([]);
  const bulletIdRef = useRef(0);
  const bulletVelocity = 50; // 子弹速度（增加速度）
  const isMouseDownRef = useRef(false); // 鼠标按下状态
  const lastFireTimeRef = useRef(0); // 上次发射时间
  const fireRate = 200; // 发射间隔（毫秒）

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  // 鼠标事件处理
  useEffect(() => {
    const handleMouseDown = () => {
      isMouseDownRef.current = true;
    };
    
    const handleMouseUp = () => {
      isMouseDownRef.current = false;
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
    };
  }, []); // 空依赖，确保只添加一次事件监听器

  // 实时计算子弹方向（纯函数，每次调用都用最新参数）
  const getBulletDirection = (
    camera: THREE.Camera,
    characterPos: { x: number; y: number; z: number },
    mouseX: number,
    mouseY: number,
    canvasElement: HTMLCanvasElement  // 传入 canvas 元素
  ): THREE.Vector3 => {
    // 1. 计算 canvas 相对坐标
    const rect = canvasElement.getBoundingClientRect();
    const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;

    // 2. 创建射线
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    // 3. 直接使用相机射线方向作为子弹方向，考虑相机的所有旋转角度
    // 这样子弹会沿着玩家视线方向飞行，与相机俯仰角度保持一致
    return raycaster.ray.direction.clone().normalize();
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
    
    // 开火检测
    if (isMouseDownRef.current && camera) {
      const now = Date.now();
      if (now - lastFireTimeRef.current >= fireRate) {
        lastFireTimeRef.current = now;
        
        // 实时获取最新值
        const realTimeCharacterPos = gameStore.character.position;
        const direction = getBulletDirection(camera, realTimeCharacterPos, mousePosRef.current.x, mousePosRef.current.y, canvas);
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