// ============================================================
// engine/Positions —— 位置信息单源（重写 P3；用户定 2026-09-24）
// ============================================================
// 引擎统一提供：**玩家 / 舰船 / 各小队队长**（后续可加祖宗/友军）。
// 铁律 G4：小队与各管理器**只从这里取位置**（禁各自扫世界）。
// 纯数据（无 three/无 services）→ 可独立自检（scripts/engine-selftest.ts）。
// ============================================================

export interface Pt {
  x: number;
  z: number;
}

export class Positions {
  private px = 0;
  private pz = 0;
  private hasPlayer = false;
  private sx = 0;
  private sz = 0;
  private hasShip = false;
  private readonly squads = new Map<number, Pt>();
  /** 探针契约（G9） */
  readonly dbg = { squads: 0, player: false, ship: false, updates: 0, last: '' };

  setPlayer(x: number, z: number): void {
    this.px = x;
    this.pz = z;
    this.hasPlayer = true;
    this.dbg.player = true;
    this.dbg.updates++;
  }

  player(): Pt | null {
    return this.hasPlayer ? { x: this.px, z: this.pz } : null;
  }

  setShip(x: number, z: number): void {
    this.sx = x;
    this.sz = z;
    this.hasShip = true;
    this.dbg.ship = true;
    this.dbg.updates++;
  }

  ship(): Pt | null {
    return this.hasShip ? { x: this.sx, z: this.sz } : null;
  }

  /** 小队队长位置（引擎每拍/汇报时写入） */
  setSquad(id: number, x: number, z: number): void {
    this.squads.set(id, { x, z });
    this.dbg.squads = this.squads.size;
  }

  squad(id: number): Pt | null {
    return this.squads.get(id) ?? null;
  }

  removeSquad(id: number): void {
    this.squads.delete(id);
    this.dbg.squads = this.squads.size;
  }

  /** 统一查询器（Protect.refresh 等消费；不泄漏内部 Map） */
  squadOf = (id: number): Pt | null => this.squads.get(id) ?? null;

  /** 距某点的最近小队（目标分配用；-1 = 无） */
  nearestSquad(x: number, z: number, except?: Set<number>): number {
    let best = -1;
    let bd = Infinity;
    for (const [id, p] of this.squads) {
      if (except?.has(id)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  clear(): void {
    this.squads.clear();
    this.hasPlayer = false;
    this.hasShip = false;
    this.dbg.squads = 0;
    this.dbg.player = false;
    this.dbg.ship = false;
  }
}
