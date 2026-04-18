import { useGameStore } from '../../systems/state/gameStore';

export const GachaPage = () => {
  const { exitGacha } = useGameStore();

  return (
    <div className="gacha-overlay">
      <h1>抽卡</h1>
      <div className="gacha-content">
        <p>抽卡功能待实现...</p>
        <button onClick={exitGacha}>返回</button>
      </div>
    </div>
  );
};