// ============================================================
// engine/MeleeManager —— 近战兵管理器（重写 P3；用户定）
// ============================================================
// 策略：前排 / 压上 / 缠斗。目标 = 朝玩家方向**压到接敌距离**（不贴脸）。
// 编成与刷怪走基类；位置只从 Positions 单源取；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 近战策略参数（集中可调） */
export const MELEE_POLICY = {
  /** 接敌距离（米）：压到离玩家这么近就停（挥击由战斗原子接管） */
  ENGAGE: 12,
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 6,
  /** ★ 补兵节拏（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 15, fast: 3 },
} as const;

export class MeleeManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('melee', mgr, creationOf, 6);
    this.replenishSlowS = MELEE_POLICY.REPLENISH.slow;
    this.replenishFastS = MELEE_POLICY.REPLENISH.fast;
  }

  /** ★ 战术分工（用户定 2026-09-26；下令在引擎，事态作变量）：
   *  · 高事态（总攻）→ **冲锋**：目标 = 玩家 - ENGAGE（不再沿环）
   *  · 低事态 + 工兵在旁 → **护卫**：目标 = 工兵向舰侧偏 6m（挡在工兵前）
   *  · 其余 → **驻锚**（稳定锚位，防绕圈） */
  assign(ctx: RoleCtx): number {
    this.ensureSquads(ctx.now);
    const p = ctx.pos.ship() ?? ctx.pos.player();   // ★ 全部行动以舰为参照（用户定 2026-09-26）
    if (!p) return 0;
    this.targets.clear();
    const posture = ctx.posture ?? 0;
    const engs = ctx.engineers ?? [];
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      let t: { x: number; z: number };
      if (posture >= 0.8 || ctx.ringMax <= 0) {
        // 冲锋（总攻）/无环：压到接敌距离
        const dx = p.x - s.x, dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        const stop = Math.max(0, d - MELEE_POLICY.ENGAGE);
        t = d > 1e-3 ? { x: s.x + (dx / d) * stop, z: s.z + (dz / d) * stop } : { x: s.x, z: s.z };
      } else {
        // 护卫：最近工兵向舰侧 6m
        let best: { x: number; z: number } | null = null;
        let bd = 60;
        for (const e of engs) {
          const d = Math.hypot(e.x - s.x, e.z - s.z);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          // ★ 护卫不受环夹（保护优先；夹环会把它拉离工兵）
          const dx = p.x - best.x, dz = p.z - best.z;
          const dl = Math.hypot(dx, dz) || 1;
          this.targets.set(id, { x: best.x + (dx / dl) * 6, z: best.z + (dz / dl) * 6 });
          continue;
        } else {
          t = this.anchorOfSquad(id, ctx) ?? { x: s.x, z: s.z };
        }
      }
      this.targets.set(id, this.clampToRing(t, ctx));
    }
    this.dbg.assigned = this.targets.size;
    this.dbg.last = `assign=${this.targets.size}`;
    return this.targets.size;
  }
}
