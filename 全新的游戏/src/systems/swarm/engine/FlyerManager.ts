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
import type { UnitTactics } from './UnitScoring';

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

// ============================================================
// ★ 飞行战术系数表（D3）：低依赖地形（机动支援；被击来援已实现引擎侧）
// ============================================================
export const FLYER_TACTICS: UnitTactics = {
  mul: { h: 1, dist: 1, threat: 1, cover: 1, gap: 1, narrow: 1, hidden: 1, coverLOS: 0, high: 1, front: 1, back: 1, near: 1 },
  withdraw: { h: 0.5, dist: 0.25, threat: 0.6, cover: 1.2, gap: 0.2, narrow: 0.1, hidden: 0, coverLOS: 0, high: 0, front: 0, back: 0, near: 0 },
};

// ============================================================
// ★ 飞行支援驻位（用户定 2026-09-30）：**选点函数**——被支援队旁 14m、朝舰侧 ±45°（按 id 分左右）：
//   不叠在被支援队上、卡在威胁来向；飞行直航（无视地形通道/坡面）。
// ============================================================
export function flyerSupportSpot(
  from: { x: number; z: number }, ship: { x: number; z: number }, id: number,
): { x: number; z: number } {
  const ux = ship.x - from.x, uz = ship.z - from.z;
  const L = Math.hypot(ux, uz) || 1;
  const a = Math.atan2(uz / L, ux / L) + (id % 2 === 0 ? Math.PI / 4 : -Math.PI / 4);
  return { x: from.x + Math.cos(a) * 14, z: from.z + Math.sin(a) * 14 };
}
