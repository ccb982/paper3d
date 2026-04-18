import { Canvas } from '@react-three/fiber';
import { useGameStore, GameMode } from './systems/state/gameStore';
import { MenuPage, DailyPage, BattleHUD, ShopPage, GachaPage, SettingPage } from './ui/pages';
import { GameWorld } from './components/GameWorld';
import Crosshair from './components/UI/Crosshair';
import StatusPanel from './components/UI/StatusPanel';
import LoadingIndicator from './components/UI/LoadingIndicator';
import DialogBubble from './components/UI/DialogBubble';
import { CHARACTER_HEIGHT } from './utils/constants';
import { useEffect, useState, useRef } from 'react';
import { characterPositionStore } from './systems/character/CharacterPositionStore';
import './styles/global.css';

function App() {
  const mode = useGameStore(s => s.mode);
  const isDebug = useGameStore(s => s.isDebug);
  const activeShootingSystem = useGameStore(s => s.activeShootingSystem);
  const toggleDebug = useGameStore(s => s.toggleDebug);
  const isLocking = useGameStore(s => s.isLocking);
  const lockCountdown = useGameStore(s => s.lockCountdown);

  const [displayPos, setDisplayPos] = useState({ x: 0, y: 0, z: 0 });
  const lastUpdateRef = useRef(0);
  const terrainHeight = 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F12') {
        event.preventDefault();
        toggleDebug();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleDebug]);

  useEffect(() => {
    let animationId: number;
    const throttledUpdate = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current >= 100) {
        setDisplayPos(characterPositionStore.getPositionCopy());
        lastUpdateRef.current = timestamp;
      }
      animationId = requestAnimationFrame(throttledUpdate);
    };
    animationId = requestAnimationFrame(throttledUpdate);
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div className="game-container">
      <Canvas camera={{ position: [0, 2, 10] }}>
        <GameWorld />
      </Canvas>

      {mode === GameMode.MENU && <MenuPage />}
      {mode === GameMode.DAILY && <DailyPage />}
      {mode === GameMode.BATTLE && <BattleHUD />}
      {mode === GameMode.SHOP && <ShopPage />}
      {mode === GameMode.GACHA && <GachaPage />}
      {mode === GameMode.SETTING && <SettingPage />}

      {(mode === GameMode.BATTLE || mode === GameMode.DAILY) && (
        <>
          {isDebug && (
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
              <div>角色 Y: {displayPos.y.toFixed(2)}</div>
              <div>地形 Y: {terrainHeight.toFixed(2)}</div>
              <div>角色脚 Y: {(displayPos.y - CHARACTER_HEIGHT / 2).toFixed(2)}</div>
              <div>射击系统: {activeShootingSystem === 'lockon' ? '锁定式' : '自由式'}</div>
              <div>模式: {mode === GameMode.BATTLE ? '战斗' : mode === GameMode.DAILY ? '日常' : mode}</div>
              <div>调试: {isDebug ? '开启' : '关闭'}</div>
            </div>
          )}
          {mode === GameMode.BATTLE && <div className="freestyle-crosshair" style={{ display: activeShootingSystem === 'freestyle' ? 'block' : 'none' }}></div>}
          <Crosshair isLockMode={mode === GameMode.DAILY || activeShootingSystem === 'lockon'} isLocking={isLocking} lockCountdown={lockCountdown} />
          <StatusPanel />
          <LoadingIndicator />
        </>
      )}
      <DialogBubble />
    </div>
  );
}

export default App;
