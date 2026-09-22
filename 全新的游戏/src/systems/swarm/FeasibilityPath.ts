// ============================================================
// FeasibilityPath —— 可行性寻路（《寻路与导航架构.md》§4 分工纪律）
// ============================================================
// 「两套寻路直接分开」之一：本模块**只保证路能走**——
//   · 代价恒 = 1（不做权重/偏好；那属于 WeightedPath，且只在队长侧）
//   · 边判定只读 PassTable 的有向边位（绝对墙禁 / 单向边只可下）
//   · 输出「可达性 + 可行走廊（稀疏路点，大队 coarse 用）」
// 大队门（命令核验）与小队寻路的底座都用它；表外/未就绪 → 'outside'（回落旧口径）。
// ============================================================

import type { PassTable } from './PassTable';

const CELL = 4;

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class FeasibilityPath {
  private table: PassTable | null = null;
  /** 观测（探针/诊断）：最近一次查询结果 */
  readonly dbg = { ok: 0, blocked: 0, outside: 0 };
  /** 最近被拒样本（诊断：真不可达 vs 表/BFS 口径错） */
  readonly blockedRecent: { sx: number; sz: number; gx: number; gz: number }[] = [];

  setTable(t: PassTable | null): void {
    this.table = t;
  }

  /** 可行性 BFS（8 向；有向边位）。ok → out 填稀疏走廊（≤8 路点，含精确终点）。 */
  find(
    sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): 'ok' | 'blocked' | 'outside' {
    out.length = 0;
    const t = this.table;
    if (!t || !t.ready) { this.dbg.outside++; return 'outside'; }
    const b = t.bounds();
    const side = b.side;
    const scx = Math.floor(sx / CELL), scz = Math.floor(sz / CELL);
    const gcx = Math.floor(gx / CELL), gcz = Math.floor(gz / CELL);
    const inWin = (cx: number, cz: number): boolean => {
      const ix = cx - b.ox, iz = cz - b.oz;
      return ix >= 0 && iz >= 0 && ix < side && iz < side;
    };
    if (!inWin(scx, scz) || !inWin(gcx, gcz)) { this.dbg.outside++; return 'outside'; }
    const key = (cx: number, cz: number): number => (cz - b.oz) * side + (cx - b.ox);
    const sk = key(scx, scz);
    const gk = key(gcx, gcz);
    if (sk === gk) { out.push({ x: gx, z: gz }); this.dbg.ok++; return 'ok'; }
    const parent = new Map<number, number>();
    const queue: number[] = [sk];
    parent.set(sk, -1);
    let head = 0;
    let found = false;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === gk) { found = true; break; }
      const cx = b.ox + (cur % side), cz = b.oz + Math.floor(cur / side);
      const wx = cx * CELL + CELL / 2, wz = cz * CELL + CELL / 2;
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!inWin(nx, nz)) continue;
        const nk = (nz - b.oz) * side + (nx - b.ox);
        if (parent.has(nk)) continue;
        if (!t.canStep(wx, wz, dx, dz)) continue;   // 有向边位：绝对墙/单向逆穿在此拒绝
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
    if (!found) {
      this.dbg.blocked++;
      if (this.blockedRecent.length >= 8) this.blockedRecent.shift();
      this.blockedRecent.push({ sx: +sx.toFixed(0), sz: +sz.toFixed(0), gx: +gx.toFixed(0), gz: +gz.toFixed(0) });
      return 'blocked';
    }
    // 回溯 → 稀疏路点（≤8，起点前列不输出，含精确终点）
    const cells: number[] = [];
    let c = gk;
    while (c >= 0) {
      cells.push(c);
      c = parent.get(c)!;
    }
    cells.reverse();
    const stride = Math.max(1, Math.ceil(cells.length / 8));
    for (let k = 1; k < cells.length; k += stride) {
      const cc = cells[k];
      out.push({
        x: b.ox * CELL + (cc % side) * CELL + CELL / 2,
        z: b.oz * CELL + Math.floor(cc / side) * CELL + CELL / 2,
      });
    }
    out.push({ x: gx, z: gz });
    this.dbg.ok++;
    return 'ok';
  }
}
