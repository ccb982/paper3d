// ============================================================
// TerrainSemantics —— L1 敌人地形语义表（静态·舰船锚；《RTS架构.md》§6.0）
// ============================================================
// ★ 表管线位置（用户定 2026-09-25）：这是**消费层**，与可行性表 PassTable **正交**：
//   地形真相源（Tiles/ChunkGenerator/Refinements.finalRuling）
//     ├─► PassTable（能不能走：有向边/爬坡/坑墙）
//     └─► TerrainSemantics（走哪儿更好：战术语义偏好）
//   本表只影响"偏好"（短寻路 risk / TerrainScore 评分），**不决定可行性**。
// 一句话：把高度场重分配成"战术语义"（高地/关口/低谷/迎背船坡/走廊/开阔/隐蔽…），
//   语义区块用梯度≈0 的种子 + BFS 扩块（比 4m 格大）；锚 = 舰船落点，落地算一次。
// 纯逻辑：只依赖 FieldSampler（高度/role）——游戏内接 TerrainSampler，自测接合成地形。
// 分层：Primary 类（互斥，见 Sem）+ 正交标记（aspect 坡向、slope、width、losBlocked、concealed）。
// 方向主轴（用户定调）：面向舰船的坡 = 迎船坡（偏进攻）；背对舰船的坡 = 背船坡（偏防御）。
// 注意：L1 **只基于初始地形**（创建时高度场）；人造改动一律不算类——
//  地形破坏 = 独立掩码模块 HoleMask（原始数据，不参与任何语义类）；
//  敌人读的是另一个**动态坑洞公式表 HoleTable**（深×近打分，持续修改）。

// ============================================================

/** 采样接口：游戏内 = TerrainSampler + RasterMap 的适配器；自测 = 合成高度场 */
export interface FieldSampler {
  heightAt(x: number, z: number): number;
  roleAt(x: number, z: number): string;
}

/** 语义格边长（米；4m = 地形块网格，与挖掘同源；HoleMask/HoleTable 共享） */
export const L1_CELL = 4;
/** 语义表半径（米；覆盖落点周边） */
export const L1_R = 144;
export const SIDE = Math.floor((L1_R * 2) / L1_CELL) + 1;

// ---- 判据常量（初版可调） ----
/** 坡面梯度阈值（m/m；1.5m/4m ≈ 21°） */
const SLOPE_GRAD = 1.5 / 4;
/** 邻格可攀高差（米；与 SLOPE_DH 同源：超过则视为不可跨越） */
const CLIMB_DH = 1.5;
/** 陡壁梯度阈值（m/m；3.0m/4m ≈ 37°，与 TerrainScore.WALL_DH 同源） */
const WALL_GRAD = 3.0 / 4;
/** 平坦判定（m/m）：低于此值才可能算高台/低谷/开阔 */
const FLAT_GRAD = 0.15;
/** 坡向主轴有效下限（|n̂·d̂_ship| 小于此值 → 侧坡，不判迎/背） */
const ASPECT_EPS = 0.25;
/** 高台/低谷的相对邻域高差（米；邻域 = Chebyshev 半径 3 格 ≈ 12m 的外环均值） */
const RELIEF_DH = 1.2;
/** BFS 扩块：相邻格高差容差（米）——面积类（高地/低谷/开阔/隐蔽） */
const REGION_DH = 0.75;
/** BFS 扩块：窄类（关口/走廊/坡）容差放宽（沿走向会有正常落差） */
const REGION_DH_NARROW = 1.5;
/** 区块最小区数（不足 → 降为中性）；关口/走廊是窄特征，单独放宽 */
const REGION_MIN_CELLS = 3;
const REGION_MIN_CHOKE = 1;
const REGION_MIN_CORRIDOR = 2;
/** LOS 采样步长（米）与净空（米） */
const LOS_STEP = 2;
const LOS_CLEAR = 0.2;
/** 视点高度：舰船侧 +1.6m，目标格 +0.4m（人眼 vs 地面） */
const EYE_SHIP = 1.6;
const EYE_TARGET = 0.4;
/** 可站宽度上限（轴向各 3 格，同 TerrainScore） */
const WIDTH_CAP = 3;
/** ★ 战壕判定：当前高比创建时基准低 ≥ 此值（米；一层挖掘 ≈0.2m） */
// 挖掘深度阈值/掩码 = 独立模块 HoleMask；本模块不持有任何破坏数据
/** 语义主类（互斥；数值顺序即调试显示顺序） */
export const Sem = {
  Neutral: 0,
  HighGround: 1,   // 高地/制高
  Hollow: 2,       // 低谷
  FrontSlope: 3,   // 迎船坡（面向舰船 → 偏进攻）
  ReverseSlope: 4, // 背船坡（背对舰船 → 偏防御）
  Choke: 5,        // 关口/隘口
  Corridor: 6,     // 走廊
  Open: 7,         // 开阔地
  Concealed: 8,    // 隐蔽接近/盲区（LOS 被地形遮挡；v1 合并为一类）
  Cliff: 9,        // 陡壁（硬边界）
  Water: 10,       // 水（可走）
  Pit: 11,         // 坑（硬边界）
} as const;
export type Sem = typeof Sem[keyof typeof Sem];

