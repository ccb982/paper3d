// ============================================================
// TerrainSemantics —— 地形事实表（3 通道 · 不评分；《地形语义表设计.md》D2）
// ============================================================
// ★ 表只给事实、不给分；评分合成归兵种管理器（D3 起）。
//   C1 高度：rawH + h（3×3 平滑）——C2/C3 的构建输入，制高/攀爬直接消费
//   C2 地形结构：kind（0 平地 / 1 坡面 / 2 山顶 / 3 高原 / 4 缝道）
//                + slope（|∇h|，米/格）+ narrowW/narrowDir/narrowLong（缝道字段）
//   C3 对舰关系：slopeDir（0 平/侧 / 1 迎舰 / 2 背舰）+ occluded（舰眼点 3D 遮挡）
// ★ 窗口（用户定 2026-09-29）：**以舰为中心**的一大块区域（静态，换落点/舰动重建）；
//   半径 = 罩住 舰↔落点 走廊（dist+60，上限 240；缺省 144）。舰眼点 = 舰处地形高 + 1.6m。
// ★ 表外真源：可走=PassTable（只作长/短寻路校验）；水**可走**、**不挡视线**。
//   isPassableAt 仅为旧消费兼容（非陡壁），新代码请用 cellAt/字段口 + PassTable。
// ============================================================

/** 采样接口：游戏内 = TerrainSampler + RasterMap 的适配器；自测 = 合成高度场 */
export interface FieldSampler {
  heightAt(x: number, z: number): number;
  /** 地形 role（可选；事实表只认高度——水不挡视线） */
  roleAt?(x: number, z: number): string;
}

/** 事实格边长（米；4m = 地形块网格，与挖掘同源；HoleMask/HoleTable 共享） */
export const L1_CELL = 4;
/** 事实表缺省半径（米；舰心窗可扩到 R_MAX 以罩住落点走廊） */
export const L1_R = 144;
/** 窗口半径上限（米；= main pickEnemyLanding 160m 走廊 + 边距） */
export const R_MAX = 240;
/** 数组静态上限边长（格）——按 R_MAX 分配，build 时取活动窗口 */
const SIDE_MAX = Math.floor((R_MAX * 2) / L1_CELL) + 1;

// ---- 判据常量（初版可调；《地形语义表设计.md》§3.5） ----
/** 可走格（判缝道/坡面用）：4m 邻差 ≤ 此值（非陡壁；= 通行坡面阈值 SLOPE_DH） */
export const SLOPE_DH = 1.5;
/** 陡壁：4m 邻差 > 此值（硬边界；全工程口径单源，SwarmDanger 引用） */
export const WALL_DH = 3.0;
/** 平台：3×3 高差 ≤ 此值（高地面要件） */
const PLATFORM_DH = 0.75;
/** 隆起：相对 12m 环均高 ≥ 此值（高地面要件） */
const RELIEF_DH = 1.2;
/** 坡面：|∇h| ≥ 此值（米/格；0.25 ≈ 0.0625 m/m） */
const SLOPE_FACE = 0.25;
/** 坡向有效下限（|下坡·d̂舰| 小于此值 → 平/侧） */
const ASPECT_EPS = 0.25;
/** 缝道：W ≤ 此值（格） */
const NARROW_MAX = 2;
/** 长条：沿缝轴 ≥ 此值（格） */
const LONG_RUN = 6;
/** 连续可走格扫描上限（格） */
const RUN_CAP = 16;
/** 山顶上限（格）：高地块面积 ≤ 此值 = 山顶；> 此值或含舰 = 高原 */
const PEAK_MAX_CELLS = 60;
/** LOS 采样步长（米）与净空（米） */
const LOS_STEP = 2;
const LOS_CLEAR = 0.2;
/** 视点高度：舰船侧 +1.6m，目标格 +0.4m（人眼 vs 地面） */
const EYE_SHIP = 1.6;
const EYE_TARGET = 0.4;

/** ★ C2 地形结构：kind（互斥；数值即调试显示顺序） */
export const KIND = {
  Flat: 0,     // 平地
  Face: 1,     // 坡面（山的腰/小起伏）
  Peak: 2,     // 山顶（小面积高地面）
  Plateau: 3,  // 高原（大面积高地面 / 含舰）
  Gap: 4,      // 缝道（窄道；W/θ*/长条）
} as const;
export type Kind = typeof KIND[keyof typeof KIND];

export const KIND_NAMES: readonly string[] = ['平地', '坡面', '山顶', '高原', '缝道'];

