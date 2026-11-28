// ============================================================
// TargetLock —— 准星锁定（每次开火只判定一次）
// ============================================================
// ★ 为什么单列一个模块（2026-11-28 架构收敛）：
//   · 旧实现把「实体射线」与「代理圆柱」拆在 WorldMode.crosshairPoint /
//     nearestSwarmOnRay 两处，各自只吐一个"点" ⇒ 开火后目标身份丢失，
//     子弹无法追人，只能每帧重新找"最近/偏角最小"的敌人。
//   · 现在一次判定同时产出：**稳定 uid**（跨 LOD 升降格不变）+ 命中点。
//   · 瞄准高度统一为 `aimAnchorY()` / `swarm.agentAimY()`（脖子），
//     不再混用 +0.8 / +0.9（那是"锁脚"的直接原因）。
// ============================================================

import type { EntityManager } from '../../entity/EntityManager';
import type { EntityBase } from '../../entity/EntityBase';
import type { SwarmSystem } from '../../systems/swarm/SwarmSystem';
import { aimRaycast, raySphereHit } from './Targeting';
import { BULLET_HIT_RADIUS } from './BulletEntity';

export interface TargetLock {
  /** 稳定身份（实体 / 代理通用；0 = 目标不可追踪，仅用于取命中点） */
  uid: number;
  /** 命中点（y = 脖子高度，非脚底） */
  x: number;
  y: number;
  z: number;
  /** 沿准星射线的距离（米） */
  distance: number;
}

export interface TargetLockRay {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

/**
 * ★ 准星 → 敌人锁定（每次开火调用一次，不做每帧扫描）：
 *   ① 敌人实体：`aimRaycast`（实体球体 + 物理遮挡校验；墙后不锁）
 *   ② 蜂群代理：射线到"脖子球"的距离 ≤ BULLET_HIT_RADIUS，且必须比实体/地形落点更近
 *   两者取更近者。没有对准任何敌人 → null（子弹走纯直线弹道，不做吸附）。
 */
export function resolveTargetLock(
  em: EntityManager,
  swarm: SwarmSystem,
  ray: TargetLockRay,
  exclude: EntityBase,
  maxDist: number,
  skipPhysics: (e: EntityBase) => boolean,
): TargetLock | null {
  const hit = aimRaycast(em, {
    origin: ray.origin, dir: ray.dir, maxDist, exclude,
    filter: (e) => e.camp === 'enemy',
    skipPhysics,
  });

  let best: TargetLock | null = null;
  if (hit && hit.target) {
    const e = hit.target;
    const y = e.aimAnchorY();
    best = {
      uid: (e as unknown as { swarmUid?: number }).swarmUid ?? 0,
      x: e.position.x, y, z: e.position.z,
      distance: hit.distance,
    };
  }

  // ★ 代理上限：实体/地形落点距离（防隔着地形抢锁）
  let bestT = Math.min(hit ? hit.distance : Infinity, maxDist);
  let bestIdx = -1;
  for (let i = 0; i < swarm.count; i++) {
    if (swarm.pool.hp[i] <= 0) continue;
    const t = raySphereHit(
      ray.origin, ray.dir,
      { x: swarm.agentX(i), y: swarm.agentAimY(i), z: swarm.agentZ(i) },
      BULLET_HIT_RADIUS,
    );
    if (t !== null && t > 1 && t < bestT) { bestT = t; bestIdx = i; }
  }
  if (bestIdx >= 0 && bestT < (best ? best.distance : Infinity)) {
    best = {
      uid: swarm.agentUid(bestIdx),
      x: swarm.agentX(bestIdx), y: swarm.agentAimY(bestIdx), z: swarm.agentZ(bestIdx),
      distance: bestT,
    };
  }
  return best;
}
