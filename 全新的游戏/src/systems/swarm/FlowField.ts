// ============================================================
// FlowField —— 代理群体导航场（《敌人管线设计.md》§42/§5.3）
// ============================================================
// 以玩家为中心的活动窗口（81×81 个 4m 格 ≈ 324m），多源 Dijkstra：
//   源 = 玩家 + 舰船；坑/水/爬崖编码为高代价 → 代理取距离场梯度前进。
// 同网格兼任【警戒场】：发现玩家的单位刷半径，同伴按个体延迟反应。
// 重建：3Hz 或中心移动 > 1 格；窗口中立即可用，窗口外回退直线逼近。
// ============================================================

import type { RasterMap } from '../../services/map/RasterMap';

export const FLOW_CELL = 4;
/** 窗口边长（格；奇数 → 中心对齐） */
export const FLOW_SIZE = 81;

const HALF = (FLOW_SIZE - 1) / 2;
const CELL_COUNT = FLOW_SIZE * FLOW_SIZE;

/** 危险性代价（格子上叠加） */
const COST_PIT = 8;
/** ★ 深水代价（2026-09-14：敌人不涉水 → 高代价让路径偏好绕岸；本地探测再兜底阻挡） */
const COST_LIQUID = 8;
/** 爬坡代价系数（上坡每米加价） */
const COST_CLIMB = 1.5;
/** 判定"崖"的最小高差（米） */
const CLIFF_DH = 0.5;

export class FlowField {
  /** 窗口左上角格坐标（世界/4m 对齐） */
  private originCx = 0;
  private originCz = 0;
  private hasField = false;

  private readonly dist = new Float32Array(CELL_COUNT);
  private readonly finalized = new Uint8Array(CELL_COUNT);
  /** 格高度缓存（按世界格坐标复用；窗口平移时只补新格） */
  private readonly height = new Float32Array(CELL_COUNT);
  /** 格危险性（重建时编码） */
  private readonly danger = new Float32Array(CELL_COUNT);
  /** 高度缓存的世界格坐标（不一致 → 重采样该格） */
  private readonly cellWX = new Int32Array(CELL_COUNT);
  private readonly cellWZ = new Int32Array(CELL_COUNT);
  private cacheValid = false;
  /** 警戒场：格上警戒截止时间（performance.now/1000 秒） */
  private readonly alertUntil = new Float32Array(CELL_COUNT);
  /** 警戒场滚动的行临时缓冲（零分配） */
  private readonly rowBuf = new Float32Array(FLOW_SIZE);

  // ---- 二叉堆（typed arrays，零分配） ----
  private readonly heapCell = new Int32Array(CELL_COUNT * 4);
  private readonly heapDist = new Float32Array(CELL_COUNT * 4);
  private heapSize = 0;

  /** 上次重建时的中心（格） */
  private lastCx = 0;
  private lastCz = 0;

  get ready(): boolean {
    return this.hasField;
  }

  /** 是否需要重建（3Hz 节流 + 中心移动 > 1 格由调用方判断时间；此处只管中心位移） */
  needsRebuild(centerX: number, centerZ: number): boolean {
    if (!this.hasField) return true;
    const cx = Math.floor(centerX / FLOW_CELL);
    const cz = Math.floor(centerZ / FLOW_CELL);
    return Math.abs(cx - this.lastCx) > 1 || Math.abs(cz - this.lastCz) > 1;
  }

