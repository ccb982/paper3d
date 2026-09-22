// ============================================================
// PassTable —— 可行性表（迷宫抽象；《寻路与导航架构.md》§3.0/§3.1）
// ============================================================
// 地形高度的**纯函数**；每格记满**五个值**（用户定）：
//   ① 自身高度 h
//   ②③④⑤ 四向边（E/W/S/N）各记：可走 0/1 + 净落差（米，带符号）
//
// 边型（建表时按 0.8m 采样窗落差 + 深坑 判死；方向感知）：
//   · 深坑边缘（role=pit 且 h < PIT_H=-1.2，摔死坑）→ 绝对墙（双向禁）
//   · 落差 > CLIFF_DH(3.0)                          → 绝对墙（双向禁）
//   · WALL_STEP(0.6) < 落差 ≤ 3.0                   → 特殊墙（只可下落、不可上升）
//   · 其余（含浅坑/战壕/水）                        → 可走（水另走软代价 + 催促上岸）
//
// 预计算：chunk 生成/落地时顺产，一次构建；工事/挖掘不重建。
// 运行时不采样，只读边值（O(1)）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { DANGER } from './SwarmDanger';

const CELL = 4;
/** 边采样步长（米；相邻采样落差为判据） */
const DS = 1.0;
/** 方向索引：E/W/S/N */
const DIR_E = 0, DIR_W = 1, DIR_S = 2, DIR_N = 3;
/** 方向向量（与索引同序） */
const DVX = [1, -1, 0, 0] as const;
const DVZ = [0, 0, 1, -1] as const;

export class PassTable {
  /** 格原点（世界坐标；cell(ix,iz) 中心 = ox + ix*CELL + CELL/2） */
  private ox = 0;
  private oz = 0;
  private side = 0;
  /** ① 自身高度（格心；浮点） */
  private h = new Float32Array(0);
  /** ②-⑤ 四向边可走（n*4：E/W/S/N） */
  private can = new Uint8Array(0);
  /** ②-⑤ 四向边净落差（n*4；米，带符号：正 = 该向升高） */
  private drop = new Float32Array(0);
  /** 深坑格（摔死坑；边全禁，便于探针/诊断） */
  private lethal = new Uint8Array(0);
  ready = false;
  /** 建表统计（探针） */
  readonly stats = { cells: 0, edges: 0, abs: 0, oneWay: 0, open: 0, lethal: 0, ms: 0 };

  /** 建表（一次；活动窗口与 TerrainScore 同网格）。切工事/挖掘不重建。 */
  build(raster: RasterMap, cx: number, cz: number, r: number): void {
    const t0 = performance.now();
    this.ox = cx - r;
    this.oz = cz - r;
    this.side = Math.floor((r * 2) / CELL) + 1;
    const n = this.side * this.side;
    if (this.can.length !== n * 4) {
      this.can = new Uint8Array(n * 4);
      this.drop = new Float32Array(n * 4);
      this.h = new Float32Array(n);
      this.lethal = new Uint8Array(n);
    } else {
      this.can.fill(0);
      this.drop.fill(0);
      this.h.fill(0);
      this.lethal.fill(0);
    }
    const st = this.stats;
    st.cells = n; st.edges = 0; st.abs = 0; st.oneWay = 0; st.open = 0; st.lethal = 0;
    const sh = (x: number, z: number): number => raster.surfaceHeightAt(x, z);

    // ① 自身高度 + 深坑格
    for (let iz = 0; iz < this.side; iz++) {
      for (let ix = 0; ix < this.side; ix++) {
        const i = iz * this.side + ix;
        const wx = this.ox + ix * CELL + CELL / 2;
        const wz = this.oz + iz * CELL + CELL / 2;
        const hh = sh(wx, wz);
        this.h[i] = hh;
        if (raster.tileDefAt(wx, wz).genRole === 'pit' && hh < DANGER.PIT_H) {
          this.lethal[i] = 1;
          st.lethal++;
        }
      }
    }

    // ②-⑤ 四向边：只算 E/S 两条，双向同时写（W/N 即邻格的反向）
    for (let iz = 0; iz < this.side; iz++) {
      for (let ix = 0; ix < this.side; ix++) {
        const i = iz * this.side + ix;
        if (ix + 1 < this.side) {
          const j = i + 1;
          const [fwd, rev, dropQ, kind] = this.edge(sh, i, j, this.h[i], this.h[j]);
          this.setDir(i, DIR_E, fwd, dropQ);
          this.setDir(j, DIR_W, rev, -dropQ);
          this.count(kind);
        }
        if (iz + 1 < this.side) {
          const k = i + this.side;
          const [fwd, rev, dropQ, kind] = this.edge(sh, i, k, this.h[i], this.h[k]);
          this.setDir(i, DIR_S, fwd, dropQ);
          this.setDir(k, DIR_N, rev, -dropQ);
          this.count(kind);
        }
      }
    }
    this.ready = true;
    st.ms = +(performance.now() - t0).toFixed(1);
  }

