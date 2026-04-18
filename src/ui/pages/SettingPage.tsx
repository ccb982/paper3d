import { useGameStore } from '../../systems/state/gameStore';

export const SettingPage = () => {
  const { exitSettings, isMuted, toggleMute, volume } = useGameStore();

  return (
    <div className="setting-overlay">
      <h1>设置</h1>
      <div className="setting-content">
        <div className="setting-item">
          <label>音效</label>
          <button onClick={toggleMute}>{isMuted ? '关闭' : '开启'}</button>
        </div>
        <div className="setting-item">
          <label>音量: {Math.round(volume * 100)}%</label>
        </div>
        <button onClick={exitSettings}>返回</button>
      </div>
    </div>
  );
};