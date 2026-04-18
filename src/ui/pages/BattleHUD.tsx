import { useGameStore } from '../../systems/state/gameStore';

export const BattleHUD = () => {
  const { exitBattle, gold } = useGameStore();

  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      backgroundColor: 'rgba(0,0,0,0.7)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      fontSize: '14px',
      zIndex: 1000,
      pointerEvents: 'none'
    }}>
      <div style={{ marginBottom: '10px', fontSize: '16px', fontWeight: 'bold' }}>战斗模式</div>
      <div style={{ marginBottom: '10px' }}>金币: {gold}</div>
      <button onClick={exitBattle} style={{ padding: '8px 16px', cursor: 'pointer', pointerEvents: 'auto' }}>退出战斗</button>
    </div>
  );
};