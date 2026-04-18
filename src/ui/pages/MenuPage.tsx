import { useGameStore } from '../../systems/state/gameStore';

export const MenuPage = () => {
  const { startBattle, openDaily, openShop, openGacha, openSettings } = useGameStore();

  return (
    <div className="menu-overlay">
      <h1>游戏菜单</h1>
      <div className="menu-buttons">
        <button onClick={openDaily}>日常行动</button>
        <button onClick={startBattle}>开始战斗</button>
        <button onClick={openShop}>商店</button>
        <button onClick={openGacha}>抽卡</button>
        <button onClick={openSettings}>设置</button>
      </div>
    </div>
  );
};