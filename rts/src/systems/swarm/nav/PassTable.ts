// ============================================================
// PassTable —— 可行性表（**敌人消费收敛层**；《RTS架构.md》§6.0）
// ============================================================
// ★ 表管线（真相源 → 消费层；用户定 2026-09-25）：
//   地形生成（Tiles 地块类型 + ChunkGenerator 高度场）
//     → Refinements.finalRuling（边裁决唯一出口：weld=坡 / cliff=硬边；水全向/30%产坡/围裙）
//     → **本表 = 敌人消费收敛**：每格 高度 + 四向有向边（can/drop/climb）+ 水 + 坑墙
//     → 寻路（LocalStep/Route 只读本表）/ 移动内核（CharacterCore 经 TerrainProbe）
//   · 地形语义表（TerrainSemantics）是**另一条消费线**（战术偏好；不决定能不能走）。
//   · 动态破坏（HoleMask/HoleTable：挖掘/战壕）**不是地块类型**，与本表的坑（pit）无关。
// ★ 消费语义（不是改地形裁决）：
//   · weld（坡）  → 双向可行；净升 > 阈值 → 每边 `climb` 位（执行层必须走程序化爬坡）
//   · cliff（硬边）→ |净落差| ≤ EDGE_CLIFF_BAND(0.6) 可走（小落差无视）；> 0.6 **只下不上**
//   · 坑（地块类型 pit）→ **墙**（目标口径；现状：致死坑双向禁，非致死坑待实施）
// ★ 纪律：只经 `finalRuling` 读取（不自行改判）；E/S 计算 + W/N 镜像 → 两侧对应边对称。
// ============================================================
// 地形高度的**纯函数**；每格记满**五个值**（用户定）：
//   ① 自身高度 h
//   ②③④⑤ 四向边（E/W/S/N）各记：可走 0/1 + 净落差（米，带符号）
//
// ★ 边型 = **地形表裁决**（用户定 2026-09-24；《地形与渲染管线架构.md》weld/cliff）：
//   · 坡面（weld：水/坑无条件焊 + 30% 大落差产坡 + smoothDirs）→ **普通可行边**（双向，不特殊处理）
//   · 硬边（cliff）特殊处理：
//       - 坑（**地块类型 pit**；≠战壕）→ 绝对墙（双向禁；weld 也当墙——用户定 2026-09-25）
//       - |落差| ≤ EDGE_CLIFF_BAND  → 可走（平地地块间也都是硬边，零落差必须能走）
//       - 落差 > 豁免 → **上不可行（墙）、下可行**
//   裁决源 = 渲染同源（RasterMap.chunkSource 的 refined BlockSource → finalRuling），4m 块 = 4m 格对齐。
//
// 预计算：chunk 生成/落地时顺产，一次构建；工事/挖掘不重建。
// 运行时不采样，只读边值（O(1)）。
// ============================================================

import { RasterMap } from '../../../services/map/RasterMap';
import { finalRuling, EDGE_CLIFF_BAND, type EdgeRuling } from '../../../services/map/Refinements';
/** ★ 上坡点余量（米；用户定 2026-09-26）：上坡点标在**坡面前**此距离（低侧法线上） */
const CLIMB_MARGIN = 2;   // ★ 用户定：上坡点在坡面前 **2m**（再靠后 1m）
/** ★ 爬坡位判定阈值（米，净升）：坡面（weld）净升超过此值 → 标"必须程序化爬坡" */
const CLIMB_MARK_RISE = EDGE_CLIFF_BAND;
import { BLOCK_SIZE, BLOCKS_PER_SIDE } from '../../../services/map/ChunkGenerator';

