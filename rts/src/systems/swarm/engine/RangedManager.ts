// ============================================================
// engine/RangedManager —— 远程兵管理器（重写 P3；用户定）
// ============================================================
// 策略：射程环 / 保距 / 边撤边打。目标 = 站到"射程环"上（离玩家 STANDOFF 处）。
// 太近 → 后撤到环上；太远 → 前进到环上；环内不动。位置只从 Positions 单源取。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 远程策略参数（集中可调） */
export const RANGED_POLICY = {
  /** 射程环半径（米）：理想开火距离 */
  STANDOFF: 18,
  /** 环带容差（米；在此带内视为在位） */
  BAND: 4,
} as const;

export class RangedManager extends RoleManager {
  constructor(mgr: SquadManager) {
    super('ranged', mgr);
  }

  /** 保距：目标 = 玩家 + (本队→玩家方向) × STANDOFF，再夹进环 */
  assign(ctx: RoleCtx): number {
    const p = ctx.pos.player();
    if (!p) return 0;
    this.targets.clear();
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      const inBand = Math.abs(d - RANGED_POLICY.STANDOFF) <= RANGED_POLICY.BAND;
      const t = inBand || d < 1e-3
        ? { x: s.x, z: s.z }
        : { x: p.x + (dx / d) * RANGED_POLICY.STANDOFF, z: p.z + (dz / d) * RANGED_POLICY.STANDOFF };
      this.targets.set(id, this.clampToRing(t, ctx));
    }
    this.dbg.assigned = this.targets.size;
    this.dbg.last = `assign=${this.targets.size}`;
    return this.targets.size;
  }
}
