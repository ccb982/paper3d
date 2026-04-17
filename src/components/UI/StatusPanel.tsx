import React from 'react';
import { useGameStore } from '../../systems/state/gameStore';

const StatusPanel: React.FC = () => {
<<<<<<< HEAD
  const { character, cameraPosition, mousePosition, raycastInfo, shootInfo } = useGameStore();
=======
  const { character } = useGameStore();
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e

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
<<<<<<< HEAD
      <h3>相机状态</h3>
      <div className="status-item">
        <span>坐标:</span>
        <span>X: {cameraPosition.x.toFixed(2)}, Y: {cameraPosition.y.toFixed(2)}, Z: {cameraPosition.z.toFixed(2)}</span>
      </div>
      <h3>鼠标状态</h3>
      <div className="status-item">
        <span>屏幕坐标:</span>
        <span>X: {mousePosition.x}, Y: {mousePosition.y}</span>
      </div>
      {mousePosition.gameX !== undefined && (
        <div className="status-item">
          <span>游戏坐标:</span>
          <span>X: {mousePosition.gameX.toFixed(2)}, Y: {mousePosition.gameY?.toFixed(2)}, Z: {mousePosition.gameZ?.toFixed(2)}</span>
        </div>
      )}
      <h3>射线检测</h3>
      <div className="status-item">
        <span>状态:</span>
        <span>{raycastInfo.active ? '活跃' : '未激活'}</span>
      </div>
      <div className="status-item">
        <span>可射击物体:</span>
        <span>{raycastInfo.shootableObjects}</span>
      </div>
      <div className="status-item">
        <span>检测结果:</span>
        <span>{raycastInfo.intersects}</span>
      </div>
      <div className="status-item">
        <span>锁定状态:</span>
        <span>{raycastInfo.locked ? '已锁定' : '未锁定'}</span>
      </div>
      <h3>射击状态</h3>
      <div className="status-item">
        <span>开火状态:</span>
        <span>{shootInfo.isFiring ? '开火中' : '未开火'}</span>
      </div>
      <div className="status-item">
        <span>射击次数:</span>
        <span>{shootInfo.fireCount}</span>
      </div>
=======
>>>>>>> e7c24c7dd4b2cd421d679c150d2aa3c4aa420b8e
    </div>
  );
};

export default StatusPanel;