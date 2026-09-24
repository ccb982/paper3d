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
} as const;

export class MeleeManager extends RoleManager {
  constructor(mgr: SquadManager) {
    super('melee', mgr);
  }

  /** 压上：目标 = 玩家 + (本队→玩家方向) × (距离−ENGAGE)，再夹进环 */
  assign(ctx: RoleCtx): number {
    const p = ctx.pos.player();
    if (!p) return 0;
    this.targets.clear();
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      const stop = Math.max(0, d - MELEE_POLICY.ENGAGE);
      const t = d > 1e-3
        ? { x: s.x + (dx / d) * stop, z: s.z + (dz / d) * stop }
        : { x: s.x, z: s.z };
      this.targets.set(id, this.clampToRing(t, ctx));
    }
    this.dbg.assigned = this.targets.size;
    this.dbg.last = `assign=${this.targets.size}`;
    return this.targets.size;
  }
}
