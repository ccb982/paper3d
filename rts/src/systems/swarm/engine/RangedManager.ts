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
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 3,
  /** ★ 补兵节拏（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 18, fast: 4 },
} as const;

export class RangedManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('ranged', mgr, creationOf, 3);
    this.replenishSlowS = RANGED_POLICY.REPLENISH.slow;
    this.replenishFastS = RANGED_POLICY.REPLENISH.fast;
  }

  /** ★ 驻守（用户定 2026-09-26）：**稳定驻守位**（不随位置重算 → 不绕圈）；无环时保持原保距行为 */
  assign(ctx: RoleCtx): number {
    this.ensureSquads(ctx.now);
    const p = ctx.pos.ship() ?? ctx.pos.player();   // ★ 舰为参照（用户定）
    if (!p) return 0;
    this.targets.clear();
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      const anch = this.anchorOfSquad(id, ctx);
      let t: { x: number; z: number };
      if (anch) {
        t = anch;
      } else {
        const dx = s.x - p.x, dz = s.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        t = { x: p.x + (dx / d) * RANGED_POLICY.STANDOFF, z: p.z + (dz / d) * RANGED_POLICY.STANDOFF };
      }
      this.targets.set(id, this.clampToRing(t, ctx));
    }
    this.dbg.assigned = this.targets.size;
    this.dbg.last = `assign=${this.targets.size}`;
    return this.targets.size;
  }
}