/** ★ C3 对舰关系：slopeDir */
export const SLOPE_DIR = {
  Flat: 0,   // 平/侧
  Front: 1,  // 迎舰
  Back: 2,   // 背舰
} as const;
export type SlopeDir = typeof SLOPE_DIR[keyof typeof SLOPE_DIR];

export const SLOPE_DIR_NAMES: readonly string[] = ['平/侧', '迎舰', '背舰'];

/** 事实表统计（回读/评估用） */
export interface L1Stats {
  buildMs: number;
  side: number;
  cells: number;
  kinds: Record<string, number>;
  narrow: number;
  narrowLong: number;
  frontShip: number;
  backShip: number;
  occluded: number;
  peakCells: number;
  plateauCells: number;
  anchor: { x: number; z: number };
  ao: { x: number; z: number };
}

export class TerrainSemantics {
  private ready = false;
  /** 窗口中心 = **舰**（C3 参照） */
  private ax = 0;
  private az = 0;
  /** 落点（AO 锚；仅用于重建检测/回读） */
  private aox = 0;
  private aoz = 0;
  /** 活动窗口半径与边长（格） */
  private r = L1_R;
  private n = 0;
  private sx = 0;
  private sz = 0;
  private buildMs = 0;
  /** 舰眼点高度（舰处地形高 + EYE_SHIP） */
  private eyeY = 0;
  private samplerRef: FieldSampler | null = null;

  /** C1：原始高度（采样） */
  private readonly rawH = new Float32Array(SIDE_MAX * SIDE_MAX);
  /** C1：平滑高度（3×3；梯度/坡向/LOS 用） */
  private readonly h = new Float32Array(SIDE_MAX * SIDE_MAX);
  /** C2：结构 kind */
  private readonly kind = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** C2：梯度幅值（米/格） */
  private readonly slope = new Float32Array(SIDE_MAX * SIDE_MAX);
  /** C2：缝道宽度（0=非缝道，1=4m，2=8m，3=更宽） */
  private readonly narrowW = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** C2：缝道法线（0..3 四向；255=无） */
  private readonly narrowDir = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** C2：长条缝道（沿缝轴 ≥6 格） */
  private readonly narrowLong = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** C3：坡向（0 平/侧 / 1 迎舰 / 2 背舰） */
  private readonly slopeDir = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** C3：对舰遮挡（地形；水不挡） */
  private readonly occluded = new Uint8Array(SIDE_MAX * SIDE_MAX);
  /** 兼容口：非陡壁（**不是**寻路可行性；可行性=PassTable） */
  private readonly standable = new Uint8Array(SIDE_MAX * SIDE_MAX);

  get isReady(): boolean { return this.ready; }
  /** 窗口中心（= 舰） */
  get anchor(): { x: number; z: number } { return { x: this.ax, z: this.az }; }
  /** 落点 AO 锚（= 窗口半径依据） */
  get aoAnchor(): { x: number; z: number } { return { x: this.aox, z: this.aoz }; }

