import { Canvas } from '@react-three/fiber';
import { SceneSetup } from './systems/rendering/SceneSetup';
import { PaperCharacter } from './systems/character/PaperCharacter';
import './styles/global.css';

const App = () => {
  const handleCharacterClick = (id: string) => {
    console.log('Clicked character:', id);
    // 后续集成对话系统
  };

  return (
    <div className="game-container">
      <Canvas camera={{ position: [0, 7, 10] }}>
        <SceneSetup />
        <PaperCharacter 
          characterId="player" 
          onClick={handleCharacterClick} 
        />
      </Canvas>
    </div>
  );
};

export default App;