export const SEM_NAMES: readonly string[] = [
  '中性', '高地', '低谷', '迎船坡', '背船坡', '关口', '走廊', '开阔地', '隐蔽', '陡壁', '水', '坑',
];

/** 参与 BFS 扩块的类（地形标记类不扩块：陡壁/水/坑/中性） */
const REGION_CLASSES: readonly Sem[] = [
  Sem.HighGround, Sem.Hollow, Sem.FrontSlope, Sem.ReverseSlope,
  Sem.Choke, Sem.Corridor, Sem.Open, Sem.Concealed,
];

/** 语义区块 */
export interface SemRegion {
  id: number;
  cls: Sem;
  area: number;
  /** 代表点（高地=最高格 / 低谷=最低格 / 其他=离质心最近格） */
  rx: number; rz: number;
  /** 质心 */
  cx: number; cz: number;
  /** 平均坡向（n̂·d̂_ship；仅坡类有意义） */
  aspect: number;
  minH: number; maxH: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** 构建统计（回读/评估用） */
export interface L1Stats {
  buildMs: number;
  side: number;
  cells: number;
  passable: number;
  hist: Record<string, number>;
  regionCount: number;
  regionsByClass: Record<string, { count: number; cells: number; maxArea: number }>;
  losBlocked: number;
  concealed: number;
  anchor: { x: number; z: number };
}

interface Acc {
  area: number; sumX: number; sumZ: number; sumAspect: number; aspectN: number;
  minH: number; maxH: number; minX: number; maxX: number; minZ: number; maxZ: number;
  repX: number; repZ: number; repV: number;
}

export class TerrainSemantics {
  private ready = false;
  private ax = 0;
  private az = 0;
  private sx = 0;
  private sz = 0;
  private buildMs = 0;

  /** 原始高度（采样） */
  private readonly rawH = new Float32Array(SIDE * SIDE);
  /** 平滑高度（3×3；梯度/坡向/LOS 用） */
  private readonly h = new Float32Array(SIDE * SIDE);
  private readonly cls = new Uint8Array(SIDE * SIDE);
  private readonly regionId = new Int16Array(SIDE * SIDE);
  /** n̂·d̂_ship（下坡方向 · 指向舰船；平地 = 0） */
  private readonly aspect = new Float32Array(SIDE * SIDE);
  private readonly slope = new Float32Array(SIDE * SIDE);
  private readonly width = new Float32Array(SIDE * SIDE);
  private readonly losBlocked = new Uint8Array(SIDE * SIDE);
  private readonly passable = new Uint8Array(SIDE * SIDE);
  private readonly hardRole = new Uint8Array(SIDE * SIDE);   // pit / h<-1.2
  private readonly water = new Uint8Array(SIDE * SIDE);
  private smp: FieldSampler | null = null;
  private regionsArr: SemRegion[] = [];

