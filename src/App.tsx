import { Canvas } from '@react-three/fiber';
import { useGameStore, GameMode } from './systems/state/gameStore';
import { MenuPage, DailyPage, BattleHUD, ShopPage, GachaPage, SettingPage, EntityHealthBars } from './ui/pages';
import { GameWorld } from './components/GameWorld';
import Crosshair from './components/UI/Crosshair';
import StatusPanel from './components/UI/StatusPanel';
import LoadingIndicator from './components/UI/LoadingIndicator';
import DialogBubble from './components/UI/DialogBubble';
import { BackpackUI } from './ui/components/BackpackUI';
import { BoxUI } from './ui/components/BoxUI';
import { InteractionPrompt } from './ui/components/InteractionPrompt';
import { getNearbyInteractiveObjects } from './utils/interactionDetector';
import type { InteractiveObject } from './utils/interactionDetector';
import { backpackManager } from './systems/inventory/BackpackManager';
import { CHARACTER_HEIGHT } from './utils/constants';
import { useEffect, useState, useRef } from 'react';
import { characterPositionStore } from './systems/character/CharacterPositionStore';
import './styles/global.css';

function App() {
  const mode = useGameStore(s => s.mode);
  const isDebug = useGameStore(s => s.isDebug);
  const toggleDebug = useGameStore(s => s.toggleDebug);
  const isBackpackVisible = useGameStore(s => s.isBackpackVisible);
  const isBoxOpened = useGameStore(s => s.isBoxOpened);
  const currentBox = useGameStore(s => s.currentBox);
  const toggleBackpack = useGameStore(s => s.toggleBackpack);
  const openBox = useGameStore(s => s.openBox);
  const closeBox = useGameStore(s => s.closeBox);

  const [displayPos, setDisplayPos] = useState({ x: 0, y: 0, z: 0 });
  const [activeShootingSystem, setActiveShootingSystem] = useState('freestyle');
  const [isLocking, setIsLocking] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [interactiveObjects, setInteractiveObjects] = useState<InteractiveObject[]>([]);
  const lastUpdateRef = useRef(0);
  const terrainHeight = 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // F12 现在可以正常打开浏览器开发者工具

      // 按B键显示/隐藏背包UI
      if (event.key === 'b' || event.key === 'B') {
        toggleBackpack();
      }

      // 按E键交互
      if (event.key === 'e' || event.key === 'E') {
        if (interactiveObjects.length > 0) {
          handleInteract(interactiveObjects[0]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // 将InventorySystem引用存储到window对象，供BoxUI使用
    (window as any).inventorySystem = backpackManager.getInventory();
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [interactiveObjects]);

  useEffect(() => {
    let animationId: number;
    const updateInteractiveObjects = () => {
      const nearby = getNearbyInteractiveObjects();
      setInteractiveObjects(nearby);
      animationId = requestAnimationFrame(updateInteractiveObjects);
    };
    animationId = requestAnimationFrame(updateInteractiveObjects);
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  const handleInteract = (object: InteractiveObject) => {
    console.log('交互对象:', object);
    if (object.type === 'box' && object.entity) {
      const box = object.entity;
      if (typeof box.open === 'function') {
        box.open();
      }
      openBox(box);
      console.log('打开箱子:', object.id);
    }
  };

  const handleCloseBox = () => {
    if (currentBox && typeof currentBox.close === 'function') {
      currentBox.close();
    }
    closeBox();
  };

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
        <GameWorld 
          onLockStateChanged={(locking, countdown) => {
            setIsLocking(locking);
            setLockCountdown(countdown);
          }}
          onActiveSystemChanged={(system) => {
            setActiveShootingSystem(system);
          }}
        />
      </Canvas>

      {mode === GameMode.MENU && <MenuPage />}
      {mode === GameMode.DAILY && <DailyPage />}
      {mode === GameMode.BATTLE && <BattleHUD />}
      {mode === GameMode.BATTLE && <EntityHealthBars />}
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
      {(isBackpackVisible || isBoxOpened) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 997
          }}
        />
      )}
      <BackpackUI
        isVisible={isBackpackVisible}
        onClose={toggleBackpack}
      />
      <InteractionPrompt
        interactiveObjects={interactiveObjects}
        onInteract={handleInteract}
      />
      <BoxUI
        isVisible={isBoxOpened}
        inventory={currentBox?.getInventory()}
        boxName="箱子"
        onClose={handleCloseBox}
      />
    </div>
  );
}

export default App;
