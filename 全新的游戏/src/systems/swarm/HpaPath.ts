// ============================================================
// HpaPath —— HPA* 全局寻路（簇 + 端口图；《敌人管线设计.md》§5）
// ============================================================
// 为什么需要：`SquadPath` 是**有界 A***（窗口 = 起终包围盒 + 边距），
//   遇到大湖/长墙/绕远地形会退化成直线 → 卡住（"找不到玩家"）。
// HPA* 把地图切成 32m 簇：簇内可通行性 + 边界"端口"（可通行段）；
//   查询时只在**端口图**上跑 A*（节点数远小于格数），再按簇拼出完整折线。
//
// 缓存：簇结构（高度/可通行/端口/簇内 BFS 距离）懒构建，
//   TTL 20s（地形被挖改后最多 20s 内自动重建；寻路失败也会触发重试）。
// 降级：包围盒超限 / A* 超迭代 / 无解 → 返回 false，调用方回落 SquadPath/直线。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { samplerFor } from '../../services/map/TerrainSampler';
import { WALL_DH } from './TerrainScore';
import { DANGER } from './SwarmDanger';

const CELL = 4;
/** 簇边长（格；8×8 = 32m） */
const CL = 8;
const CLC = CL * CL;
/** 相邻格高差上限（米；超过 = 墙，不可跨越）——★ 执行层同口径（≈32°；=SwarmDanger.CELL_RISE_MAX）。
 *  旧值 0.8（20%）过严：细路径拉直遇正常山坡即拒，路径碎、绕远。 */
const RISE_MAX = DANGER.CELL_RISE_MAX;
/** 簇缓存有效期（毫秒；地形变更后的最坏陈旧时间） */
const TTL_MS = 20000;
/** 查询包围盒每边最大簇数（超出 = 太远，回落） */
const MAX_BOX = 24;
/** A* 迭代上限 */
const MAX_ITER = 8000;
/** 单次查询最多新建的簇数（防冷启动一次卡帧；没建完 → 本次失败，下一拍重试） */
const BUILD_BUDGET = 12;

interface Portal {
  /** 全局边键（同一条边界段两侧共享 → 跨簇天然同节点） */
  edge: string;
  /** 本簇内格索引 */
  cell: number;
  /** 世界坐标（中点） */
  x: number;
  z: number;
}

interface Cluster {
  /** 簇原点（全局格坐标） */
  gx0: number;
  gz0: number;
  h: Float32Array;
  pass: Uint8Array;
  portals: Portal[];
  builtAt: number;
  /** 簇内 BFS 距离缓存（起点格索引 → 距离场，单位 = 格） */
  intra: Map<number, Float32Array>;
}

interface NodeOcc { cluster: Cluster; cell: number }
interface Node { x: number; z: number; occ: NodeOcc[] }
interface Came { key: string; cluster: Cluster; fromCell: number; toCell: number }

function edgeKey(ax: number, az: number, bx: number, bz: number): string {
  return ax < bx || (ax === bx && az <= bz)
    ? `${ax},${az}|${bx},${bz}`
    : `${bx},${bz}|${ax},${az}`;
}

const START = '@s';
const GOAL = '@g';

export class HpaPath {
  private readonly clusters = new Map<string, Cluster>();
  private nowMs = 0;
  /** ★ 掩体/战壕寻路折扣（0.6~1；所有地面敌人共用；飞行不接线） */
  pathMul: ((x: number, z: number) => number) | null = null;
  private buildBudget = 0;
  private queryStart = 0;
  private warmCursor = 0;
  /** 最近一次查询分项耗时（调试/压测） */
  readonly lastPerf = { build: 0, astar: 0, emit: 0, nodes: 0 };

  /** ★ 每帧预热：以 (x,z) 为中心由近到远补簇（每帧最多 n 个，开销摊到多帧） */
  warmup(raster: RasterMap, x: number, z: number, n = 3): void {
    this.nowMs = performance.now();
    const ccx = Math.floor(x / CELL / CL), ccz = Math.floor(z / CELL / CL);
    const R = 8;
    const side = 2 * R + 1;
    const total = side * side;
    let built = 0;
    for (let i = 0; i < total && built < n; i++) {
      const idx = (this.warmCursor + i) % total;
      const ox = (idx % side) - R;
      const oz = Math.floor(idx / side) - R;
      const key = `${ccx + ox},${ccz + oz}`;
      const old = this.clusters.get(key);
      if (old && this.nowMs - old.builtAt < TTL_MS) continue;
      this.buildBudget = 1;
      this.clusterOf(raster, ccx + ox, ccz + oz);
      built++;
    }
    this.warmCursor = (this.warmCursor + 17) % total;
  }

