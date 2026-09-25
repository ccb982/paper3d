// ============================================================
// RosterController —— 编制比例（《RTS架构.md》§13.1）
// ============================================================
// 场上各兵种要有合理占比；某类占比低了 → 下一次补兵时优先补（本模块只统计与给缺口，
// 补充动作走 CommanderSpawn/回收名单通道）。纯统计，不改行为。
// 口径：成员级（存活 hp>0）；工兵按 squad.builders 归 'builder'，其余按队型。
// ============================================================

/** 编制角色（统计口径） */
export type RosterRole = 'shield' | 'assault' | 'ranged' | 'logistics' | 'builder' | 'other';

/** 目标占比（初值；调参入口） */
export const ROSTER_TARGET: Record<RosterRole, number> = {
  shield: 0.20, assault: 0.34, ranged: 0.20, logistics: 0.12, builder: 0.14, other: 0,
};

interface SquadLike {
  type: string;
  builders: boolean;
  members: Map<number, { hp: number }>;
}

export class RosterController {
  readonly counts: Record<RosterRole, number> = {
    shield: 0, assault: 0, ranged: 0, logistics: 0, builder: 0, other: 0,
  };
  /** 探针输出（每拍刷新） */
  readonly dbg = { total: 0, gap: '-' as RosterRole | '-', gapVal: 0 };
  private accum = 0;

  /** 4Hz 拍统计（存活成员按角色归类） */
  tick(dt: number, squads: { all(): IterableIterator<SquadLike> }): void {
    this.accum += dt;
    if (this.accum < 0.25) return;
    this.accum = 0;
    const c = this.counts;
    c.shield = 0; c.assault = 0; c.ranged = 0; c.logistics = 0; c.builder = 0; c.other = 0;
    for (const s of squads.all()) {
      let alive = 0;
      for (const m of s.members.values()) if (m.hp > 0) alive++;
      if (alive === 0) continue;
      const role: RosterRole = s.builders ? 'builder'
        : s.type === 'defense' ? 'shield'
          : s.type === 'assault' ? 'assault'
            : s.type === 'ranged' ? 'ranged'
              : s.type === 'logistics' ? 'logistics' : 'other';
      c[role] += alive;
    }
    const total = c.shield + c.assault + c.ranged + c.logistics + c.builder;
    this.dbg.total = total;
    let gap: RosterRole | '-' = '-';
    let gapVal = 0;
    if (total > 0) {
      for (const r of ['shield', 'assault', 'ranged', 'logistics', 'builder'] as RosterRole[]) {
        const want = ROSTER_TARGET[r] * total;
        const rel = (want - c[r]) / Math.max(1, want);   // 相对缺口
        if (rel > gapVal) { gapVal = rel; gap = r; }
      }
      if (gapVal < 0.15) { gap = '-'; gapVal = 0; }   // 相对缺口 <15% 视为达标
    }
    this.dbg.gap = gap;
    this.dbg.gapVal = +gapVal.toFixed(2);
  }
}
