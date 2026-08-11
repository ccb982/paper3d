// ============================================================
// conditions —— AI 条件注册表（名字 → 函数）
// ============================================================
// 条件返回 true → 状态转移。索敌在 seePlayer 内完成并写入 ctx.target。

import type { EnemyBase } from '../../entity/EnemyBase';
import type { BehaviorContext } from './behaviors';

export type ConditionFn = (entity: EnemyBase, ctx: BehaviorContext, params: Record<string, number>) => boolean;

/** 条件注册表 */
export const conditionTable: Record<string, ConditionFn> = {};

export function registerCondition(name: string, fn: ConditionFn): void {
  conditionTable[name] = fn;
}

/** 索敌：视野半径内找到目标（camp='player'/'ally'）→ 写入 ctx.target */
registerCondition('seePlayer', (entity, ctx, params) => {
  const radius = params.radius ?? 8;
  const t = ctx.findTarget('player') ?? ctx.findTarget('ally');
  if (!t) return false;
  const dx = t.x - entity.entity.position.x;
  const dz = t.z - entity.entity.position.z;
  if (dx * dx + dz * dz <= radius * radius) {
    ctx.target = t;
    return true;
  }
  ctx.target = null;
  return false;
});

/** 目标在攻击距离内 */
registerCondition('inRange', (_entity, ctx, params) => {
  const radius = params.radius ?? 1.5;
  const t = ctx.target;
  if (!t) return false;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) <= radius;
});

/** 目标超出攻击距离（脱战回追） */
registerCondition('outOfRange', (_entity, ctx, params) => {
  const radius = params.radius ?? 2;
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});

/** 目标丢失（超距/消失）→ 回巡逻 */
registerCondition('loseTarget', (_entity, ctx, params) => {
  const radius = params.radius ?? 12;
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});
