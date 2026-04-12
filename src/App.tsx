import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { SceneSetup } from './systems/rendering/SceneSetup';
import { PaperCharacter } from './systems/character/PaperCharacter';
import { useKeyboard } from './systems/input/useKeyboard';
import { calculateNewPosition } from './systems/character/CharacterController';
import { useGameStore } from './systems/state/gameStore';
import './styles/global.css';
import { useRef, useEffect } from 'react';
import DialogBubble from './components/UI/DialogBubble';
import StatusPanel from './components/UI/StatusPanel';
import LoadingIndicator from './components/UI/LoadingIndicator';
import { useDialogue } from './systems/dialogue/useDialogue';
import { MapRenderer } from './systems/scene/MapRenderer';

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
    </div>
  );
}

// 移动控制器组件
const MovementController = () => {
  const { camera } = useThree();
  const direction = useKeyboard(camera);
  const directionRef = useRef(direction);
  const gameStore = useGameStore();

  // 同步方向值到ref，避免闭包问题
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  // 每帧更新角色位置
  useFrame((_, delta) => {
    const currentPos = gameStore.character.position;
    const currentDirection = directionRef.current;
    
    // 计算新位置
    const newPos = calculateNewPosition(currentPos, currentDirection, undefined, delta);
    
    // 更新角色位置
    gameStore.setCharacterPosition(newPos);
    
    // 更新角色移动状态
    gameStore.setCharacterMoving(currentDirection.x !== 0 || currentDirection.z !== 0);
  });

  return null;
};

export default App;