  get isReady(): boolean { return this.ready; }
  get anchor(): { x: number; z: number } { return { x: this.ax, z: this.az }; }

  // ============================================================
  // 构建（落地一次；换落点重算）
  // ============================================================
  build(sampler: FieldSampler, cx: number, cz: number): void {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.smp = sampler;
    this.ax = cx; this.az = cz;
    this.sx = cx - L1_R;
    this.sz = cz - L1_R;
    this.regionId.fill(-1);
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const h = sampler.heightAt(x, z);
        const role = sampler.roleAt(x, z);
        this.rawH[i] = h;
        this.hardRole[i] = (role === 'pit' || h < -1.2) ? 1 : 0;
        this.water[i] = role === 'liquid' ? 1 : 0;
        this.passable[i] = 1;
        this.cls[i] = Sem.Neutral;
        this.aspect[i] = 0;
        this.slope[i] = 0;
        this.width[i] = 0;
        this.losBlocked[i] = 0;
      }
    }
    this.smoothHeights();
    this.computeSlopeAspect();
    this.computeLos();
    const regions = this.classifyAndGrow();
    this.regionsArr = regions;
    // 坑洞/破坏 → HoleMask（独立模块）+ HoleTable（敌用动态表）；L1 只读初始地形
    this.ready = true;
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  // ============================================================
  // 读表 API
  // ============================================================

  /** 主类（未就绪/表外 → Neutral）。**纯初始地形语义**——不受任何挖改/构造影响。 */
  classAt(x: number, z: number): Sem {
    const i = this.indexAt(x, z);
    return i < 0 ? Sem.Neutral : this.cls[i] as Sem;
  }