  /** 重建距离场（多源 Dijkstra；sources = 玩家 / 舰船等） */
  rebuild(raster: RasterMap, centerX: number, centerZ: number, sources: { x: number; z: number }[]): void {
    const cx = Math.floor(centerX / FLOW_CELL);
    const cz = Math.floor(centerZ / FLOW_CELL);
    // 警戒场随窗口滚动（保住既有警戒）；大跳（传送/复活）直接清空
    if (this.hasField) {
      const ddx = cx - HALF - this.originCx;
      const ddz = cz - HALF - this.originCz;
      if (ddx === 0 && ddz === 0) {
        // 无位移
      } else if (Math.abs(ddx) < FLOW_SIZE && Math.abs(ddz) < FLOW_SIZE) {
        this.scrollAlert(ddx, ddz);
      } else {
        this.alertUntil.fill(0);
      }
    } else {
      this.alertUntil.fill(0);
    }
    this.originCx = cx - HALF;
    this.originCz = cz - HALF;
    this.lastCx = cx;
    this.lastCz = cz;

    const dist = this.dist;
    const fin = this.finalized;
    const height = this.height;
    const danger = this.danger;
    dist.fill(Infinity);
    fin.fill(0);

    // ---- ① 采样格高度 + 编码危险（坑/水；按世界格坐标缓存，平移只补新格） ----
    for (let iz = 0; iz < FLOW_SIZE; iz++) {
      for (let ix = 0; ix < FLOW_SIZE; ix++) {
        const wcx = this.originCx + ix;
        const wcz = this.originCz + iz;
        const idx = iz * FLOW_SIZE + ix;
        if (this.cacheValid && this.cellWX[idx] === wcx && this.cellWZ[idx] === wcz) continue;
        this.cellWX[idx] = wcx;
        this.cellWZ[idx] = wcz;
        const wx = wcx * FLOW_CELL + FLOW_CELL / 2;
        const wz = wcz * FLOW_CELL + FLOW_CELL / 2;
        height[idx] = raster.surfaceHeightAt(wx, wz);
        const role = raster.tileDefAt(wx, wz).genRole;
        danger[idx] = role === 'pit' ? COST_PIT : role === 'liquid' ? COST_LIQUID : 0;
      }
    }
    this.cacheValid = true;

    // ---- ② 多源 Dijkstra ----
    this.heapSize = 0;
    for (const s of sources) {
      const idx = this.cellIndex(s.x, s.z);
      if (idx < 0) continue;
      dist[idx] = 0;
      this.push(idx, 0);
    }
    while (this.heapSize > 0) {
      const cell = this.pop();
      if (fin[cell]) continue;
      fin[cell] = 1;
      const d = dist[cell];
      const ix = cell % FLOW_SIZE;
      const iz = (cell - ix) / FLOW_SIZE;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= FLOW_SIZE || nz >= FLOW_SIZE) continue;
          const n = nz * FLOW_SIZE + nx;
          if (fin[n]) continue;
          let cost = dx !== 0 && dz !== 0 ? 1.414 : 1;
          cost += danger[n];
          const dh = height[n] - height[cell];
          if (dh > CLIFF_DH) cost += dh * COST_CLIMB; // 上坡/爬崖加价（下坡免费）
          const nd = d + cost;
          if (nd < dist[n]) {
            dist[n] = nd;
            this.push(n, nd);
          }
        }
      }
    }
    this.hasField = true;
  }

  /** 取流场方向（距离场负梯度，8 邻域最优；窗口外/未就绪 → false） */
  dirAt(x: number, z: number, out: { x: number; z: number }): boolean {
    if (!this.hasField) return false;
    const idx = this.cellIndex(x, z);
    if (idx < 0) return false;
    const ix = idx % FLOW_SIZE;
    const iz = (idx - ix) / FLOW_SIZE;
    let best = idx;
    let bestD = this.dist[idx];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= FLOW_SIZE || nz >= FLOW_SIZE) continue;
        const n = nz * FLOW_SIZE + nx;
        const d = this.dist[n];
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    if (best === idx || !Number.isFinite(bestD)) return false;
    const bx = best % FLOW_SIZE;
    const bz = (best - bx) / FLOW_SIZE;
    const wx = (this.originCx + bx) * FLOW_CELL + FLOW_CELL / 2 - x;
    const wz = (this.originCz + bz) * FLOW_CELL + FLOW_CELL / 2 - z;
    const len = Math.hypot(wx, wz);
    if (len < 1e-4) return false;
    out.x = wx / len;
    out.z = wz / len;
    return true;
  }

  // ============================================================
  // 警戒场（与距离场共用网格）
  // ============================================================

  /** 刷警戒（发现玩家的单位 / 玩家开火点；radiusMeters 半径内） */
  paintAlert(x: number, z: number, radiusMeters: number, now: number, seconds: number): void {
    if (!this.hasField) return;
    const r = Math.max(1, Math.round(radiusMeters / FLOW_CELL));
    const c = this.cellIndex(x, z);
    if (c < 0) return;
    const ix = c % FLOW_SIZE;
    const iz = (c - ix) / FLOW_SIZE;
    const until = now + seconds;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= FLOW_SIZE || nz >= FLOW_SIZE) continue;
        const n = nz * FLOW_SIZE + nx;
        if (until > this.alertUntil[n]) this.alertUntil[n] = until;
      }
    }
  }

  /** 该点是否处于警戒状态（now = performance.now()/1000） */
  isAlerted(x: number, z: number, now: number): boolean {
    if (!this.hasField) return false;
    const idx = this.cellIndex(x, z);
    return idx >= 0 && this.alertUntil[idx] > now;
  }

  /** 警戒场按 (ddx, ddz) 格平移（新暴露的格清零；行缓冲零分配） */
  private scrollAlert(ddx: number, ddz: number): void {
    const n = FLOW_SIZE;
    if (ddz <= 0) {
      for (let iz = 0; iz < n; iz++) this.shiftRow(iz, ddx, ddz);
    } else {
      for (let iz = n - 1; iz >= 0; iz--) this.shiftRow(iz, ddx, ddz);
    }
  }

  private shiftRow(iz: number, ddx: number, ddz: number): void {
    const n = FLOW_SIZE;
    const a = this.alertUntil;
    const buf = this.rowBuf;
    const srcRow = iz - ddz;
    if (srcRow < 0 || srcRow >= n) {
      a.fill(0, iz * n, iz * n + n);
      return;
    }
    for (let ix = 0; ix < n; ix++) {
      const srcIx = ix - ddx;
      buf[ix] = srcIx >= 0 && srcIx < n ? a[srcRow * n + srcIx] : 0;
    }
    for (let ix = 0; ix < n; ix++) a[iz * n + ix] = buf[ix];
  }

  /** 世界坐标 → 格索引（窗口外 -1） */
  private cellIndex(x: number, z: number): number {
    const cx = Math.floor(x / FLOW_CELL);
    const cz = Math.floor(z / FLOW_CELL);
    const ix = cx - this.originCx;
    const iz = cz - this.originCz;
    if (ix < 0 || iz < 0 || ix >= FLOW_SIZE || iz >= FLOW_SIZE) return -1;
    return iz * FLOW_SIZE + ix;
  }

  // ---- 二叉堆 ----
  private push(cell: number, d: number): void {
    if (this.heapSize >= this.heapCell.length) return;
    let i = this.heapSize++;
    this.heapCell[i] = cell;
    this.heapDist[i] = d;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapDist[p] <= this.heapDist[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  private pop(): number {
    const top = this.heapCell[0];
    const n = --this.heapSize;
    this.heapCell[0] = this.heapCell[n];
    this.heapDist[0] = this.heapDist[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.heapDist[l] < this.heapDist[m]) m = l;
      if (r < n && this.heapDist[r] < this.heapDist[m]) m = r;
      if (m === i) break;
      this.swap(m, i);
      i = m;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const c = this.heapCell[a];
    this.heapCell[a] = this.heapCell[b];
    this.heapCell[b] = c;
    const d = this.heapDist[a];
    this.heapDist[a] = this.heapDist[b];
    this.heapDist[b] = d;
  }

  clear(): void {
    this.hasField = false;
    this.alertUntil.fill(0);
  }
}
