// ============================================================
// conditions —— AI 条件注册表（名字 → 函数）
// ============================================================
// 条件返回 true → 状态转移。索敌在 seePlayer 内完成并写入 ctx.target。

import type { EnemyBase } from '../../entity/EnemyBase';
import { pnum, pstr } from './behaviors';
import type { BehaviorContext } from './behaviors';

export type ConditionFn = (entity: EnemyBase, ctx: BehaviorContext, params: Record<string, string | number>) => boolean;

/** 条件注册表 */
export const conditionTable: Record<string, ConditionFn> = {};

export function registerCondition(name: string, fn: ConditionFn): void {
  conditionTable[name] = fn;
}

/** 索敌：视野半径内找到目标（camp 参数指定阵营，逗号分隔多选）→ 写入 ctx.target。
 *  ★ 若模式层提供 targetCandidates（优先级队列：祖宗 > 玩家 > 友军），按序取第一个在视野内的 */
registerCondition('seePlayer', (entity, ctx, params) => {
  const radius = pnum(params, 'radius', 8);
  const r2 = radius * radius;
  const ep = entity.entity.position;
  let t: { x: number; z: number } | null = null;

  const cands = ctx.targetCandidates?.(entity);
  if (cands && cands.length > 0) {
    for (const c of cands) {
      const dx = c.x - ep.x;
      const dz = c.z - ep.z;
      if (dx * dx + dz * dz <= r2) { t = c; break; }
    }
  } else {
    const camps = pstr(params, 'camp', 'player').split(',');
    for (const c of camps) {
      t = ctx.findTarget(c);
      if (t) break;
    }
    if (t) {
      const dx = t.x - ep.x;
      const dz = t.z - ep.z;
      if (dx * dx + dz * dz > r2) t = null;
    }
  }

  if (!t) {
    ctx.target = null;
    return false;
  }
  ctx.target = t;
  return true;
});

/** 目标在攻击距离内 */
registerCondition('inRange', (_entity, ctx, params) => {
  const radius = pnum(params, 'radius', 1.5);
  const t = ctx.target;
  if (!t) return false;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) <= radius;
});

/** 目标超出攻击距离（脱战回追） */
registerCondition('outOfRange', (_entity, ctx, params) => {
  const radius = pnum(params, 'radius', 2);
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});

/** ★ 挥击播完（一次性攻击结束 → 回游走） */
registerCondition('attackFinished', (entity) => entity.aiSwingDone === true);

/** 目标丢失（超距/消失）→ 回巡逻 */
registerCondition('loseTarget', (_entity, ctx, params) => {
  const radius = pnum(params, 'radius', 12);
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});