const CELL = 4;
/** 格↔块换算（CELL = BLOCK_SIZE = 4 → 1:1 对齐） */
const BLOCKS_PER_CELL = BLOCK_SIZE / CELL;
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
  /** 坑格（**地块类型 pit** 一律墙；边全禁，便于探针/诊断） */
  private lethal = new Uint8Array(0);
  /** 水域格（可走；寻路加价用） */
  private water = new Uint8Array(0);
  /** ★ 爬坡位（用户定 2026-09-24）：weld（坡面）且该向净升 > CLIMB_MARK_RISE → 必须"程序化爬坡" */
  private climb = new Uint8Array(0);
  /** ★ 坡边显式标注（B1，用户定 2026-09-25）：该向边 = weld（坡）→ 1；cliff（硬边）→ 0。
   *  E/S 计算、W/N 镜像（两侧对应边同值）——寻路/移动不再靠坡度/落差猜。 */
  private weld = new Uint8Array(0);
  /** ★★ 上坡位置预处理（用户定 2026-09-26）：每条可爬边的**连续段**（按坡宽）→
   *  段中心、坡面前 CLIMB_MARGIN 米（低侧法线）标"上坡点"。寻路上高台**只能经这些点**。 */
  /** ★ 上坡点表（构建期预处理；寻路/执行/可视化读） */
  climbRuns: { x: number; z: number; ux: number; uz: number; width: number }[] = [];
  private climbRun = new Int16Array(0);   // per(cell*4+dir) → climbRuns 下标；-1 = 非上坡点
  ready = false;
  /** 建表统计（探针） */
  readonly stats = { cells: 0, edges: 0, abs: 0, oneWay: 0, open: 0, lethal: 0, ms: 0 };

  /** 建表（一次；活动窗口与 TerrainScore 同网格）。切工事/挖掘不重建。 */
  build(raster: RasterMap, cx: number, cz: number, r: number): void {
    const t0 = performance.now();
    // ★ 格对齐块格（4m=块）：格心即块心 → 高度/角色/裁决与地形表 1:1（用户定 2026-09-24）
    this.ox = Math.floor((cx - r) / CELL) * CELL;
    this.oz = Math.floor((cz - r) / CELL) * CELL;
    this.side = Math.floor((r * 2) / CELL) + 1;
    const n = this.side * this.side;
    if (this.can.length !== n * 4) {
      this.can = new Uint8Array(n * 4);
      this.drop = new Float32Array(n * 4);
      this.h = new Float32Array(n);
      this.lethal = new Uint8Array(n);
      this.water = new Uint8Array(n);
      this.climb = new Uint8Array(n * 4);
      this.weld = new Uint8Array(n * 4);
    } else {
      this.can.fill(0);
      this.drop.fill(0);
      this.h.fill(0);
      this.lethal.fill(0);
      this.water.fill(0);
      this.climb.fill(0);
      this.weld.fill(0);
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
        const role = raster.tileDefAt(wx, wz).genRole;
        if (role === 'liquid') this.water[i] = 1;
        // ★ 坑（**地块类型 pit**，不是战壕）→ 一律墙（用户定 2026-09-25）：
        //   边全禁（绝对墙），与移动/SteerPick 的 blockedAt（pit=硬格）同口径。
        if (role === 'pit') {
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
          const [fwd, rev, dropQ, kind, cf, cr, wf] = this.edge(raster, ix, iz, i, j, this.h[i], this.h[j], DIR_E);
          this.setDir(i, DIR_E, fwd, dropQ);
          this.setDir(j, DIR_W, rev, -dropQ);
          this.climb[i * 4 + DIR_E] = cf ? 1 : 0;
          this.climb[j * 4 + DIR_W] = cr ? 1 : 0;
          this.weld[i * 4 + DIR_E] = wf ? 1 : 0;
          this.weld[j * 4 + DIR_W] = wf ? 1 : 0;   // ★ 两侧对应边同值（B1）
          this.count(kind);
        }
        if (iz + 1 < this.side) {
          const k = i + this.side;
          const [fwd, rev, dropQ, kind, cf, cr, wf] = this.edge(raster, ix, iz, i, k, this.h[i], this.h[k], DIR_S);
          this.setDir(i, DIR_S, fwd, dropQ);
          this.setDir(k, DIR_N, rev, -dropQ);
          this.climb[i * 4 + DIR_S] = cf ? 1 : 0;
          this.climb[k * 4 + DIR_N] = cr ? 1 : 0;
          this.weld[i * 4 + DIR_S] = wf ? 1 : 0;
          this.weld[k * 4 + DIR_N] = wf ? 1 : 0;   // ★ 两侧对应边同值（B1）
          this.count(kind);
        }
      }
    }
    this.buildClimbRuns();   // ★ 上坡位置预处理（坡宽 + 段中心 + 前 CLIMB_MARGIN）
    this.ready = true;
    st.ms = +(performance.now() - t0).toFixed(1);
  }

  /** 一条边（i→j）：返回 [正向可走, 反向可走, 净落差(米), 分类(0 开放/1 绝对/2 单向),
   *  正向爬坡位, 反向爬坡位, **坡(weld)边**]（爬坡位 = weld 且净升 > CLIMB_MARK_RISE）
   *  ★ 裁决 = 地形表（weld=坡 → 普通可行；cliff=硬边 → 特殊处理）。 */
  private edge(
    raster: RasterMap, ix: number, iz: number,
    i: number, j: number, hA: number, hB: number, dir: 0 | 1 | 2 | 3,
  ): [boolean, boolean, number, number, boolean, boolean, boolean] {
    // 坑（地块类型）= 绝对墙（始终不可行，双向禁）
    if (this.lethal[i] === 1 || this.lethal[j] === 1) return [false, false, hB - hA, 1, false, false, false];
    const net = hB - hA;
    // ★ 地形表裁决（与渲染同源）：4m 格 = 4m 块，直接问该块边
    const bx = Math.floor(this.ox / BLOCK_SIZE) + ix * BLOCKS_PER_CELL;
    const bz = Math.floor(this.oz / BLOCK_SIZE) + iz * BLOCKS_PER_CELL;
    const ruling: EdgeRuling = finalRuling(
      raster.chunkSource(Math.floor(bx / BLOCKS_PER_SIDE), Math.floor(bz / BLOCKS_PER_SIDE)),
      bx, bz, dir,
    );
    // 坡面（weld）= 普通可行边（用户定：不特殊处理，双向可走）——净升 > 阈值 = 爬坡位
    if (ruling === 'weld') {
      return [true, true, net, 0, net > CLIMB_MARK_RISE, -net > CLIMB_MARK_RISE, true];
    }
    // 硬边（cliff）：≤ 台阶豁免（与移动层同源常量）→ 可走（平地地块间零落差也走这里）
    if (Math.abs(net) <= EDGE_CLIFF_BAND) return [true, true, net, 0, false, false, false];
    // 硬边大落差：**上不可行（墙）、下可行**
    const fwd = net < 0;   // i→j 向下 → 可走；向上 → 不可行
    const rev = net > 0;
    return [fwd, rev, net, 2, false, false, false];
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

  /** ★★ 上坡位置预处理（用户定 2026-09-26）：**按连续坡的宽度**取上坡点——
   *  对每条**可爬坡边**，沿其**切向**找连续段（同朝向的整条坡 = 一段，宽度=段内格数），
   *  取**段中心**，在**坡面前 CLIMB_MARGIN 米**（低侧法线）标上坡点；不同朝向各自成段。
   *  寻路上高台只能经这些上坡点（`climbRunAt` / `nearestClimbPoint`）。 */
  private buildClimbRuns(): void {
    const n = this.side * this.side;
    this.climbRun = new Int16Array(n * 4).fill(-1);
    this.climbRuns = [];
    for (let iz = 0; iz < this.side; iz++) {
      for (let ix = 0; ix < this.side; ix++) {
        const i = iz * this.side + ix;
        for (let d = 0; d < 4; d++) {
          if (this.climb[i * 4 + d] !== 1 || this.climbRun[i * 4 + d] !== -1) continue;
          // 切向（垂直于法线）：E/W → z 轴；S/N → x 轴
          const tax = d >= 2 ? 1 : 0, taz = d < 2 ? 1 : 0;
          // 回退到段首
          let x0 = ix, z0 = iz;
          for (;;) {
            const px2 = x0 - tax, pz2 = z0 - taz;
            if (px2 < 0 || pz2 < 0 || px2 >= this.side || pz2 >= this.side) break;
            const pi = pz2 * this.side + px2;
            if (this.climb[pi * 4 + d] !== 1 || this.climbRun[pi * 4 + d] !== -1) break;
            x0 = px2; z0 = pz2;
          }
          // 前探段长（占位标记）
          const idx = this.climbRuns.length;
          const cells: number[] = [];
          let x = x0, z = z0;
          while (x >= 0 && z >= 0 && x < this.side && z < this.side) {
            const ci = z * this.side + x;
            if (this.climb[ci * 4 + d] !== 1 || this.climbRun[ci * 4 + d] !== -1) break;
            this.climbRun[ci * 4 + d] = idx;
            cells.push(ci);
            x += tax; z += taz;
          }
          const mid = cells[Math.floor(cells.length / 2)] as number;
          const mix = mid % this.side, miz = (mid - mix) / this.side;
          const ccx = this.ox + mix * CELL + CELL / 2;
          const ccz = this.oz + miz * CELL + CELL / 2;
          const ux = DVX[d], uz = DVZ[d];
          this.climbRuns.push({
            x: ccx + ux * (CELL / 2 - CLIMB_MARGIN), z: ccz + uz * (CELL / 2 - CLIMB_MARGIN),
            ux, uz, width: cells.length,
          });
        }
      }
    }
  }

  /** ★ 上坡点查询（该格所属**连续坡**的上坡点：段中心、坡面前 CLIMB_MARGIN；无 → null） */
  climbRunAt(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number } | null {
    if (!this.ready) return null;
    const c = this.cellAt(x, z);
    if (c < 0) return null;
    // ★ 斜向口径：任一分量轴上查到 climb 位即认（不得只看主轴——否则斜向步漏坡点）
    const pick = (d: number): number => (this.climb[c * 4 + d] === 1 ? this.climbRun[c * 4 + d] : -1);
    let k = -1;
    if (dx > 0) k = pick(DIR_E);
    if (k < 0 && dx < 0) k = pick(DIR_W);
    if (k < 0 && dz > 0) k = pick(DIR_S);
    if (k < 0 && dz < 0) k = pick(DIR_N);
    return k < 0 ? null : (this.climbRuns[k] ?? null);
  }

  /** ★ 最近上坡点（宽段优先、其次近）：`maxR` 米内找——执行侧"找坡道"用 */
  nearestClimbPoint(x: number, z: number, maxR = 48): { x: number; z: number; ux: number; uz: number; width: number } | null {
    if (!this.ready) return null;
    let best: { x: number; z: number; ux: number; uz: number; width: number } | null = null;
    let bestScore = -Infinity;
    for (const r of this.climbRuns) {
      const d = Math.hypot(r.x - x, r.z - z);
      if (d > maxR) continue;
      const score = Math.min(r.width, 4) * 1.5 - d * 0.05;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
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

  /** ★ 坡边（B1，用户定 2026-09-25）：该向边是否 weld（坡）——两侧对应边同值；只读 */
  weldAt(x: number, z: number, dx: number, dz: number): boolean {
    const i = this.cellAt(x, z);
    if (i < 0) return false;
    const b = i * 4;
    if (dx > 0 && this.weld[b + DIR_E] === 1) return true;
    if (dx < 0 && this.weld[b + DIR_W] === 1) return true;
    if (dz > 0 && this.weld[b + DIR_S] === 1) return true;
    if (dz < 0 && this.weld[b + DIR_N] === 1) return true;
    return false;
  }

  /** ★ 爬坡位（用户定 2026-09-24）：该向是否"必须程序化爬坡"（坡面且净升 > 阈值） */
  climbAt(x: number, z: number, dx: number, dz: number): boolean {
    const i = this.cellAt(x, z);
    if (i < 0) return false;
    const b = i * 4;
    if (dx > 0 && this.climb[b + DIR_E] === 1) return true;
    if (dx < 0 && this.climb[b + DIR_W] === 1) return true;
    if (dz > 0 && this.climb[b + DIR_S] === 1) return true;
    if (dz < 0 && this.climb[b + DIR_N] === 1) return true;
    return false;
  }

  /** 净落差（米；dx,dz 为方向）——供代价/减速读；表外/未就绪 → 0
   *  ★ 斜向：取两轴中更陡的一轴（原来只读 E/W → 上坡惩罚漏算，斜向上坡被低估） */
  dropAt(x: number, z: number, dx: number, dz: number): number {
    const i = this.cellAt(x, z);
    if (i < 0) return 0;
    const b = i * 4;
    if (dx !== 0 && dz !== 0) {
      const a = dx > 0 ? this.drop[b + DIR_E] : this.drop[b + DIR_W];
      const c = dz > 0 ? this.drop[b + DIR_S] : this.drop[b + DIR_N];
      return Math.abs(a) >= Math.abs(c) ? a : c;
    }
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

  /** 水域格（可走；寻路加价） */
  waterAt(x: number, z: number): boolean {
    const i = this.cellAt(x, z);
    return i >= 0 && this.water[i] === 1;
  }

  clear(): void {
    this.ready = false;
    this.side = 0;
    this.can = new Uint8Array(0);
    this.drop = new Float32Array(0);
    this.h = new Float32Array(0);
    this.lethal = new Uint8Array(0);
    this.water = new Uint8Array(0);
    this.climb = new Uint8Array(0);
    this.climbRun = new Int16Array(0);
    this.climbRuns = [];
    this.weld = new Uint8Array(0);
  }
}
