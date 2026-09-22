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
  /** 观测（探针/诊断）：最近一次查询结果（calls = 总调用数，用于定位高频调用方） */
  readonly dbg = { calls: 0, ok: 0, blocked: 0, outside: 0 };
  /** 最近被拒样本（诊断：真不可达 vs 表/BFS 口径错） */
  readonly blockedRecent: { sx: number; sz: number; gx: number; gz: number }[] = [];

  setTable(t: PassTable | null): void {
    this.table = t;
  }

  /** 表是否就绪（阶段二加权路的前置判断用） */
  readyFor(): boolean {
    return !!this.table && this.table.ready;
  }

  /** 可行性 BFS（8 向；有向边位）。ok → out 填稀疏走廊（≤8 路点，含精确终点）。 */
  find(
    sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): 'ok' | 'blocked' | 'outside' {
    out.length = 0;
    this.dbg.calls++;
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
    // 回溯 → 贪心 LOS 拉直（读表校验；防 BFS 阶梯路点导致左右抽风/转圈）
    const cells: number[] = [];
    let c = gk;
    while (c >= 0) {
      cells.push(c);
      c = parent.get(c)!;
    }
    cells.reverse();
    const world = (cc: number): { x: number; z: number } => ({
      x: b.ox * CELL + (cc % side) * CELL + CELL / 2,
      z: b.oz * CELL + Math.floor(cc / side) * CELL + CELL / 2,
    });
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = cells.length - 1;
      while (next > anchor + 1 && !this.lineOk(t, b.ox, b.oz, side, cells[anchor], cells[next])) next--;
      out.push(world(cells[next]));
      anchor = next;
    }
    if (out.length > 0) out[out.length - 1] = { x: gx, z: gz };
    this.dbg.ok++;
    return 'ok';
  }

  /** 两格中心直线是否可走（Bresenham 逐格读表 canStep；方向感知） */
  private lineOk(
    t: PassTable, ox: number, oz: number, side: number, a: number, c: number,
  ): boolean {
    let ax = a % side, az = (a - ax) / side;
    const bx = c % side, bz = (c - bx) / side;
    const dx = Math.abs(bx - ax), dz = Math.abs(bz - az);
    const sx = ax < bx ? 1 : -1, sz = az < bz ? 1 : -1;
    let err = dx - dz;
    while (ax !== bx || az !== bz) {
      const e2 = 2 * err;
      let mx = 0, mz = 0;
      if (e2 > -dz) { err -= dz; mx = sx; ax += sx; }
      if (e2 < dx) { err += dx; mz = sz; az += sz; }
      const wx = (ox + ax - mx) * CELL + CELL / 2;
      const wz = (oz + az - mz) * CELL + CELL / 2;
      if (!t.canStep(wx, wz, mx, mz)) return false;
    }
    return true;
  }
}
