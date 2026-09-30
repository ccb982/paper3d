// ============================================================
// engine/RangedManager —— 远程兵管理器（重写 2026-09-27；用户定）
// ============================================================
// 设计（《移动执行重写.md》定稿）：
//   · 本管理器职责**只有一个：编成与补充**（按防区缺口补远程小队）。
//   · **不给任何目标**——你从未设计的"射程环/保距/边撤边打/躲掩体"**一律不存在**。
//     移动由**引擎命令标签**驱动：命令标签 / **唯一兜底（行军↔巡逻交替）**；
//     开火是**独立子系统**（自行决定打谁/打哪，与移动解耦，可边走边打）。
//   · 位置只从 Positions 单源取；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';
import type { UnitTactics, TacticalCtx } from './UnitScoring';
import { KIND, SLOPE_DIR } from '../TerrainSemantics';

/** 远程策略参数（集中可调） */
export const RANGED_POLICY = {
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 3,
  /** ★ 补兵节拍（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 18, fast: 4 },
} as const;

export class RangedManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('ranged', mgr, creationOf, 3);
    this.replenishSlowS = RANGED_POLICY.REPLENISH.slow;
    this.replenishFastS = RANGED_POLICY.REPLENISH.fast;
  }

  /** 只做编成/补充；**不给任何目标**（移动由引擎标签/唯一兜底驱动，开火独立）。 */
  assign(ctx: RoleCtx): number {
    this.ensureSquads(ctx.now);
    this.targets.clear();
    this.dbg.assigned = 0;
    this.dbg.last = 'assign=0（仅编成）';
    return 0;
  }
}

// ============================================================
// ★ 远程战术系数表（D3：决策源下移进兵种管理器）
//   配方：**喜高地**（h 项重）+ 掩体 + **藏点**（对舰遮挡加成）+ 射程带
// ============================================================
export const RANGED_TACTICS: UnitTactics = {
  mul: { h: 2.2, dist: 1.0, threat: 1.0, cover: 1.2, gap: 0.8, narrow: 0.8, hidden: 0.6, coverLOS: 1.0, high: 0, front: 0, back: 0, near: 1.0 },
  curves: { hidden: [[0.05, 0.05], [0.45, 0.15], [0.9, 0.25]], coverLOS: [[0.05, 0.4], [0.45, 0.6], [0.9, 0.8]] },
  withdraw: { h: 0.5, dist: 0.25, threat: 0.6, cover: 1.2, gap: 0.2, narrow: 0.1, hidden: 0, coverLOS: 0, high: 0, front: 0, back: 0, near: 0 },
  band: 1,
};

// ============================================================
// ★ 远程部署函数（D7 骨架；用户定 2026-09-30）：**专门找"高地 + 岗哨"的地方去驻守**
//   候选序：① 岗哨位（山顶 ∧ 近旁有已建掩体=账本加成 → 躲掩体驻守）
//           ② 高地面藏点（山顶/高原 ∧（对舰遮挡 ∨ 掩体））
//           ③ null（交给既有驻守/兜底）
//   消费：地形事实（kind/occluded/slopeDir）+ 掩体表（bonus 账本）；产出=**位数据**（位置）。
// ============================================================
export function rangedGarrisonSpot(
  ctx: TacticalCtx, from: { x: number; z: number }, radius = 90, step = 4,
): { x: number; z: number; why: 'sentry' | 'high' } | null {
  const { facts, bonus } = ctx;
  let bestSentry: { x: number; z: number; why: 'sentry'; score: number } | null = null;
  let bestHigh: { x: number; z: number; why: 'high'; score: number } | null = null;
  const R = Math.ceil(radius / step) * step;
  for (let dz = -R; dz <= R; dz += step) {
    for (let dx = -R; dx <= R; dx += step) {
      const x = from.x + dx, z = from.z + dz;
      const c = facts.cellAt(x, z);
      if (!c || (c.kind !== KIND.Peak && c.kind !== KIND.Plateau)) continue;
      if (!facts.isPassableAt(x, z)) continue;
      // 掩体账本：±1 格内最高加成（岗哨=已建掩体在近旁）
      let cov = 0;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const v = bonus.get(`${Math.round((x + a * 4) / 4)},${Math.round((z + b * 4) / 4)}`) ?? 0;
          if (v > cov) cov = v;
        }
      }
      const d = Math.hypot(dx, dz);
      const hidden = c.occluded ? 1 : 0;
      const front = c.slopeDir === SLOPE_DIR.Front ? 1 : 0;
      if (c.kind === KIND.Peak && cov > 0) {
        const score = cov * 2 + hidden + front * 0.5 - d * 0.01;   // 岗哨优先
        if (!bestSentry || score > bestSentry.score) bestSentry = { x, z, why: 'sentry', score };
      } else if (hidden || cov > 0) {
        const score = hidden + cov - d * 0.01;
        if (!bestHigh || score > bestHigh.score) bestHigh = { x, z, why: 'high', score };
      }
    }
  }
  const pick = bestSentry ?? bestHigh;
  return pick ? { x: pick.x, z: pick.z, why: pick.why } : null;
}