  /** 一条边（i→j）：返回 [正向可走, 反向可走, 净落差(米), 分类(0 开放/1 绝对/2 单向)] */
  private edge(
    sh: (x: number, z: number) => number,
    i: number, j: number, hA: number, hB: number,
  ): [boolean, boolean, number, number] {
    // 深坑边缘 = 绝对墙（摔死坑；双向禁）
    if (this.lethal[i] === 1 || this.lethal[j] === 1) return [false, false, hB - hA, 1];
    const ix = i % this.side, iz = (i - ix) / this.side;
    const jx = j % this.side, jz = (j - jx) / this.side;
    const ax = this.ox + ix * CELL + CELL / 2;
    const az = this.oz + iz * CELL + CELL / 2;
    const bx = this.ox + jx * CELL + CELL / 2;
    const bz = this.oz + jz * CELL + CELL / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / DS));
    let prev = hA;
    let riseAB = 0, riseBA = 0, maxAbs = 0;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const hh = sh(ax + (bx - ax) * t, az + (bz - az) * t);
      const d = hh - prev;
      if (d > 0) { if (d > riseAB) riseAB = d; } else if (-d > riseBA) riseBA = -d;
      const ad = d < 0 ? -d : d;
      if (ad > maxAbs) maxAbs = ad;
      prev = hh;
    }
    if (maxAbs > DANGER.CLIFF_DH) return [false, false, hB - hA, 1];   // 绝对墙（悬崖）
    const fwd = riseAB <= DANGER.WALL_STEP;                              // 正向无 >0.6 升
    const rev = riseBA <= DANGER.WALL_STEP;                              // 反向无 >0.6 升
    return [fwd, rev, hB - hA, fwd && rev ? 0 : 2];
  }

  private setDir(i: number, d: number, ok: boolean, dropM: number): void {
    this.can[i * 4 + d] = ok ? 1 : 0;
    this.drop[i * 4 + d] = dropM;
  }

  private count(kind: number): void {
    this.stats.edges++;
    if (kind === 1) this.stats.abs++;
    else if (kind === 2) this.stats.oneWay++;
    else this.stats.open++;
  }

  /** 窗口界（格坐标；可行性寻路 BFS 用） */
  bounds(): { ox: number; oz: number; side: number } {
    return { ox: Math.floor(this.ox / CELL), oz: Math.floor(this.oz / CELL), side: this.side };
  }

  private cellAt(x: number, z: number): number {
    if (!this.ready) return -1;
    const ix = Math.floor((x - this.ox) / CELL);
    const iz = Math.floor((z - this.oz) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.side || iz >= this.side) return -1;
    return iz * this.side + ix;
  }

  /** 可走判定（世界坐标；dx,dz ∈ {-1,0,1}，斜向需两条正交分量均可走）。
   *  表外/未就绪 → 放行（N0 过渡期由旧口径兜底；表就绪后全覆盖）。 */
  canStep(x: number, z: number, dx: number, dz: number): boolean {
    const i = this.cellAt(x, z);
    if (i < 0) return true;
    const b = i * 4;
    if (dx > 0 && this.can[b + DIR_E] === 0) return false;
    if (dx < 0 && this.can[b + DIR_W] === 0) return false;
    if (dz > 0 && this.can[b + DIR_S] === 0) return false;
    if (dz < 0 && this.can[b + DIR_N] === 0) return false;
    return true;
  }

  /** 净落差（米；dx,dz 为方向）——供代价/减速读；表外/未就绪 → 0 */
  dropAt(x: number, z: number, dx: number, dz: number): number {
    const i = this.cellAt(x, z);
    if (i < 0) return 0;
    const b = i * 4;
    if (dx > 0) return this.drop[b + DIR_E];
    if (dx < 0) return this.drop[b + DIR_W];
    if (dz > 0) return this.drop[b + DIR_S];
    if (dz < 0) return this.drop[b + DIR_N];
    return 0;
  }

  /** 自身高度（格心；表外 → NaN） */
  heightAt(x: number, z: number): number {
    const i = this.cellAt(x, z);
    return i < 0 ? NaN : this.h[i];
  }

  clear(): void {
    this.ready = false;
    this.side = 0;
    this.can = new Uint8Array(0);
    this.drop = new Float32Array(0);
    this.h = new Float32Array(0);
    this.lethal = new Uint8Array(0);
  }
}
