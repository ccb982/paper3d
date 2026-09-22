// ============================================================
// PassTable —— 可行性表（迷宫抽象；《寻路与导航架构.md》§3.0/§3.1）
// ============================================================
// 地形高度的**纯函数**：每格 4 条边，按 0.8m 采样窗落差判边型：
//   · 落差 > CLIFF_DH(3.0)          → 绝对墙（双向禁）
//   · WALL_STEP(0.6) < 落差 ≤ 3.0   → 特殊墙（只可下落、不可上升；方向位）
//   · 其余                          → 开放
// 水/坑/战壕不判墙（另走软代价）；工事/挖掘**不重建**（表只随地图）。
// 预计算：chunk 生成/落地时顺产，一次构建；同 seed 必然同表。
// 运行时不采样，只读边位（O(1)）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { DANGER } from './SwarmDanger';

const CELL = 4;
/** 边采样步长（米；相邻采样落差为判据） */
const DS = 1.0;
/** 落差量化（米/级；供代价与减速读） */
const DQ = 0.05;

export class PassTable {
  /** 格原点（世界坐标；cell(ix,iz) 中心 = ox + ix*CELL + CELL/2） */
  private ox = 0;
  private oz = 0;
  private side = 0;
  /** 每格 4 位：bit0 东向可走 / bit1 西向 / bit2 南向 / bit3 北向 */
  private bits = new Uint8Array(0);
  /** 东/南边净落差（量化；供代价/减速） */
  private dropE = new Int8Array(0);
  private dropS = new Int8Array(0);
  ready = false;
  /** 建表统计（探针） */
  readonly stats = { cells: 0, edges: 0, abs: 0, oneWay: 0, open: 0, ms: 0 };

  /** 建表（一次；活动窗口与 TerrainScore 同网格）。切工事/挖掘不重建。 */
  build(raster: RasterMap, cx: number, cz: number, r: number): void {
    const t0 = performance.now();
    this.ox = cx - r;
    this.oz = cz - r;
    this.side = Math.floor((r * 2) / CELL) + 1;
    const n = this.side * this.side;
    if (this.bits.length !== n) {
      this.bits = new Uint8Array(n);
      this.dropE = new Int8Array(n);
      this.dropS = new Int8Array(n);
    } else {
      this.bits.fill(0);
      this.dropE.fill(0);
      this.dropS.fill(0);
    }
    const st = this.stats;
    st.cells = n; st.edges = 0; st.abs = 0; st.oneWay = 0; st.open = 0;
    const h = (x: number, z: number): number => raster.surfaceHeightAt(x, z);
    for (let iz = 0; iz < this.side; iz++) {
      for (let ix = 0; ix < this.side; ix++) {
        const i = iz * this.side + ix;
        const wx = this.ox + ix * CELL + CELL / 2;
        const wz = this.oz + iz * CELL + CELL / 2;
        // 东边
        if (ix + 1 < this.side) {
          const [fwd, rev, dropQ, kind] = this.edge(h, wx, wz, wx + CELL, wz);
          if (fwd) this.bits[i] |= 1;
          if (rev) this.bits[i] |= 2;
          this.dropE[i] = dropQ;
          this.count(kind);
        } else {
          this.bits[i] &= ~3;
        }
        // 南边
        if (iz + 1 < this.side) {
          const [fwd, rev, dropQ, kind] = this.edge(h, wx, wz, wx, wz + CELL);
          if (fwd) this.bits[i] |= 4;
          if (rev) this.bits[i] |= 8;
          this.dropS[i] = dropQ;
          this.count(kind);
        } else {
          this.bits[i] &= ~0xc;
        }
      }
    }
    this.ready = true;
    st.ms = +(performance.now() - t0).toFixed(1);
  }

  /** 一条边：返回 [正向可走, 反向可走, 净落差量化, 分类(0 开放/1 绝对/2 单向)] */
  private edge(
    h: (x: number, z: number) => number,
    ax: number, az: number, bx: number, bz: number,
  ): [boolean, boolean, number, number] {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / DS));
    const first = h(ax, az);
    let prev = first;
    let riseAB = 0, riseBA = 0, maxAbs = 0;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const hh = h(ax + (bx - ax) * t, az + (bz - az) * t);
      const d = hh - prev;
      if (d > 0) { if (d > riseAB) riseAB = d; } else if (-d > riseBA) riseBA = -d;
      const ad = d < 0 ? -d : d;
      if (ad > maxAbs) maxAbs = ad;
      prev = hh;
    }
    const dropQ = Math.max(-127, Math.min(127, Math.round((prev - first) / DQ)));
    if (maxAbs > DANGER.CLIFF_DH) return [false, false, dropQ, 1];       // 绝对墙
    const fwd = riseAB <= DANGER.WALL_STEP;                              // 正向无 >0.6 升
    const rev = riseBA <= DANGER.WALL_STEP;                              // 反向无 >0.6 升
    return [fwd, rev, dropQ, fwd && rev ? 0 : 2];
  }

  private count(kind: number): void {
    this.stats.edges++;
    if (kind === 1) this.stats.abs++;
    else if (kind === 2) this.stats.oneWay++;
    else this.stats.open++;
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
    const b = this.bits[i];
    if (dx > 0 && !(b & 1)) return false;
    if (dx < 0 && !(b & 2)) return false;
    if (dz > 0 && !(b & 4)) return false;
    if (dz < 0 && !(b & 8)) return false;
    return true;
  }

  /** 净落差（米；dx,dz 为方向）——供代价/减速读；表外/未就绪 → 0 */
  dropAt(x: number, z: number, dx: number, dz: number): number {
    if (!this.ready) return 0;
    const ix = Math.floor((x - this.ox) / CELL);
    const iz = Math.floor((z - this.oz) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.side || iz >= this.side) return 0;
    const i = iz * this.side + ix;
    if (dx > 0) return ix + 1 < this.side ? this.dropE[i] * DQ : 0;
    if (dx < 0) return ix > 0 ? -this.dropE[i - 1] * DQ : 0;
    if (dz > 0) return iz + 1 < this.side ? this.dropS[i] * DQ : 0;
    if (dz < 0) return iz > 0 ? -this.dropS[i - this.side] * DQ : 0;
    return 0;
  }

  clear(): void {
    this.ready = false;
    this.side = 0;
    this.bits = new Uint8Array(0);
    this.dropE = new Int8Array(0);
    this.dropS = new Int8Array(0);
  }
}
