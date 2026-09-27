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
      // ★ 总攻（用户定）：集体进攻舰船——压到舰旁 STANDOFF 保距（到位开火）
      const assault = (ctx.posture ?? 0) >= 0.8 || (ctx.ringMax > 0 && ctx.ringMax <= 30);   // ★ 与 P_ASSAULT=0.80 同口径
      const adv = assault ? null : this.advanceTarget(id, s, ctx);
      // ★ 掩体配对（用户定 2026-09-26）：**已到位后优先躲敌方掩体**——
      //   藏点 = 掩体背向玩家 1.6m（玩家子弹被掩体挡；敌弹可穿自家掩体——BulletEntity 已约定）。
      let hide: { x: number; z: number } | null = null;
      const covers = ctx.covers ?? [];
      if (!assault && covers.length > 0) {
        const th = ctx.pos.player() ?? p;
        let bd = Infinity;
        for (const c of covers) {
          const dxc = c.x - th.x, dzc = c.z - th.z;
          const dc = Math.hypot(dxc, dzc) || 1;
          const hx = c.x + (dxc / dc) * 1.6, hz = c.z + (dzc / dc) * 1.6;
          const ds = Math.hypot(hx - s.x, hz - s.z);
          if (ds < bd) { bd = ds; hide = { x: hx, z: hz }; }
        }
      }
      let t: { x: number; z: number };
      if (assault) {
        const dx = s.x - p.x, dz = s.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        t = { x: p.x + (dx / d) * RANGED_POLICY.STANDOFF, z: p.z + (dz / d) * RANGED_POLICY.STANDOFF };
      } else if (adv && (adv.x !== s.x || adv.z !== s.z)) {
        t = adv;                  // 尚未到前沿 → 继续推进
      } else if (hide) {
        t = hide;                 // 已到位/无推进目标 → 躲掩体
      } else if (adv) {
        t = adv;                  // = 自身（驻守）
      } else if (ctx.frontOf) {
        t = { x: s.x, z: s.z };   // 正式接线且无点 → 站住
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
