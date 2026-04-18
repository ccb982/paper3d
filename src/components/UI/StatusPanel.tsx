import React, { useState, useEffect, useRef } from 'react';
import { characterPositionStore } from '../../systems/character/CharacterPositionStore';

const StatusPanel: React.FC = () => {
  const [position, setPosition] = useState({ x: 0, z: 0 });
  const [isMoving, setIsMoving] = useState(false);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    let animationId: number;
    const throttledUpdate = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current >= 100) {
        const pos = characterPositionStore.getPositionCopy();
        setPosition({ x: pos.x, z: pos.z });
        setIsMoving(characterPositionStore.isMoving);
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
    <div className="status-panel">
      <h3>角色状态</h3>
      <div className="status-item">
        <span>坐标:</span>
        <span>X: {position.x.toFixed(2)}, Z: {position.z.toFixed(2)}</span>
      </div>
      <div className="status-item">
        <span>移动状态:</span>
        <span>{isMoving ? '移动中' : '静止'}</span>
      </div>
      <div className="status-item">
        <span>好感度:</span>
        <span>100</span>
      </div>
    </div>
  );
};

export default StatusPanel;