// ============================================================
// engine/FlyerManager —— 飞天管理器（重写 P3；用户定）
// ============================================================
// 策略：空中层 / 轰炸航线。目标 = 玩家上空的航线点（2D 目标；高度由空中层负责）。
// 位置只从 Positions 单源取；不越权管地面兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 飞天策略参数（集中可调） */
export const FLYER_POLICY = {
  /** 轰炸航线半径（米）：绕玩家转的圈 */
  ORBIT: 10,
  /** 航线点数（每队一个相位，避免重叠） */
  LANES: 4,
  /** ★ 每防区目标人数（按占比配置；补到满编） */
  UNITS_PER_SECTOR: 3,
  /** ★ 补兵节拏（秒；事态驱动 slow→fast） */
  REPLENISH: { slow: 20, fast: 5 },
} as const;

export class FlyerManager extends RoleManager {
  constructor(mgr: SquadManager, creationOf?: () => import('./SquadCreation').CreationPort | null) {
    super('flyer', mgr, creationOf, 3);
    this.replenishSlowS = FLYER_POLICY.REPLENISH.slow;
    this.replenishFastS = FLYER_POLICY.REPLENISH.fast;
  }

  /** 航线：目标 = 玩家 + 本队相位对应的航线点，再夹进环 */
  assign(ctx: RoleCtx): number {
    this.ensureSquads(ctx.now);
    const p = ctx.pos.ship() ?? ctx.pos.player();   // ★ 舰为参照（用户定）
    if (!p) return 0;
    this.targets.clear();
    let k = 0;
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (s) {
        const advF = this.advanceTarget(id, s, ctx);
        if (advF) { this.targets.set(id, this.clampToRing(advF, ctx)); k++; continue; }
      }
      const lane = k % FLYER_POLICY.LANES;
      k++;
      const ang = (lane / FLYER_POLICY.LANES) * Math.PI * 2;
      const t = {
        x: p.x + Math.cos(ang) * FLYER_POLICY.ORBIT,
        z: p.z + Math.sin(ang) * FLYER_POLICY.ORBIT,
      };
      this.targets.set(id, this.clampToRing(t, ctx));
    }
    this.dbg.assigned = this.targets.size;
    this.dbg.last = `assign=${this.targets.size}`;
    return this.targets.size;
  }
}
