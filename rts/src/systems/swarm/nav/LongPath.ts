// ============================================================
// FeasibilityPath —— 可行性寻路（《RTS架构.md》§4 分工纪律）
// ============================================================
// 「两套寻路直接分开」之一：本模块**只保证路能走**——
//   · 代价恒 = 1（不做权重/偏好；那属于 WeightedPath，且只在队长侧）
//   · 边判定只读 PassTable 的有向边位（绝对墙禁 / 单向边只可下）
//   · 输出「可达性 + 可行走廊（稀疏路点，大队 coarse 用）」
// 大队门（命令核验）与小队寻路的底座都用它；表外/未就绪 → 'outside'（回落旧口径）。
// ============================================================

import type { PassTable } from './PassTable';
import { viaClimbPoints } from './ClimbVia';
import { LOCAL } from './LocalStep';   // ★ S2：段长口径与短寻路同源（≤LOCAL.SEG_MAX）

const CELL = 4;

/** ★ 最近一次 lineOk 段是否含爬坡位（模块级 scratch；避免分配） */
let _segClimb = false;

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
  /** ★ 加权搜索 scratch（dist/gen 按表尺寸复用；二叉堆复用数组）
   *  dist 必须 f64：惰性删除比较 `popCost > dist[cur]` 若 f32 舍入会误杀有效节点（假 blocked） */
  private dist = new Float64Array(0);
  private gen = new Uint32Array(0);
  private stamp = 0;
  private readonly hKey: number[] = [];
  private readonly hCost: number[] = [];
  private popCost = 0;

  setTable(t: PassTable | null): void {
    this.table = t;
  }

  /** 表是否就绪（阶段二加权路的前置判断用） */
  readyFor(): boolean {
    return !!this.table && this.table.ready;
  }

  /** 表高（短跳坡度加价用；表外/未就绪 → NaN） */
  heightAt(x: number, z: number): number {
    const t = this.table;
    return t && t.ready ? t.heightAt(x, z) : NaN;
  }

  private hPush(k: number, c: number): void {
    const K = this.hKey, C = this.hCost;
    K.push(k); C.push(c);
    let i = K.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (C[p] <= C[i]) break;
      const tk = K[p], tc = C[p];
      K[p] = K[i]; C[p] = C[i];
      K[i] = tk; C[i] = tc;
      i = p;
    }
  }

  private hPop(): number {
    const K = this.hKey, C = this.hCost;
    const top = K[0];
    this.popCost = C[0];
    const lastK = K.pop()!;
    const lastC = C.pop()!;
    const n = K.length;
    if (n > 0) {
      K[0] = lastK; C[0] = lastC;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && C[l] < C[m]) m = l;
        if (r < n && C[r] < C[m]) m = r;
        if (m === i) break;
        const tk = K[m], tc = C[m];
        K[m] = K[i]; C[m] = C[i];
        K[i] = tk; C[i] = tc;
        i = m;
      }
    }
    return top;
  }

  /** 线段可走（2m 采样；有向边位）——贪心段候选过滤用 */
  walkableLine(ax: number, az: number, bx: number, bz: number): boolean {
    const t = this.table;
    if (!t || !t.ready) return false;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 2));
    let px = ax, pz = az;
    for (let k = 1; k <= n; k++) {
      const q = k / n;
      const x = ax + (bx - ax) * q, z = az + (bz - az) * q;
      const dx = x - px, dz = z - pz;
      const sx = Math.abs(dx) < 0.4 ? 0 : (dx > 0 ? 1 : -1);
      const sz = Math.abs(dz) < 0.4 ? 0 : (dz > 0 ? 1 : -1);
      if (sx !== 0 || sz !== 0) {
        if (!t.canStep(px, pz, sx, sz)) return false;
        // ★ 上坡必须横平竖直：斜向采样步只许平/下坡
        if (sx !== 0 && sz !== 0) {
          const h0 = t.heightAt(px, pz);
          const h1 = t.heightAt(x, z);
          if (h1 > h0) return false;
        }
      }
      px = x; pz = z;
    }
    return true;
  }

  /** 可行性 BFS（8 向；有向边位）。ok → out 填稀疏走廊（≤8 路点，含精确终点）。
   *  ★ 爬坡位（用户定 2026-09-24）：路点带 `climb` = "到此点必须程序化爬坡"（坡面净升超阈值）。 */
  find(
    sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number; climb?: boolean }[],
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
    // ★ 爬山/涉水优化（2026-09-24）：恒权 BFS → **坡度/涉水加权 Dijkstra**（可达性语义不变）：
    //   上坡（drop>0）加价 0.6/米 → 偏好缓坡/垭口；涉水格加价 0.35（可走，只是稍贵）；斜向 ×1.414。
    const n = side * side;
    if (this.dist.length !== n) {
      this.dist = new Float64Array(n);
      this.gen = new Uint32Array(n);
    }
    const dist = this.dist, gen = this.gen, stamp = ++this.stamp;
    // A* 启发（八向 octile；最小步价 1 → 可采纳，不改变最优性/可达性）
    const hOf = (k: number): number => {
      const cx = b.ox + (k % side), cz = b.oz + Math.floor(k / side);
      const ax = Math.abs(cx - gcx), az = Math.abs(cz - gcz);
      return Math.max(ax, az) + 0.4142 * Math.min(ax, az);
    };
    const parent = new Map<number, number>();
    this.hKey.length = 0;
    this.hCost.length = 0;
    gen[sk] = stamp;
    dist[sk] = 0;
    parent.set(sk, -1);
    this.hPush(sk, hOf(sk));
    let found = false;
    while (this.hKey.length > 0) {
      const cur = this.hPop();
      if (this.popCost - hOf(cur) > dist[cur] + 1e-9) continue;   // 惰性删除：过期堆项
      if (cur === gk) { found = true; break; }
      const cx = b.ox + (cur % side), cz = b.oz + Math.floor(cur / side);
      const wx = cx * CELL + CELL / 2, wz = cz * CELL + CELL / 2;
      const cc = dist[cur];
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!inWin(nx, nz)) continue;
        if (!t.canStep(wx, wz, dx, dz)) continue;   // 有向边位：绝对墙/单向逆穿在此拒绝
        // ★ 上坡必须横平竖直（用户定 2026-09-24）：斜向只许平/下坡——
        //   表只校 E/W/S/N 四向边；斜向"两轴都开"不等于斜线本身可走（可能切到折面/脊）。
        if (dx !== 0 && dz !== 0) {
          const h0 = t.heightAt(wx, wz);
          const h1 = t.heightAt(wx + dx * CELL, wz + dz * CELL);
          if (h1 > h0) continue;
        }
        const nk = (nz - b.oz) * side + (nx - b.ox);
        let c = (dx !== 0 && dz !== 0) ? 1.414 : 1;
        const drop = t.dropAt(wx, wz, dx, dz);
        if (drop > 0) c += drop * 0.6;   // 上坡加价（爬坡偏好缓线）；★ 水=正常地块（无涉水加价）
        const nd = cc + c;
        if (gen[nk] !== stamp || nd < dist[nk]) {
          gen[nk] = stamp;
          dist[nk] = nd;
          parent.set(nk, cur);
          this.hPush(nk, nd + hOf(nk));
        }
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
      const wp = world(cells[next]) as { x: number; z: number; climb?: boolean };
      wp.climb = _segClimb;   // ★ 该段是否含爬坡位（lineOk 内顺带检测）
      out.push(wp);
      anchor = next;
    }
    if (out.length > 0) out[out.length - 1] = { x: gx, z: gz };
    // ★ 派令侧爬坡几何（用户定 2026-09-26）：**细采样**找真实跨坡处 → 插
    //   ① 该连续坡的**中间上坡点**（段中心、坡面前 1m）② 跨坡点（★）——任何情况先走中间上坡点。
    {
      const withClimbs = viaClimbPoints(t, sx, sz, out);
      out.length = 0;
      for (const q of withClimbs) out.push(q);
    }
    // ★ S2（用户定 2026-09-25）：**加密**——每段 ≤LOCAL.SEG_MAX，逐段过表（可执行）+ 逐段 climb，
    //   执行层（Anchor.routeNext）按 ≤10m 路点推进即可逐步绕行；不加密则远路点会被"直线化"。
    if (out.length > 0 && LOCAL.SEG_MAX > 0) {
      const dense: { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number } }[] = [];
      let ax = sx, az = sz;
      for (const wp of out) {
        const d = Math.hypot(wp.x - ax, wp.z - az);
        const n = Math.max(1, Math.ceil(d / LOCAL.SEG_MAX));
        let px = ax, pz = az;
        for (let k = 1; k <= n; k++) {
          const q = k / n;
          const x = ax + (wp.x - ax) * q, z = az + (wp.z - az) * q;
          // ★ 加密终点沿用源路点的 climb/climbPt（viaClimbPoints 插的跨坡点带凭证点；
          //   climbAlong 只回标志，若在新对象上重算会把 climbPt 丢掉 → 凭证点丢失）
          if (k === n && wp.climb === true) {
            dense.push({ x, z, climb: true, climbPt: (wp as { climbPt?: { x: number; z: number; ux: number; uz: number } }).climbPt });
          } else {
            dense.push({ x, z, climb: this.climbAlong(px, pz, x, z) });
          }
          px = x; pz = z;
        }
        ax = wp.x; az = wp.z;
      }
      const tailClimb = dense.length > 0 ? dense[dense.length - 1]!.climb : false;
      out.length = 0;
      for (const p of dense) out.push(p);
      if (out.length > 0) out[out.length - 1] = { x: gx, z: gz, climb: tailClimb };
    }
    this.dbg.ok++;
    return 'ok';
  }

  /** ★ S2：沿段爬坡标注（2m 采样；与 canSegment 同口径）——进入该点所经段是否需程序化爬坡 */
  private climbAlong(ax: number, az: number, bx: number, bz: number): boolean {
    const t = this.table;
    if (!t || !t.ready) return false;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 2));
    let px = ax, pz = az;
    for (let k = 1; k <= n; k++) {
      const q = k / n;
      const x = ax + (bx - ax) * q, z = az + (bz - az) * q;
      const dx = x - px, dz = z - pz;
      const sx = Math.abs(dx) < 0.4 ? 0 : (dx > 0 ? 1 : -1);
      const sz = Math.abs(dz) < 0.4 ? 0 : (dz > 0 ? 1 : -1);
      if ((sx !== 0 || sz !== 0) && t.climbAt(px, pz, sx, sz)) return true;
      px = x; pz = z;
    }
    return false;
  }

  /** 两格中心直线是否可走（Bresenham 逐格读表 canStep；方向感知） */
  private lineOk(
    t: PassTable, ox: number, oz: number, side: number, a: number, c: number,
  ): boolean {
    _segClimb = false;
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
      if (!_segClimb && t.climbAt(wx, wz, mx, mz)) _segClimb = true;   // ★ 顺带标爬坡位
      // ★ 上坡必须横平竖直：斜向步只许平/下坡（拉直不得在上坡段切斜线）
      if (mx !== 0 && mz !== 0) {
        const h0 = t.heightAt(wx, wz);
        const h1 = t.heightAt(wx + mx * CELL, wz + mz * CELL);
        if (h1 > h0) return false;
      }
    }
    return true;
  }
}
