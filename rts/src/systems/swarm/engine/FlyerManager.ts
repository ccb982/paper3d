// ============================================================
// engine/FlyerManager —— 飞天管理器（重写 2026-09-27；用户定）
// ============================================================
// 设计（《移动执行重写.md》定稿）：
//   · 本管理器职责**只有一个：编成与补充**（按防区缺口补飞行小队）。
//   · **不再给"航线/选位/抑制位"目标**——飞行移动由**引擎命令标签**驱动：
//       命令标签（march/hold/patrol/protect/assault）/ **唯一兜底（行军↔巡逻交替）**；
//     巡逻=状态：队长核**不停调用长/短寻路**取腿（空中不做可行性/直航）。
//   · 开火是**独立子系统**（与移动解耦，可边走边打）。
//   · 位置只从 Positions 单源取；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 飞天策略参数（集中可调） */
export const FLYER_POLICY = {
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 3,
  /** ★ 补兵节拍（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 20, fast: 5 },
} as const;

export class FlyerManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('flyer', mgr, creationOf, 3);
    this.replenishSlowS = FLYER_POLICY.REPLENISH.slow;
    this.replenishFastS = FLYER_POLICY.REPLENISH.fast;
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
