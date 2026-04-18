import { useGameStore } from '../../systems/state/gameStore';

export const DailyPage = () => {
  const { startBattle, exitDaily } = useGameStore();

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
      <div style={{ marginBottom: '10px', fontSize: '16px', fontWeight: 'bold' }}>日常行动</div>
      <div style={{ marginBottom: '15px', color: '#aaa' }}>派遣、对话、收集资源</div>
      <div style={{ display: 'flex', gap: '10px', pointerEvents: 'auto' }}>
        <button onClick={startBattle} style={{ padding: '8px 16px', cursor: 'pointer' }}>进入战斗</button>
        <button onClick={exitDaily} style={{ padding: '8px 16px', cursor: 'pointer' }}>返回菜单</button>
      </div>
    </div>
  );
};