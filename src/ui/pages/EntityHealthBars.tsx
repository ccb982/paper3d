import { useGameStore, GameMode } from '../../systems/state/gameStore';
import { useRef, useEffect } from 'react';
import { EntityManager } from '../../core/EntityManager';
import { CharacterEntity } from '../../entities/CharacterEntity';
import { StaticEntity } from '../../entities/StaticEntity';
import { cameraStore } from '../../core/CameraStore';
import * as THREE from 'three';

export const EntityHealthBars = () => {
  const mode = useGameStore(s => s.mode);

  // 只在战斗模式显示血条
  if (mode !== GameMode.BATTLE) {
    return null;
  }

  // 获取实际的相机和渲染器
  const camera = cameraStore.getCamera() || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = cameraStore.getRenderer();
  const rendererDomElement = renderer?.domElement || { clientWidth: window.innerWidth, clientHeight: window.innerHeight };

  // 获取所有实体并过滤出需要显示血条的实体
  const entities = EntityManager.getInstance().getAllEntities().filter(entity => 
    (entity instanceof CharacterEntity) || 
    (entity instanceof StaticEntity && (entity as any).isShootable)
  );

  // 生成血条
  const entityHealthBars = entities.map(entity => {
    // 计算屏幕坐标
    const screenPos = new THREE.Vector3(
      entity.position.x,
      entity.position.y + 2, // 血条显示在实体上方
      entity.position.z
    );
    
    screenPos.project(camera);
    
    // 转换为屏幕坐标
    const x = (screenPos.x * 0.5 + 0.5) * rendererDomElement.clientWidth;
    const y = (1 - screenPos.y * 0.5 - 0.5) * rendererDomElement.clientHeight;
    
    // 计算血条宽度
    const healthPercent = entity.health / entity.maxHealth;
    const barWidth = 80;
    const barHeight = 10;
    
    // 只有当实体在屏幕内且生命值小于最大值时显示血条
    if (screenPos.z > 1) return null;
    if (entity.health >= entity.maxHealth) return null;
    
    return (
      <div
        key={entity.id}
        style={{
          position: 'absolute',
          left: x - barWidth / 2,
          top: y - 30,
          width: barWidth,
          height: barHeight,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          borderRadius: '4px',
          overflow: 'hidden',
          zIndex: 999,
          pointerEvents: 'none'
        }}
      >
        <div
          style={{
            width: `${Math.max(0, healthPercent) * 100}%`,
            height: '100%',
            backgroundColor: entity instanceof CharacterEntity && (entity as CharacterEntity).faction === 'enemy' 
              ? '#ff4444' 
              : '#44ff44',
            transition: 'width 0.2s ease-out'
          }}
        />
      </div>
    );
  });

  return <>{entityHealthBars}</>;
};