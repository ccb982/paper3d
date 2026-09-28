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
