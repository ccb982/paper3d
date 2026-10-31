// ============================================================
// RestoreWalls —— 世界状态恢复：玩家墙 + 敌人掩体（分开建，不混）
// ============================================================
// · 玩家墙（data.walls）→ CoverEntity，计入 playerCovers（上限管理）
// · 敌人掩体（data.enemyWalls）→ EnemyCoverEntity（独立实体类型，不计玩家上限）
// · 旧档兼容：data.walls 里混存的 owner='enemy' 记录按归属分流（不会恢复成玩家墙）
// ============================================================

import type * as THREE from 'three';
import type { EntityManager } from '../../entity/EntityManager';
import { CoverEntity } from '../../entity/CoverEntity';
import { EnemyCoverEntity } from '../../entity/enemy/EnemyCoverEntity';
import type { WallRec } from '../../core/WorldStateCache';

export function restoreWalls(
  entities: EntityManager,
  scene: THREE.Scene,
  walls: WallRec[],
  enemyWalls: WallRec[],
  playerCovers: CoverEntity[],
): void {
  const spawn = (w: WallRec, forceEnemy: boolean): void => {
    const enemy = forceEnemy || w.owner === 'enemy';
    if (enemy) {
      new EnemyCoverEntity(entities, scene, {
        x: w.x, y: w.y, z: w.z, heading: w.heading, variant: w.variant,
        hp: Math.max(1, Math.round(w.hp)), buildTime: 0,
      });
      return;
    }
    playerCovers.push(new CoverEntity(entities, scene, {
      x: w.x, y: w.y, z: w.z, heading: w.heading, variant: w.variant,
      owner: 'player', hp: Math.max(1, Math.round(w.hp)), buildTime: 0,
    }));
  };
  for (const w of walls) spawn(w, false);
  for (const w of enemyWalls) spawn(w, true);
}