  /** 是否处于"簇预热中"（本次没建完 → 调用方可安排下一拍重试） */
  get warming(): boolean {
    return this.buildBudget <= 0;
  }

  /** 查询：成功则把 waypoint（不含起点、含精确目标）写入 out */
  find(
    raster: RasterMap, sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): boolean {
    out.length = 0;
    this.nowMs = performance.now();
    this.queryStart = this.nowMs;
    this.buildBudget = BUILD_BUDGET;
    const sgx = Math.floor(sx / CELL), sgz = Math.floor(sz / CELL);
    const ggx = Math.floor(gx / CELL), ggz = Math.floor(gz / CELL);
    const scx = Math.floor(sgx / CL), scz = Math.floor(sgz / CL);
    const gcx = Math.floor(ggx / CL), gcz = Math.floor(ggz / CL);
    const x0 = Math.min(scx, gcx) - 1, x1 = Math.max(scx, gcx) + 1;
    const z0 = Math.min(scz, gcz) - 1, z1 = Math.max(scz, gcz) + 1;
    if (x1 - x0 > MAX_BOX || z1 - z0 > MAX_BOX) return false;

    // ---- 簇构建（懒 + TTL） ----
    const startCluster = this.clusterOf(raster, scx, scz);
    const goalCluster = this.clusterOf(raster, gcx, gcz);
    if (!startCluster || !goalCluster) return false;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) this.clusterOf(raster, cx, cz);
    }
    const sCell = this.cellOf(startCluster, sgx, sgz);
    const gCell = this.cellOf(goalCluster, ggx, ggz);
    if (sCell < 0 || gCell < 0) return false;
    this.lastPerf.build = performance.now() - this.queryStart;

    // 同簇：直接簇内回溯（无端口开销）
    if (startCluster === goalCluster) {
      const d = this.intra(startCluster, sCell)[gCell];
      if (Number.isFinite(d)) {
        this.emitHops([{ cluster: startCluster, from: sCell, to: gCell }], gx, gz, out);
        return out.length > 0;
      }
    }

    // ---- 端口图节点（边键 → 两侧簇的出现位置；跨簇同节点） ----
    const nodes = new Map<string, Node>();
    const addOcc = (key: string, x: number, z: number, cluster: Cluster, cell: number): void => {
      let n = nodes.get(key);
      if (!n) { n = { x, z, occ: [] }; nodes.set(key, n); }
      n.occ.push({ cluster, cell });
    };
    nodes.set(START, { x: sx, z: sz, occ: [{ cluster: startCluster, cell: sCell }] });
    nodes.set(GOAL, { x: gx, z: gz, occ: [{ cluster: goalCluster, cell: gCell }] });
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cl = this.clusterOf(raster, cx, cz);
        if (!cl) continue;
        for (const p of cl.portals) addOcc(p.edge, p.x, p.z, cl, p.cell);
      }
    }

    // ---- A*（端口图；启发 = 欧氏距离） ----
    const gScore = new Map<string, number>([[START, 0]]);
    const fScore = new Map<string, number>([[START, this.h(sx, sz, gx, gz)]]);
    const came = new Map<string, Came>();
    const closed = new Set<string>();
    // ★ 二叉堆（string 键 + f 值；避免线性扫描 O(n²) 尖刺）
    const heapKey: string[] = [START];
    const heapF: number[] = [this.h(sx, sz, gx, gz)];
    const hpush = (k: string, f: number): void => {
      heapKey.push(k); heapF.push(f);
      let i = heapKey.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        const tk = heapKey[p]; heapKey[p] = heapKey[i]; heapKey[i] = tk;
        const tf = heapF[p]; heapF[p] = heapF[i]; heapF[i] = tf;
        i = p;
      }
    };
    const hpop = (): string => {
      const top = heapKey[0];
      const n = heapKey.length - 1;
      heapKey[0] = heapKey[n]; heapF[0] = heapF[n];
      heapKey.pop(); heapF.pop();
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heapKey.length && heapF[l] < heapF[m]) m = l;
        if (r < heapKey.length && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        const tk = heapKey[m]; heapKey[m] = heapKey[i]; heapKey[i] = tk;
        const tf = heapF[m]; heapF[m] = heapF[i]; heapF[i] = tf;
        i = m;
      }
      return top;
    };
    let iter = 0;
    while (heapKey.length > 0) {
      if (++iter > MAX_ITER) break;
      const curKey = hpop();
      if (closed.has(curKey)) continue;
      closed.add(curKey);
      if (curKey === GOAL) {
        this.lastPerf.astar = performance.now() - this.queryStart - this.lastPerf.build;
        const hops = this.backtrack(came, GOAL);
        const tE = performance.now();
        this.emitHops(hops, gx, gz, out);
        this.lastPerf.emit = performance.now() - tE;
        return out.length > 0;
      }
      const cur = nodes.get(curKey);
      if (!cur) continue;
      const gc = gScore.get(curKey) ?? Infinity;
      for (const occ of cur.occ) {
        const d = this.intra(occ.cluster, occ.cell);
        // ① 本簇内的其它端口
        for (const p of occ.cluster.portals) {
          if (p.edge === curKey) continue;
          const dd = d[p.cell];
          if (!Number.isFinite(dd)) continue;
          this.lastPerf.nodes++;
          this.relax(p.edge, gc + dd * CELL, nodes, gScore, fScore, came, hpush, closed, {
            key: curKey, cluster: occ.cluster, fromCell: occ.cell, toCell: p.cell,
          }, gx, gz);
        }
        // ② 终点在本簇 → 直连终点（跨簇的最后一跳）
        if (occ.cluster === goalCluster) {
          const dg = this.intra(goalCluster, occ.cell)[gCell];
          if (Number.isFinite(dg)) {
            this.relax(GOAL, gc + dg * CELL, nodes, gScore, fScore, came, hpush, closed, {
              key: curKey, cluster: goalCluster, fromCell: occ.cell, toCell: gCell,
            }, gx, gz);
          }
        }
      }
    }
    return false;
  }

  // ============================================================
  // 内部
  // ============================================================

  /** ★ P2 初级寻路核验（《敌人管线重构总纲.md》§4-P2）：簇级可达 + 顺产 coarse 走廊路点。
   *  与 find() 共用簇缓存；输出稀化到 ≤8（走廊级软参考，非逐格路径）。
   *  @returns ok=可达（out=coarse 路点，末点=精确终点）；
   *           blocked=硬不可达（out 空）；
   *           unknown=簇预算未建完（调用方放行、不附 coarse——防冷启动误杀）。 */
  coarseReachable(
    raster: RasterMap, sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): 'ok' | 'blocked' | 'unknown' {
    out.length = 0;
    const full: { x: number; z: number }[] = [];
    const ok = this.find(raster, sx, sz, gx, gz, full);
    if (ok) {
      if (full.length <= 8) {
        for (const p of full) out.push(p);
      } else {
        const step = (full.length - 1) / 7;
        for (let i = 0; i < 8; i++) out.push(full[Math.round(i * step)]);
        out[out.length - 1] = full[full.length - 1];
      }
      return 'ok';
    }
    // find 失败分两类：簇没建完（warming）=未知 → 放行；建完仍无路 =真不可达
    return this.warming ? 'unknown' : 'blocked';
  }

  private relax(
    to: string, ng: number,
    nodes: Map<string, Node>, gScore: Map<string, number>, fScore: Map<string, number>,
    came: Map<string, Came>, hpush: (k: string, f: number) => void, closed: Set<string>,
    hop: Came, gx: number, gz: number,
  ): void {
    if (closed.has(to)) return;
    if (ng < (gScore.get(to) ?? Infinity)) {
      gScore.set(to, ng);
      const n = nodes.get(to);
      const f = n ? ng + this.h(n.x, n.z, gx, gz) : ng;
      fScore.set(to, f);
      came.set(to, hop);
      hpush(to, f);
    }
  }

  private backtrack(came: Map<string, Came>, goalKey: string): { cluster: Cluster; from: number; to: number }[] {
    const hops: { cluster: Cluster; from: number; to: number }[] = [];
    let key = goalKey;
    for (let guard = 0; guard < 4096; guard++) {
      const c = came.get(key);
      if (!c) break;
      hops.push({ cluster: c.cluster, from: c.fromCell, to: c.toCell });
      key = c.key;
      if (key === START) break;
    }
    hops.reverse();
    return hops;
  }

  /** 按跳拼线（每跳簇内 BFS 回溯真实折线）→ 全局拉绳平滑 → 追加精确终点 */
  private emitHops(
    hops: { cluster: Cluster; from: number; to: number }[], gx: number, gz: number,
    out: { x: number; z: number }[],
  ): void {
    const raw: { x: number; z: number }[] = [];
    for (const h of hops) {
      const pts = this.intraPath(h.cluster, h.from, h.to);
      for (const p of pts) raw.push(p);
    }
    raw.push({ x: gx, z: gz });
    // 稀化（每 2 点取 1）→ 拉绳（前向窗口 ≤8）→ 控制最坏 O(n·k)
    const thin: { x: number; z: number }[] = [];
    for (let k = 0; k < raw.length; k++) {
      if (k % 2 === 0 || k === raw.length - 1) thin.push(raw[k]);
    }
    let i = 0;
    while (i < thin.length - 1) {
      let j = Math.min(thin.length - 1, i + 8);
      while (j > i + 1 && !this.clearLine(thin[i], thin[j])) j--;
      out.push(thin[j]);
      i = j;
    }
  }

  private clearLine(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const raster = RasterMap.current;
    if (!raster) return false;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 4));
    let prevH = raster.surfaceHeightAt(a.x, a.z);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const samp = this.sample(raster, Math.floor(x / CELL), Math.floor(z / CELL));
      if (!samp.pass) return false;
      if (samp.h - prevH > RISE_MAX) return false;   // 只挡爬升
      prevH = samp.h;
    }
    return true;
  }

  private clusterOf(raster: RasterMap, cx: number, cz: number): Cluster | null {
    const key = `${cx},${cz}`;
    const old = this.clusters.get(key);
    if (old && this.nowMs - old.builtAt < TTL_MS) return old;
    if (this.buildBudget <= 0) return null;   // 冷启动预算用尽 → 下一拍继续
    this.buildBudget--;
    const gx0 = cx * CL, gz0 = cz * CL;
    const h = new Float32Array(CLC);
    const pass = new Uint8Array(CLC);
    for (let iz = 0; iz < CL; iz++) {
      for (let ix = 0; ix < CL; ix++) {
        const s = this.sample(raster, gx0 + ix, gz0 + iz);
        const i = iz * CL + ix;
        h[i] = s.h;
        pass[i] = s.pass ? 1 : 0;
      }
    }
    // ★ 表口径（与 TerrainScore 同源）：4 邻域陡差 > WALL_DH → 硬边界（不可进簇/不可穿越）
    for (let iz = 0; iz < CL; iz++) {
      for (let ix = 0; ix < CL; ix++) {
        const i = iz * CL + ix;
        if (!pass[i]) continue;
        const hh = h[i];
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(hh - h[i - 1]));
        if (ix < CL - 1) dh = Math.max(dh, Math.abs(hh - h[i + 1]));
        if (iz > 0) dh = Math.max(dh, Math.abs(hh - h[i - CL]));
        if (iz < CL - 1) dh = Math.max(dh, Math.abs(hh - h[i + CL]));
        if (dh > WALL_DH) pass[i] = 0;
      }
    }
    const cl: Cluster = { gx0, gz0, h, pass, portals: [], builtAt: this.nowMs, intra: new Map() };
    for (let t = 0; t < CL; t++) {
      this.tryPortal(raster, cl, t, 0);
      this.tryPortal(raster, cl, t, 1);
      this.tryPortal(raster, cl, t, 2);
      this.tryPortal(raster, cl, t, 3);
    }
    this.clusters.set(key, cl);
    return cl;
  }

  private tryPortal(raster: RasterMap, cl: Cluster, t: number, side: 0 | 1 | 2 | 3): void {
    let lix: number, liz: number, ax: number, az: number, bx: number, bz: number;
    if (side === 0) { lix = CL - 1; liz = t; ax = cl.gx0 + CL - 1; az = cl.gz0 + t; bx = ax + 1; bz = az; }
    else if (side === 1) { lix = 0; liz = t; ax = cl.gx0; az = cl.gz0 + t; bx = ax - 1; bz = az; }
    else if (side === 2) { lix = t; liz = CL - 1; ax = cl.gx0 + t; az = cl.gz0 + CL - 1; bx = ax; bz = az + 1; }
    else { lix = t; liz = 0; ax = cl.gx0 + t; az = cl.gz0; bx = ax; bz = az - 1; }
    const a = this.sample(raster, ax, az);
    const b = this.sample(raster, bx, bz);
    if (!a.pass || !b.pass) return;
    if (b.h - a.h > RISE_MAX) return;   // 只挡爬升
    cl.portals.push({
      edge: edgeKey(ax, az, bx, bz),
      cell: liz * CL + lix,
      x: ((ax + bx) / 2 + 0.5) * CELL,
      z: ((az + bz) / 2 + 0.5) * CELL,
    });
  }

  /** 格（簇内局部坐标）的通行代价倍率（掩体/战壕折扣；[0.5,1.5] 夹取） */
  private cellMul(cl: Cluster, ix: number, iz: number): number {
    if (!this.pathMul) return 1;
    const x = (cl.gx0 + ix) * CELL + CELL / 2;
    const z = (cl.gz0 + iz) * CELL + CELL / 2;
    const m = this.pathMul(x, z);
    return Number.isFinite(m) ? Math.max(0.5, Math.min(1.5, m)) : 1.5;
  }

  private sample(raster: RasterMap, gx: number, gz: number): { h: number; pass: boolean } {
    const x = gx * CELL + CELL / 2;
    const z = gz * CELL + CELL / 2;
    const smp = samplerFor(raster);
    const h = smp.heightAt(raster, x, z);
    const role = smp.roleAt(raster, x, z);
    const pass = role !== 'pit' && h >= DANGER.PIT_H;   // ★ 水域允许通行（不再挡 liquid）
    return { h, pass };
  }

  private cellOf(cl: Cluster, gx: number, gz: number): number {
    const ix = gx - cl.gx0, iz = gz - cl.gz0;
    if (ix < 0 || iz < 0 || ix >= CL || iz >= CL) return -1;
    const i = iz * CL + ix;
    return cl.pass[i] ? i : -1;
  }

  /** 簇内 BFS 距离场（缓存；直走 1 / 斜走 √2，禁止跨墙） */
  private intra(cl: Cluster, start: number): Float32Array {
    const cached = cl.intra.get(start);
    if (cached) return cached;
    const d = new Float32Array(CLC).fill(Infinity);
    const q: number[] = [start];
    d[start] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const ix = c % CL, iz = (c - ix) / CL;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= CL || nz >= CL) continue;
          const n = nz * CL + nx;
          if (!cl.pass[n]) continue;
          if (cl.h[n] - cl.h[c] > RISE_MAX) continue;   // 只挡爬升（下落放行，与个体移动口径一致）
          const cost = d[c] + (dx !== 0 && dz !== 0 ? 1.4142 : 1) * this.cellMul(cl, nx, nz);
          if (cost < d[n]) { d[n] = cost; q.push(n); }
        }
      }
    }
    cl.intra.set(start, d);
    return d;
  }

  /** 簇内回溯出真实折线（世界坐标；不含起点，含终点）——★ 加权 Dijkstra（含掩体/战壕折扣） */
  private intraPath(cl: Cluster, from: number, to: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    if (from === to) return out;
    const dist = new Float32Array(CLC).fill(Infinity);
    const parent = new Int16Array(CLC).fill(-1);
    const done = new Uint8Array(CLC);
    dist[from] = 0;
    for (let it = 0; it < CLC; it++) {
      let c = -1, best = Infinity;
      for (let k = 0; k < CLC; k++) if (!done[k] && dist[k] < best) { best = dist[k]; c = k; }
      if (c < 0) break;
      done[c] = 1;
      if (c === to) break;
      const ix = c % CL, iz = (c - ix) / CL;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= CL || nz >= CL) continue;
          const n = nz * CL + nx;
          if (!cl.pass[n]) continue;
          if (cl.h[n] - cl.h[c] > RISE_MAX) continue;   // 只挡爬升（下落放行，与个体移动口径一致）
          const nd = dist[c] + (dx !== 0 && dz !== 0 ? 1.4142 : 1) * this.cellMul(cl, nx, nz);
          if (nd < dist[n]) { dist[n] = nd; parent[n] = c; }
        }
      }
    }
    if (parent[to] === -1) return out;
    const rev: number[] = [];
    for (let c = to; c !== from; c = parent[c]) rev.push(c);
    rev.reverse();
    for (let i = 0; i < rev.length; i++) {
      if (i % 2 === 0 && i !== rev.length - 1) continue;   // 每 2 格取点
      const c = rev[i];
      const ix = c % CL, iz = (c - ix) / CL;
      out.push({ x: (cl.gx0 + ix + 0.5) * CELL, z: (cl.gz0 + iz + 0.5) * CELL });
    }
    return out;
  }

  private h(ax: number, az: number, bx: number, bz: number): number {
    return Math.hypot(ax - bx, az - bz);
  }

  clear(): void {
    this.clusters.clear();
  }
}