  // ============================================================
  // 构建（落地/换落点/舰动一次）
  // @param cx/cz  窗口中心 = **舰**（C3 参照；坡向与遮挡都相对它）
  // @param radius 窗口半径（米；缺省 L1_R，罩住舰↔落点走廊用 dist+60）
  // @param aoX/aoZ 落点 AO（仅记录；用于重建检测）
  // ============================================================
  build(sampler: FieldSampler, cx: number, cz: number, radius = L1_R, aoX = cx, aoZ = cz): void {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.ax = cx; this.az = cz;
    this.aox = aoX; this.aoz = aoZ;
    this.r = Math.max(L1_CELL, Math.min(R_MAX, radius));
    this.n = Math.floor((this.r * 2) / L1_CELL) + 1;
    this.sx = cx - this.r;
    this.sz = cz - this.r;
    this.samplerRef = sampler;
    this.eyeY = sampler.heightAt(cx, cz) + EYE_SHIP;
    const n = this.n, n2 = n * n;
    this.kind.fill(KIND.Flat, 0, n2);
    this.narrowW.fill(0, 0, n2);
    this.narrowDir.fill(255, 0, n2);
    this.narrowLong.fill(0, 0, n2);
    this.slopeDir.fill(SLOPE_DIR.Flat, 0, n2);
    this.occluded.fill(0, 0, n2);
    this.standable.fill(1, 0, n2);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        this.rawH[i] = sampler.heightAt(x, z);
        this.slope[i] = 0;
      }
    }
    this.smoothHeights();
    this.computeGradients();     // C1.h → |∇h|（C2）与坡向（C3）
    this.computeLos();           // C3.occluded（舰眼点 3D）
    this.computeStructure();     // C2：缝道 → 高地分档 → 坡面 → 平地
    this.ready = true;
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  // ============================================================
  // 读表 API
  // ============================================================

  /** ★ 统一事实查询口（表外/未就绪 → null；不评分） */
  cellAt(x: number, z: number): {
    h: number; kind: Kind; slope: number;
    narrowW: number; narrowDir: number; narrowLong: boolean;
    slopeDir: SlopeDir; occluded: boolean;
  } | null {
    const i = this.indexAt(x, z);
    if (i < 0) return null;
    return {
      h: this.h[i],
      kind: this.kind[i] as Kind,
      slope: this.slope[i],
      narrowW: this.narrowW[i],
      narrowDir: this.narrowDir[i],
      narrowLong: this.narrowLong[i] === 1,
      slopeDir: this.slopeDir[i] as SlopeDir,
      occluded: this.occluded[i] === 1,
    };
  }

  /** C2 结构 kind（表外 → Flat） */
  kindAt(x: number, z: number): Kind {
    const i = this.indexAt(x, z);
    return (i < 0 ? KIND.Flat : this.kind[i]) as Kind;
  }

  /** C2 梯度幅值（米/格；表外 → 0） */
  slopeMagAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.slope[i];
  }

  /** C2 缝道宽度（0=非缝道，1=4m，2=8m，3=更宽；表外 → 0） */
  narrowWidthAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.narrowW[i];
  }

  /** C2 缝道法线（0..3 四向；255=无；表外 → 255） */
  narrowDirAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 255 : this.narrowDir[i];
  }

  /** C2 长条缝道（沿缝轴 ≥6 格） */
  isNarrowLongAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.narrowLong[i] === 1;
  }

  /** C3 坡向（0 平/侧 / 1 迎舰 / 2 背舰；表外 → 0） */
  slopeDirAt(x: number, z: number): SlopeDir {
    const i = this.indexAt(x, z);
    return (i < 0 ? SLOPE_DIR.Flat : this.slopeDir[i]) as SlopeDir;
  }

  /** C3 对舰遮挡（舰眼点 3D；水不挡） */
  occludedAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.occluded[i] === 1;
  }

  /** 平滑高度（C1；未就绪/表外 → NaN） */
  smoothHeightAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.h[i];
  }

  /** 原始采样高度（C1 回读；未就绪/表外 → NaN） */
  rawHeightAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.rawH[i];
  }

  /** 兼容口：非陡壁（**不是**寻路可行性；请用 PassTable + cellAt） */
  isPassableAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.standable[i] === 1;
  }

  /** 回读统计（评估用） */
  stats(): L1Stats {
    const kinds: Record<string, number> = {};
    for (const k of KIND_NAMES) kinds[k] = 0;
    let narrow = 0, narrowLong = 0, frontShip = 0, backShip = 0, occluded = 0;
    let peakCells = 0, plateauCells = 0;
    const n2 = this.n * this.n;
    for (let i = 0; i < n2; i++) {
      const k = this.kind[i] as Kind;
      kinds[KIND_NAMES[k]]++;
      if (this.narrowW[i] >= 1 && this.narrowW[i] <= NARROW_MAX) narrow++;
      if (this.narrowLong[i]) narrowLong++;
      if (this.slopeDir[i] === SLOPE_DIR.Front) frontShip++;
      else if (this.slopeDir[i] === SLOPE_DIR.Back) backShip++;
      if (this.occluded[i]) occluded++;
      if (k === KIND.Peak) peakCells++;
      else if (k === KIND.Plateau) plateauCells++;
    }
    return {
      buildMs: Math.round(this.buildMs * 100) / 100,
      side: this.n, cells: n2,
      kinds, narrow, narrowLong, frontShip, backShip, occluded,
      peakCells, plateauCells,
      anchor: { x: this.ax, z: this.az },
      ao: { x: this.aox, z: this.aoz },
    };
  }

  clear(): void {
    this.ready = false;
    this.samplerRef = null;
    this.n = 0;
  }

  // ============================================================
  // 内部：C1 平滑 → 梯度/坡向（C2/C3）→ LOS（C3）→ 结构（C2）
  // ============================================================

  private smoothHeights(): void {
    const n = this.n;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        let sum = 0, cnt = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const jz = iz + dz;
          if (jz < 0 || jz >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx;
            if (jx < 0 || jx >= n) continue;
            sum += this.rawH[jz * n + jx]; cnt++;
          }
        }
        this.h[iz * n + ix] = sum / cnt;
      }
    }
  }

  /** 中心差分 → |∇h|（米/格，C2.slope）与坡向（C3.slopeDir；d̂ = 格 → 舰） */
  private computeGradients(): void {
    const n = this.n;
    const cx = this.ax, cz = this.az;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const iL = ix > 0 ? i - 1 : i;
        const iR = ix < n - 1 ? i + 1 : i;
        const iU = iz > 0 ? i - n : i;
        const iD = iz < n - 1 ? i + n : i;
        // ∇h（m/m）→ ×4 得米/格
        const gx = (this.h[iR] - this.h[iL]) / 2 / L1_CELL;
        const gz = (this.h[iD] - this.h[iU]) / 2 / L1_CELL;
        const s = Math.hypot(gx, gz) * L1_CELL;
        this.slope[i] = s;
        if (s < 1e-6) { this.slopeDir[i] = SLOPE_DIR.Flat; continue; }
        // 下坡方向 = -∇h；与 d̂舰 的余弦（>0 朝舰）
        const dx = -gx, dz = -gz;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const tx = cx - x, tz = cz - z;
        const td = Math.hypot(tx, tz);
        if (td < 1) { this.slopeDir[i] = SLOPE_DIR.Flat; continue; }
        const a = (dx * tx + dz * tz) / (Math.hypot(dx, dz) * td);
        this.slopeDir[i] = a > ASPECT_EPS ? SLOPE_DIR.Front : a < -ASPECT_EPS ? SLOPE_DIR.Back : SLOPE_DIR.Flat;
      }
    }
  }

  /** 舰眼点 → 每格的高度场 3D LOS（原始高度采样；水不挡视线） */
  private computeLos(): void {
    const n = this.n;
    const cx = this.ax, cz = this.az;
    const eye = this.eyeY;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const dx = x - cx, dz = z - cz;
        const dist = Math.hypot(dx, dz);
        if (dist < L1_CELL) { this.occluded[i] = 0; continue; }
        const target = this.h[i] + EYE_TARGET;
        const steps = Math.max(2, Math.ceil(dist / LOS_STEP));
        let blocked = 0;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const px = cx + dx * t, pz = cz + dz * t;
          const lineH = eye + (target - eye) * t;
          if (this.heightNearestRaw(px, pz) > lineH + LOS_CLEAR) { blocked = 1; break; }
        }
        this.occluded[i] = blocked;
      }
    }
  }

  /** LOS 采样：用**原始高度**（平滑只服务坡向；窄缝/门洞必须保留真实落差）；
   *  出窗（窗口边）→ 用采样器补真实高度 */
  private heightNearestRaw(px: number, pz: number): number {
    const n = this.n;
    let ix = Math.round((px - this.sx - L1_CELL / 2) / L1_CELL);
    let iz = Math.round((pz - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) {
      return this.samplerRef ? this.samplerRef.heightAt(px, pz) : 0;
    }
    return this.rawH[iz * n + ix];
  }

  /** 外环（Chebyshev 半径 3 ≈ 12m）均值 */
  private ringMean(ix: number, iz: number): number {
    const n = this.n;
    let sum = 0, cnt = 0;
    const r = 3;
    for (let dz = -r; dz <= r; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= n) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= n) continue;
        sum += this.rawH[jz * n + jx]; cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : this.rawH[iz * n + ix];
  }

  /** 可走格（判缝道/高地面用）：4m 邻差 ≤ SLOPE_DH */
  private walkableFlat(): Uint8Array {
    const n = this.n;
    const out = new Uint8Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const h = this.rawH[i];
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(this.rawH[i - 1] - h));
        if (ix < n - 1) dh = Math.max(dh, Math.abs(this.rawH[i + 1] - h));
        if (iz > 0) dh = Math.max(dh, Math.abs(this.rawH[i - n] - h));
        if (iz < n - 1) dh = Math.max(dh, Math.abs(this.rawH[i + n] - h));
        out[i] = dh <= SLOPE_DH ? 1 : 0;
      }
    }
    return out;
  }

  /**
   * C2 结构（判定次序：缝道 → 高地分档 → 坡面 → 平地）：
   *   缝道   = 可走 ∧ W ≤2（W = min 四向连续可走格；CAP=16）；长条 = 沿缝轴 ≥6
   *   高地面 = 可走 ∧ 平台（3×3 ≤0.75）∧ relief（−12m 环均 ≥1.2）
   *   山顶/高原 = 高地块 4 邻接扩块：≤60 格=山顶；>60 或含舰=高原
   *   坡面   = 非缝道 ∧ 非高地 ∧ |∇h| ≥0.25（米/格；小起伏也算）
   *   平地   = 其余；不可走格（陡壁）不参与分档（kind 保持平地）
   */
  private computeStructure(): void {
    const n = this.n;
    // ① 陡壁（兼容口 standable；doc：不参与结构分档）
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const h = this.rawH[i];
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(this.rawH[i - 1] - h));
        if (ix < n - 1) dh = Math.max(dh, Math.abs(this.rawH[i + 1] - h));
        if (iz > 0) dh = Math.max(dh, Math.abs(this.rawH[i - n] - h));
        if (iz < n - 1) dh = Math.max(dh, Math.abs(this.rawH[i + n] - h));
        this.standable[i] = dh <= WALL_DH ? 1 : 0;
      }
    }
    const walk = this.walkableFlat();
    // ② 缝道：四向 run 取最小 = W、argmin = 法线；W≤2 = 缝道；沿缝轴 ≥6 = 长条
    const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const run = (ix: number, iz: number, dx: number, dz: number): number => {
      let cnt = 1;
      for (let s = 1; s <= RUN_CAP; s++) { const x = ix + dx * s, z = iz + dz * s; if (x < 0 || z < 0 || x >= n || z >= n || !walk[z * n + x]) break; cnt++; }
      for (let s = 1; s <= RUN_CAP; s++) { const x = ix - dx * s, z = iz - dz * s; if (x < 0 || z < 0 || x >= n || z >= n || !walk[z * n + x]) break; cnt++; }
      return cnt;
    };
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = iz * n + ix;
        if (!walk[i] || !this.standable[i]) continue;
        let wmin = 99, dm = 0;
        for (let d = 0; d < 4; d++) { const rr = run(ix, iz, DIRS[d][0], DIRS[d][1]); if (rr < wmin) { wmin = rr; dm = d; } }
        this.narrowW[i] = Math.min(3, wmin);
        this.narrowDir[i] = dm;
        if (wmin <= NARROW_MAX) {
          this.kind[i] = KIND.Gap;
          const pd = dm === 0 ? 1 : dm === 1 ? 0 : dm === 2 ? 3 : 2;
          if (run(ix, iz, DIRS[pd][0], DIRS[pd][1]) >= LONG_RUN) this.narrowLong[i] = 1;
        }
      }
    }
    // ③ 高地面（排除已成缝道格）
    const hi = new Uint8Array(n * n);
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = iz * n + ix;
        if (!walk[i] || this.kind[i] === KIND.Gap) continue;
        let mx = 0;
        for (let a = -1; a <= 1; a++) {
          for (let c = -1; c <= 1; c++) {
            if (!a && !c) continue;
            mx = Math.max(mx, Math.abs(this.rawH[(iz + a) * n + (ix + c)] - this.rawH[i]));
          }
        }
        if (mx > PLATFORM_DH) continue;
        if (this.rawH[i] - this.ringMean(ix, iz) < RELIEF_DH) continue;
        hi[i] = 1;
      }
    }
    // ④ 扩块分档：≤60 格 = 山顶；>60 或含舰 = 高原
    const seen = new Int32Array(n * n).fill(-1);
    for (let s0 = 0; s0 < hi.length; s0++) {
      if (!hi[s0] || seen[s0] >= 0) continue;
      const q: number[] = [s0]; seen[s0] = s0;
      const cells: number[] = [];
      let hasAnchor = false;
      while (q.length > 0) {
        const c = q.pop()!;
        cells.push(c);
        const cx = c % n, cz = (c - cx) / n;
        const wx = this.sx + cx * L1_CELL + L1_CELL / 2, wz = this.sz + cz * L1_CELL + L1_CELL / 2;
        if (Math.abs(wx - this.ax) <= L1_CELL && Math.abs(wz - this.az) <= L1_CELL) hasAnchor = true;
        for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const j = nz * n + nx;
          if (hi[j] && seen[j] < 0) { seen[j] = s0; q.push(j); }
        }
      }
      const k = hasAnchor || cells.length > PEAK_MAX_CELLS ? KIND.Plateau : KIND.Peak;
      for (const c of cells) this.kind[c] = k;
    }
    // ⑤ 坡面 → 平地
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const i = iz * n + ix;
        if (this.kind[i] !== KIND.Flat) continue;
        if (!walk[i] || !this.standable[i]) continue;
        if (this.slope[i] >= SLOPE_FACE) this.kind[i] = KIND.Face;
      }
    }
  }

  private indexAt(x: number, z: number): number {
    const n = this.n;
    if (n <= 1) return -1;
    const ix = Math.round((x - this.sx - L1_CELL / 2) / L1_CELL);
    const iz = Math.round((z - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return -1;
    return iz * n + ix;
  }
}
