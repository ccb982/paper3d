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

/**
 * ★★ 索敌：视野半径内找到目标（camp 参数指定阵营，逗号分隔多选）→ 写入 ctx.target。
 *
 * ★ 若模式层提供 targetCandidates（优先级队列：祖宗 > 舰船 > 玩家 > 友军），
 *   按序取第一个"在有效半径内"的候选；候选自带 radius（如祖宗嘲讽半径）优先于通用视野半径。
 *
 * ★★ 写进 ctx.target 的是**候选对象本身**（引用），不是坐标拷贝 —— 而 seePlayer
 *   **只挂在 patrol 上**，chase/attack 期间不再重跑索敌。因此候选**必须是"活对象"**：
 *   模式层每帧原地更新它的 x/z，ctx.target 就自动跟着目标走。
 *   ★ 若模式层改成 push 坐标拷贝，ctx.target 会退化成"看见那一刻的坐标快照"，
 *     而 inRange / outOfRange / loseTarget 全部按该快照判定 ——
 *     远程兵（attackFinished → chase 持续开火，永不回 patrol）会**永久锁死在旧坐标上
 *     朝空气射击**（2026-09-18 实测：玩家跑到 38m 外，弹道与真实方向夹角 157.7°）。
 *     不变量持有者是 `WorldMode.enemyTargetCandidates`（见那里的注释）。
 */
registerCondition('seePlayer', (entity, ctx, params) => {
  const radius = pnum(params, 'radius', 8);
  const ep = entity.entity.position;
  let t: { x: number; z: number } | null = null;

  const cands = ctx.targetCandidates?.(entity);
  if (cands && cands.length > 0) {
    for (const c of cands) {
      const dx = c.x - ep.x;
      const dz = c.z - ep.z;
      const r = c.radius ?? radius;
      if (dx * dx + dz * dz <= r * r) { t = c; break; }
    }
  } else {
    const r2 = radius * radius;
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

/** ★ 嘲讽重索敌（祖宗吸仇恨）：只认"自带 radius"的候选（如祖宗）。
 *  在半径内 → 强制把目标切过去（即使正在追玩家）；否则保留当前目标（不丢仇）。
 *  挂到 chase / attack 的转移表首位：追人途中祖宗落地也能拉走仇恨 */
registerCondition('retarget', (entity, ctx) => {
  const cands = ctx.targetCandidates?.(entity);
  if (!cands || cands.length === 0) return false;
  const ep = entity.entity.position;
  for (const c of cands) {
    if (c.radius === undefined) continue;
    const dx = c.x - ep.x;
    const dz = c.z - ep.z;
    if (dx * dx + dz * dz > c.radius * c.radius) continue;
    const cur = ctx.target;
    if (cur && cur.x === c.x && cur.z === c.z) return false;
    ctx.target = { x: c.x, z: c.z };
    return true;
  }
  return false;
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