  /** 语义区块 id（未就绪/表外/无区块 → -1） */
  regionIdAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? -1 : this.regionId[i];
  }

  /** 语义区块对象（无 → null） */
  regionAt(x: number, z: number): SemRegion | null {
    const id = this.regionIdAt(x, z);
    return id < 0 ? null : (this.regionsArr[id] ?? null);
  }

  /** 全部区块（只读） */
  regions(): readonly SemRegion[] { return this.regionsArr; }

  /** 某类语义的区块（按面积降序） */
  regionsOf(cls: Sem): SemRegion[] {
    return this.regionsArr.filter((r) => r.cls === cls).sort((a, b) => b.area - a.area);
  }

  /** 坡向：下坡方向 · 指向舰船（[-1,1]；平地/表外 = 0）——>0 迎船坡、<0 背船坡 */
  aspectAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.aspect[i];
  }

  /** 坡度（m/m；未就绪/表外 = 0） */
  slopeAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.slope[i];
  }

  /** 可站宽度 0~1（轴向连续可站格 / 4；同 TerrainScore 口径） */
  widthAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.width[i];
  }

  /** 可走（非陡壁/坑；水可走） */
  isPassableAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.passable[i] === 1;
  }

  /** 对舰船方向被地形遮挡（LOS blocked） */
  losBlockedAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.losBlocked[i] === 1;
  }

  /** 隐蔽（可走 + LOS 被挡；偷袭/接近用） */
  concealedAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.passable[i] === 1 && this.losBlocked[i] === 1;
  }

  /** 平滑高度（语义判据用的那个 h；未就绪/表外 → NaN） */
  smoothHeightAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.h[i];
  }

  /** 下坡方向（单位向量；写入 out；平地/表外 → false）——坡向箭头的原始方向 */
  downhillInto(x: number, z: number, out: { x: number; z: number }): boolean {
    const i = this.indexAt(x, z);
    if (i < 0) return false;
    const ix = i % SIDE, iz = (i - ix) / SIDE;
    const iL = ix > 0 ? i - 1 : i, iR = ix < SIDE - 1 ? i + 1 : i;
    const iU = iz > 0 ? i - SIDE : i, iD = iz < SIDE - 1 ? i + SIDE : i;
    const gx = (this.h[iR] - this.h[iL]) / (2 * L1_CELL);
    const gz = (this.h[iD] - this.h[iU]) / (2 * L1_CELL);
    const l = Math.hypot(gx, gz);
    if (l < 1e-6) { out.x = 0; out.z = 0; return false; }
    out.x = -gx / l; out.z = -gz / l;
    return true;
  }

  /** 原始采样高度（回读/评估用；未就绪/表外 → NaN） */
  rawHeightAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.rawH[i];
  }

  /** 回读统计（评估用） */
  stats(): L1Stats {
    const hist: Record<string, number> = {};
    for (const n of SEM_NAMES) hist[n] = 0;
    let passable = 0, losBlocked = 0, concealed = 0;
    for (let i = 0; i < this.cls.length; i++) {
      const c = this.cls[i] as Sem;
      hist[SEM_NAMES[c]]++;
      if (this.passable[i]) passable++;
      if (this.losBlocked[i]) losBlocked++;
      if (this.passable[i] && this.losBlocked[i]) concealed++;
    }
    const byCls: Record<string, { count: number; cells: number; maxArea: number }> = {};
    for (const r of this.regionsArr) {
      const key = SEM_NAMES[r.cls];
      const rec = byCls[key] ?? (byCls[key] = { count: 0, cells: 0, maxArea: 0 });
      rec.count++; rec.cells += r.area; rec.maxArea = Math.max(rec.maxArea, r.area);
    }
    return {
      buildMs: Math.round(this.buildMs * 100) / 100,
      side: SIDE, cells: SIDE * SIDE, passable,
      hist, regionCount: this.regionsArr.length, regionsByClass: byCls,
      losBlocked, concealed, anchor: { x: this.ax, z: this.az },
    };
  }

  clear(): void {
    this.ready = false;
    this.regionsArr = [];
    this.regionId.fill(-1);
  }

  // ============================================================
  // 内部：高度平滑 / 坡向 / LOS / 分类 / 扩块
  // ============================================================

  private smoothHeights(): void {
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const jz = iz + dz;
          if (jz < 0 || jz >= SIDE) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx;
            if (jx < 0 || jx >= SIDE) continue;
            sum += this.rawH[jz * SIDE + jx]; n++;
          }
        }
        this.h[iz * SIDE + ix] = sum / n;
      }
    }
  }

  private computeSlopeAspect(): void {
    const cx = this.ax, cz = this.az;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const iL = ix > 0 ? i - 1 : i;
        const iRt = ix < SIDE - 1 ? i + 1 : i;
        const iU = iz > 0 ? i - SIDE : i;
        const iD = iz < SIDE - 1 ? i + SIDE : i;
        const gx = (this.h[iRt] - this.h[iL]) / (2 * L1_CELL);
        const gz = (this.h[iD] - this.h[iU]) / (2 * L1_CELL);
        const s = Math.hypot(gx, gz);
        this.slope[i] = s;
        if (s < 1e-6) { this.aspect[i] = 0; continue; }
        // 下坡方向 = -∇h
        const dx = -gx / s, dz = -gz / s;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const tx = cx - x, tz = cz - z;
        const td = Math.hypot(tx, tz);
        this.aspect[i] = td < 1 ? 0 : (dx * tx + dz * tz) / td;
      }
    }
  }

  /** 舰船 → 每格的高度场 LOS（采样步进；被中间地形挡住 → blocked） */
  private computeLos(): void {
    const cx = this.ax, cz = this.az;
    const ci = this.indexAt(cx, cz);
    const eye = (ci < 0 ? 0 : this.h[ci]) + EYE_SHIP;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const dx = x - cx, dz = z - cz;
        const dist = Math.hypot(dx, dz);
        if (dist < L1_CELL) { this.losBlocked[i] = 0; continue; }
        const target = this.h[i] + EYE_TARGET;
        const steps = Math.max(2, Math.ceil(dist / LOS_STEP));
        let blocked = 0;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const px = cx + dx * t, pz = cz + dz * t;
          const lineH = eye + (target - eye) * t;
          if (this.heightNearestRaw(px, pz) > lineH + LOS_CLEAR) { blocked = 1; break; }
        }
        this.losBlocked[i] = blocked;
      }
    }
  }

  /** LOS 采样：用**原始高度**（平滑只服务坡向；窄缝/门洞必须保留真实落差） */
  private heightNearestRaw(px: number, pz: number): number {
    let ix = Math.round((px - this.sx - L1_CELL / 2) / L1_CELL);
    let iz = Math.round((pz - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0) ix = 0; else if (ix >= SIDE) ix = SIDE - 1;
    if (iz < 0) iz = 0; else if (iz >= SIDE) iz = SIDE - 1;
    return this.rawH[iz * SIDE + ix];
  }

  /** 外环（Chebyshev 半径 3 ≈ 12m）均值 */
  private ringMean(ix: number, iz: number): number {
    let sum = 0, n = 0;
    const r = 3;
    for (let dz = -r; dz <= r; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= SIDE) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= SIDE) continue;
        sum += this.rawH[jz * SIDE + jx]; n++;
      }
    }
    return n > 0 ? sum / n : this.rawH[iz * SIDE + ix];
  }

  /** 分类 + BFS 扩块（返回区块表） */
  private classifyAndGrow(): SemRegion[] {
    // ---- 第一遍：可站判定 + 宽度 + 主类 ----
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        if (this.hardRole[i]) { this.cls[i] = this.water[i] ? Sem.Water : Sem.Pit; this.passable[i] = 0; continue; }
        if (this.water[i]) { this.cls[i] = Sem.Water; this.passable[i] = 1; }
        // 陡壁：邻格最大高差超 WALL_GRAD
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - 1]));
        if (ix < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + 1]));
        if (iz > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - SIDE]));
        if (iz < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + SIDE]));
        if (dh / L1_CELL > WALL_GRAD) { this.cls[i] = Sem.Cliff; this.passable[i] = 0; continue; }
        if (this.cls[i] === Sem.Water) continue;   // 水：保持水类（可走）
        // 宽度（轴向连续"可攀"格：可站 + 相对高差 ≤ CLIMB_DH；各侧上限 3）
        const climbable = (jx: number, jz: number): boolean => {
          if (!this.walkableQuick(jx, jz)) return false;
          const j = jz * SIDE + jx;
          return Math.abs(this.rawH[j] - this.rawH[i]) <= CLIMB_DH;
        };
        let lx = 0; while (lx < WIDTH_CAP && ix - (lx + 1) >= 0 && climbable(ix - (lx + 1), iz)) lx++;
        let rx = 0; while (rx < WIDTH_CAP && ix + (rx + 1) < SIDE && climbable(ix + (rx + 1), iz)) rx++;
        let uz = 0; while (uz < WIDTH_CAP && iz - (uz + 1) >= 0 && climbable(ix, iz - (uz + 1))) uz++;
        let dz2 = 0; while (dz2 < WIDTH_CAP && iz + (dz2 + 1) < SIDE && climbable(ix, iz + (dz2 + 1))) dz2++;
        const runX = 1 + lx + rx, runZ = 1 + uz + dz2;
        const wCells = Math.min(runX, runZ);
        this.width[i] = Math.min(1, wCells / 4);
        // 两侧（窄轴首格之外）是否更高 ≥1.5m（关口/走廊的压迫感）
        // ★ 几何量一律用**原始高度**（平滑只服务坡向；夹持/宽度/LOS 用 raw）
        let flankXL = false, flankXR = false, flankZU = false, flankZD = false;
        if (ix - (lx + 1) >= 0) { const j = i - (lx + 1); if (this.rawH[j] - this.rawH[i] >= 1.5) flankXL = true; }
        if (ix + (rx + 1) < SIDE) { const j = i + (rx + 1); if (this.rawH[j] - this.rawH[i] >= 1.5) flankXR = true; }
        if (iz - (uz + 1) >= 0) { const j = i - (uz + 1) * SIDE; if (this.rawH[j] - this.rawH[i] >= 1.5) flankZU = true; }
        if (iz + (dz2 + 1) < SIDE) { const j = i + (dz2 + 1) * SIDE; if (this.rawH[j] - this.rawH[i] >= 1.5) flankZD = true; }
        const flankX = flankXL || flankXR, flankZ = flankZU || flankZD;
        const s = this.slope[i];
        const relief = this.h[i] - this.ringMean(ix, iz);
        const asp = this.aspect[i];
        // 主类（优先级：关口 > 高地 > 低谷 > 坡 > 走廊 > 开阔 > 隐蔽）
        // 关口：窄到 1 格，且**窄轴两侧都被抬高**（真夹持；单侧墙不算关口）
        const choke = (runX <= 1 && flankXL && flankXR) || (runZ <= 1 && flankZU && flankZD);
        if (s <= SLOPE_GRAD && choke) this.cls[i] = Sem.Choke;
        else if (s <= FLAT_GRAD && relief >= RELIEF_DH) this.cls[i] = Sem.HighGround;
        else if (s <= FLAT_GRAD && relief <= -RELIEF_DH) this.cls[i] = Sem.Hollow;
        else if (s >= SLOPE_GRAD && Math.abs(asp) >= ASPECT_EPS) {
          this.cls[i] = asp > 0 ? Sem.FrontSlope : Sem.ReverseSlope;
        } else if (s <= SLOPE_GRAD && wCells >= 2 && wCells <= 4 && (flankX || flankZ)) this.cls[i] = Sem.Corridor;
        else if (wCells >= 4) this.cls[i] = Sem.Open;
        else if (this.losBlocked[i]) this.cls[i] = Sem.Concealed;
        else this.cls[i] = Sem.Neutral;
        // 隐蔽修正：开阔/走廊/中性被 LOS 挡住 → 隐蔽（坡类/高地保留原类，隐蔽走标记）
        const c = this.cls[i] as Sem;
        if (this.losBlocked[i] && (c === Sem.Open || c === Sem.Corridor || c === Sem.Neutral)) {
          this.cls[i] = Sem.Concealed;
        }
      }
    }
    // ---- 第二遍：BFS 扩块（同类 + 邻步高差容差；不足最小区数 → 降中性） ----
    const regions: SemRegion[] = [];
    const queue = new Int32Array(SIDE * SIDE);
    const inRegion = new Uint8Array(SIDE * SIDE);
    for (let seed = 0; seed < this.cls.length; seed++) {
      const cls = this.cls[seed] as Sem;
      if (!REGION_CLASSES.includes(cls) || inRegion[seed]) continue;
      const tol = (cls === Sem.Choke || cls === Sem.Corridor
        || cls === Sem.FrontSlope || cls === Sem.ReverseSlope) ? REGION_DH_NARROW : REGION_DH;
      const minCells = cls === Sem.Choke ? REGION_MIN_CHOKE
        : cls === Sem.Corridor ? REGION_MIN_CORRIDOR : REGION_MIN_CELLS;
      let qh = 0, qt = 0, area = 0, aborted = false;
      queue[qt++] = seed;
      inRegion[seed] = 1;
      const acc: Acc = {
        area: 0, sumX: 0, sumZ: 0, sumAspect: 0, aspectN: 0,
        minH: this.h[seed], maxH: this.h[seed],
        minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9,
        repX: 0, repZ: 0, repV: cls === Sem.Hollow ? 1e9 : -1e9,
      };
      while (qh < qt) {
        const i = queue[qh++];
        const ix = i % SIDE, iz = (i - ix) / SIDE;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        area++;
        acc.sumX += x; acc.sumZ += z;
        if (this.slope[i] >= SLOPE_GRAD) { acc.sumAspect += this.aspect[i]; acc.aspectN++; }
        const h = this.h[i];
        if (h < acc.minH) acc.minH = h;
        if (h > acc.maxH) acc.maxH = h;
        if (x < acc.minX) acc.minX = x; if (x > acc.maxX) acc.maxX = x;
        if (z < acc.minZ) acc.minZ = z; if (z > acc.maxZ) acc.maxZ = z;
        const better = cls === Sem.Hollow ? h < acc.repV : h > acc.repV;
        if (better) { acc.repV = h; acc.repX = x; acc.repZ = z; }
        // 4 邻域扩散
        for (const j of [ix > 0 ? i - 1 : -1, ix < SIDE - 1 ? i + 1 : -1,
          iz > 0 ? i - SIDE : -1, iz < SIDE - 1 ? i + SIDE : -1]) {
          if (j < 0 || inRegion[j]) continue;
          if ((this.cls[j] as Sem) !== cls) continue;
          if (Math.abs(this.h[j] - h) > tol) continue;
          inRegion[j] = 1;
          queue[qt++] = j;
        }
      }
      if (area < minCells) {
        // 不足最小面积：整体降为中性（不产生小区块噪声）
        for (let k = 0; k < qt; k++) { this.cls[queue[k]] = Sem.Neutral; inRegion[queue[k]] = 0; }
        aborted = true;
      }
      if (aborted) continue;
      const id = regions.length;
      for (let k = 0; k < qt; k++) this.regionId[queue[k]] = id;
      const cxx = acc.sumX / area, czz = acc.sumZ / area;
      // 代表点：高地/低谷已在遍历中取极值；其余 = 离质心最近格（近似用极值顶点兜底）
      let rx = acc.repX, rz = acc.repZ;
      if (cls !== Sem.HighGround && cls !== Sem.Hollow) {
        rx = cxx; rz = czz;
        let bestD = Infinity;
        for (let k = 0; k < qt; k++) {
          const j = queue[k];
          const jx = this.sx + (j % SIDE) * L1_CELL + L1_CELL / 2;
          const jz = this.sz + ((j - (j % SIDE)) / SIDE) * L1_CELL + L1_CELL / 2;
          const d = (jx - cxx) ** 2 + (jz - czz) ** 2;
          if (d < bestD) { bestD = d; rx = jx; rz = jz; }
        }
      }
      regions.push({
        id, cls, area,
        rx, rz, cx: cxx, cz: czz,
        aspect: acc.aspectN > 0 ? acc.sumAspect / acc.aspectN : 0,
        minH: acc.minH, maxH: acc.maxH,
        minX: acc.minX, maxX: acc.maxX, minZ: acc.minZ, maxZ: acc.maxZ,
      });
    }
    return regions;
  }

  /** 快速可站（宽度探测用；水算可站、硬边界/陡壁不算） */
  private walkableQuick(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return false;
    const i = iz * SIDE + ix;
    if (this.hardRole[i]) return false;
    // 陡壁判定（与主分类同口径）
    let dh = 0;
    if (ix > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - 1]));
    if (ix < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + 1]));
    if (iz > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - SIDE]));
    if (iz < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + SIDE]));
    return dh / L1_CELL <= WALL_GRAD;
  }

  private indexAt(x: number, z: number): number {
    const ix = Math.round((x - this.sx - L1_CELL / 2) / L1_CELL);
    const iz = Math.round((z - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return -1;
    return iz * SIDE + ix;
  }
}
