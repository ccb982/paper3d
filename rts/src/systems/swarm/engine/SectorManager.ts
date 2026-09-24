// ============================================================
// engine/SectorManager.ts —— 扇形防区管理器（重写 P3；用户定 2026-09-24）
// ============================================================
// 引擎的防区大脑：把玩家周围的环形活动区切成扇区，按时查三件事：
//   · 安全度：很安全 → 把小队调到别的防区（不挤一堆）
//   · 在编：小队被回收/被收走 → 补派（告诉相应兵种管理器"补几队"）
//   · 情况：需要工事 → 派工兵小队（分区数据交 EngineerManager）
// 只读单源（Positions/SquadManager）；纯逻辑 → 可独立自检。
// ============================================================

export interface Sector {
  id: number;
  /** 扇区中角（弧度） */
  ang: number;
  /** 当前归属小队 */
  squads: number[];
  /** 安全度 0~1（越高越安全；由事态函数写） */
  safety: number;
}

export class SectorManager {
  private readonly sectors: Sector[] = [];
  /** 探针契约（G9） */
  readonly dbg = { sectors: 0, safe: 0, empty: 0, refill: 0, last: '' };

  /** 建区：按环切 n 个扇区（引擎初始化/换落点时调） */
  build(n: number): void {
    this.sectors.length = 0;
    for (let i = 0; i < n; i++) {
      this.sectors.push({ id: i, ang: (i / n) * Math.PI * 2, squads: [], safety: 0.5 });
    }
    this.dbg.sectors = n;
  }

  /** 每拍：各队归到最近扇区（按队长位置与环心的夹角）+ 统计空区 */
  tick(leaderOf: (id: number) => { x: number; z: number } | null, px: number, pz: number, ids: readonly number[]): void {
    const n = this.sectors.length;
    if (n === 0) return;
    for (const s of this.sectors) s.squads.length = 0;
    for (const id of ids) {
      const p = leaderOf(id);
      if (!p) continue;
      const ang = Math.atan2(p.z - pz, p.x - px);
      let best = 0;
      let bd = Infinity;
      for (const s of this.sectors) {
        let d = Math.abs(ang - s.ang);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < bd) {
          bd = d;
          best = s.id;
        }
      }
      this.sectors[best].squads.push(id);
    }
    let empty = 0;
    for (const s of this.sectors) if (s.squads.length === 0) empty++;
    this.dbg.empty = empty;
    this.dbg.last = `n=${ids.length} empty=${empty}`;
  }

  setSafety(id: number, s: number): void {
    const sec = this.sectors[id];
    if (sec) sec.safety = Math.max(0, Math.min(1, s));
  }

  safetyOf(id: number): number {
    return this.sectors[id]?.safety ?? 0;
  }

  /** 很安全的区（调区依据：把队挪走） */
  safeSectors(threshold: number): number[] {
    const out: number[] = [];
    for (const s of this.sectors) if (s.safety >= threshold && s.squads.length > 0) out.push(s.id);
    this.dbg.safe = out.length;
    return out;
  }

  /** 空区（补派依据） */
  emptySectors(): number[] {
    return this.sectors.filter((s) => s.squads.length === 0).map((s) => s.id);
  }

  /** 补派数：该区离"期望队数"还差几队（引擎拿去让兵种管理器刷） */
  refillOf(id: number, want: number): number {
    const n = Math.max(0, want - (this.sectors[id]?.squads.length ?? 0));
    if (n > 0) this.dbg.refill += n;
    return n;
  }

  /** 某队属于哪个扇区（-1 = 无） */
  sectorOf(squadId: number): number {
    for (const s of this.sectors) if (s.squads.includes(squadId)) return s.id;
    return -1;
  }

  /** 扇区中心点（给定半径；调区目标点） */
  centerOf(id: number, cx: number, cz: number, r: number): { x: number; z: number } {
    const a = this.sectors[id]?.ang ?? 0;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  }

  clear(): void {
    this.sectors.length = 0;
    this.dbg.sectors = 0;
  }
}
