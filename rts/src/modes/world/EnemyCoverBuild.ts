// ============================================================
// EnemyCoverBuild —— 敌人工程兵造掩体（S1；《敌人管线设计.md》§3）
// ============================================================
// 敌人造的掩体：**无海报**（poster:false）、正面朝来向（面向玩家来向）、带施工插值。
// 由 SwarmCommander.buildCover 端口调用（模式层注入）。
// ============================================================

import type * as THREE from 'three';
import type { EntityManager } from '../../entity/EntityManager';
import { EnemyCoverEntity } from '../../entity/enemy/EnemyCoverEntity';
import { COVER_DEPLOY_BUILD_TIME } from '../../entity/CoverEntity';
import type { DefensePlan } from '../../systems/swarm/LandingTerrain';

/** ★ 在 (x,z) 造一座敌人掩体（y = 模式层给的可站面高度；独立实体类型） */
export function buildEnemyCover(
  entities: EntityManager,
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  variant: 'cover' | 'wall',
  plan: DefensePlan | null,
): void {
  // 正面 +Z 朝向玩家来向（射击孔面向来敌）
  const heading = plan ? Math.atan2(plan.approachX, plan.approachZ) : 0;
  new EnemyCoverEntity(entities, scene, {
    x, y, z,
    heading,
    buildTime: COVER_DEPLOY_BUILD_TIME,
    variant,
  });
}
