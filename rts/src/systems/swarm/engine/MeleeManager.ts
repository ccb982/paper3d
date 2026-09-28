// ============================================================
// engine/MeleeManager —— 近战兵管理器（重写 2026-09-27；用户定）
// ============================================================
// 设计（《移动执行重写.md》定稿）：
//   · 本管理器职责**只有一个：编成与补充**（按防区缺口补近战小队）。
//   · **不给任何目标**——你从未设计的"压上/护卫/接敌距离/驻锚"**一律不存在**。
//     移动由**引擎命令标签**驱动：命令标签 / **唯一兜底（行军↔巡逻交替）**；
//     到位交战属于**开火子系统**（独立实现，可边走边打）。
//   · 位置只从 Positions 单源取；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 近战策略参数（集中可调） */
export const MELEE_POLICY = {
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 6,
  /** ★ 补兵节拍（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 15, fast: 3 },
} as const;

export class MeleeManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('melee', mgr, creationOf, 6);
    this.replenishSlowS = MELEE_POLICY.REPLENISH.slow;
    this.replenishFastS = MELEE_POLICY.REPLENISH.fast;
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
