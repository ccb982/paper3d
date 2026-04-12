import React from 'react';
import { useGameStore } from '../../systems/state/gameStore';

const StatusPanel: React.FC = () => {
  const { character } = useGameStore();

  return (
    <div className="status-panel">
      <h3>角色状态</h3>
      <div className="status-item">
        <span>坐标:</span>
        <span>X: {character.position.x.toFixed(2)}, Z: {character.position.z.toFixed(2)}</span>
      </div>
      <div className="status-item">
        <span>移动状态:</span>
        <span>{character.isMoving ? '移动中' : '静止'}</span>
      </div>
      <div className="status-item">
        <span>好感度:</span>
        <span>100</span>
      </div>
    </div>
  );
};

export default StatusPanel;