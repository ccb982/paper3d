// ============================================================
// TerrainScore —— 地块有利位置评分表（全敌共享的唯一战场视图；2026-09-21 用户定调）
// ============================================================
// 一句话：把地形扫描从"一次性点位清单"升级为**逐格评分表**——
//   每格 = 静态地形真源（高度/可站/坡面/墙面/坑水/战壕）+ 有利度评分；
//   每格分 = 态势权重 × [高度 + 舰船距离 + 掩体/战壕加成 − 近舰负分]；
//   距离锚 = 玩家要守的舰船；所有兵种/寻路/指挥都读它（读法不同）。
// 网格：★ 4m（与地形块/挖掘同网格，1 格 = 1 块）；半径 144m（73×73 ≈ 5.3k 格）。
// 更新：换落点/态势 → 全量重建；**建成掩体 / 挖掘（战壕、坑）→ 局部重算**
//   （invalidateArea：脏格 + 邻环，坡面/墙面依赖邻格高差）。
// 通行分类 cls：0 可走 / 1 坡面(减速) / 2 墙面(硬边界) / 3 坑洞水域(硬边界)。
// 战壕：低于邻域均值 ≥0.6m 的可走格 → 自动识别（无需登记表），给掩体加成。
// 动态障碍（实体/掩体/单位）**不进表**：由独立模块叠加（⏳ BlockerLayer）。
// ============================================================

import type { RasterMap } from '../../services/map/RasterMap';
import { samplerFor, type TerrainSampler } from '../../services/map/TerrainSampler';
import type { BattlePosture } from './Posture';
import type { DefensePlan } from './LandingTerrain';

/** 评分格边长（米；★ 4m = 地形块网格，与挖掘同源） */
const CELL = 4;
/** 表半径（米；覆盖落点周边） */
const R = 144;
const SIDE = Math.floor((R * 2) / CELL) + 1;

// ---- ★ 通行分类（cls）：0 可走 / 1 坡面(减速) / 2 墙面(硬边界) / 3 坑洞水域(硬边界) ----
/** 相邻格（4m）高差 > 1.5m ≈ 21° 视为坡面（可走、减速扣分） */
export const SLOPE_DH = 1.5;
/** 高差 > 3.0m ≈ 37° 视为墙面（硬边界，不可走） */
export const WALL_DH = 3.0;
/** 低于邻域均值 ≥ 0.6m → 自然低洼视为战壕（可走 + 掩体加成） */
/** ★ 被"挖掘标记"过的格：阈值降到 0.12m（digRect 一次只 +1 层 ≈0.2m） */
const TRENCH_DH_DUG = 0.12;
const TRENCH_SCORE = 1.2;
/** ★ 紧贴硬墙的可站格 → 掩体加成（硬墙当掩体；不挡站位的墙给邻格加分） */
const WALL_COVER_SCORE = 0.8;
/** ★ 水中不适惩罚（允许站水里，但不如岸上；移动端再加"上岸权重"） */
const WATER_PENALTY = 0.6;
/** ★ 距离项归一化：d/R（0~1）× 此系数 → 与高度/掩体量级可比（否则 180m 距离项碾压一切；
 *  调大 → 距离影响更强：总攻压向舰船更狠、前期更往外展开） */
const DIST_SCALE = 12;
/** ★ 掩体判定加成（敌侧有墙/身处战壕 → 队长选位加分） */
const COVER_BONUS = 2.0;
/** 坡面代价（分数扣减 / 路径代价倍率） */
const SLOPE_PENALTY = 0.6;
export const SLOPE_COST = 1.6;

/** ★ 态势权重表（h 高度 / dist 舰距 / threat 玩家距 / cover 掩体 / width 宽度 / choke 隘口 / near 近舰负分） */
export const PHASE_WEIGHTS: Record<BattlePosture, {
  h: number; dist: number; threat: number; cover: number; width: number; choke: number; near: number;
}> = {
  fortify:  { h: 0.6, dist: 0.06, threat: 0, cover: 0.8, width: 0.05, choke: 0.20, near: 1.6 },
  patrol:   { h: 0.6, dist: 0.08, threat: 0, cover: 0.8, width: 0.10, choke: 0.30, near: 1.2 },
  advance:  { h: 0.5, dist: 0.02, threat: -0.05, cover: 1.0, width: 0.25, choke: 0.20, near: 0.0 },
  mass:     { h: 0.4, dist: -0.06, threat: -0.10, cover: 1.0, width: 0.35, choke: 0.10, near: 0.0 },
  assault:  { h: 0.3, dist: -0.35, threat: -0.15, cover: 0.6, width: 0.40, choke: 0.05, near: 0.0 },
  withdraw: { h: 0.5, dist: 0.25, threat: 0.60, cover: 1.2, width: 0.20, choke: 0.10, near: 0.0 },
};

export interface ScoreWeights {
  h: number; dist: number; threat: number; cover: number; width: number; choke: number; near: number;
}

/** ★ 宽度/隘口项的量级系数（与 DIST_SCALE 同思路：拉平到与高度可比） */
export const FEAT_SCALE = 4;

/** ★ 原始特征（L3 scoreFor 读口；重构 P1，2026-09-22）：不含兵种权重的字段快照。
 *  距离/威胁已归一到与 score 相同口径；constTerm = 贴墙/战壕/水/坡常量（与权重无关）。 */
export interface CellFeats {
  pass: boolean;
  h: number;          // 高度（米）
  shipD: number;      // 归一舰距 (d/R)·DIST_SCALE
  nearF: number;      // 近舰负分项（≤0；× w.near）
  threatN: number;    // 归一玩家距 (dt/R)·DIST_SCALE（读时用实时玩家位置）
  playerD: number;    // 玩家距（米；远程射程带用）
  cover: number;      // L2 工事加成原值（× w.cover）
  width: number;      // 通行宽度 0~1
  choke: number;      // 隘口 0/1
  trench: number;     // 战壕 0/1
  constTerm: number;  // 贴墙·战壕·水·坡 常量项（直接加总）
}

/** ★ 态势强度 p 的权重锚点（连续插值；锚点沿用现行档位值，M3 再换归一化口径） */
const P_ANCHORS: ReadonlyArray<readonly [number, ScoreWeights]> = [
  [0.05, PHASE_WEIGHTS.fortify],
  [0.25, PHASE_WEIGHTS.patrol],
  [0.45, PHASE_WEIGHTS.advance],
  [0.65, PHASE_WEIGHTS.mass],
  [0.90, PHASE_WEIGHTS.assault],
];

/** ★ 由态势强度 p 取权重（分段线性；withdraw 走独立档）——表的权重来源 = 态势函数 */
export function weightsFor(p: number, posture: BattlePosture): ScoreWeights {
  if (posture === 'withdraw') return PHASE_WEIGHTS.withdraw;
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  let a = P_ANCHORS[0];
  for (const b of P_ANCHORS) {
    if (t <= b[0]) {
      const span = b[0] - a[0];
      const k = span > 0 ? (t - a[0]) / span : 0;
      const wa = a[1], wb = b[1];
      return {
        h: wa.h + (wb.h - wa.h) * k,
        dist: wa.dist + (wb.dist - wa.dist) * k,
        threat: wa.threat + (wb.threat - wa.threat) * k,
        cover: wa.cover + (wb.cover - wa.cover) * k,
        width: wa.width + (wb.width - wa.width) * k,
        choke: wa.choke + (wb.choke - wa.choke) * k,
        near: wa.near + (wb.near - wa.near) * k,
      };
    }
    a = b;
  }
  return PHASE_WEIGHTS.assault;
}

export class TerrainScore {
  private sx = 0;
  private sz = 0;
  private stamp = -1;
  private ready = false;
  private readonly score = new Float32Array(SIDE * SIDE);
  private readonly pass = new Uint8Array(SIDE * SIDE);
  /** ★ 通行分类：0 可走 / 1 坡面 / 2 墙面(硬边界) / 3 坑洞水域(硬边界) */
  private readonly cls = new Uint8Array(SIDE * SIDE);
  /** ★ 战壕（低于邻域的可走格；掩体加成已在分内） */
  private readonly trench = new Uint8Array(SIDE * SIDE);
  /** ★ 遮蔽加成（0~1.6：built covers/posts 1 + 战壕 1 + 贴墙 0.6）→ 寻路折扣（战壕/掩体=加分点） */
  private readonly coverF = new Float32Array(SIDE * SIDE);
  /** ★ L2 工事 bonus 原值（scoreFor 特征用；不含战壕/贴墙常量） */
  private readonly featCover = new Float32Array(SIDE * SIDE);
  /** ★ 紧贴硬墙（陡差 >0.8×WALL_DH 的可站格；硬墙当掩体判定用） */
  private readonly wallNear = new Uint8Array(SIDE * SIDE);
  /** ★ 水域格（可站；分数 -WATER_PENALTY，移动端在岸上时优先上岸） */
  private readonly water = new Uint8Array(SIDE * SIDE);
  /** ★ 挖掘标记格（显式挖过的格；阈值放宽到 0.12m；跨重建保留） */
  private readonly dug = new Uint8Array(SIDE * SIDE);
  /** 重建中间量：逐格高度（第二遍算坡面/墙面/战壕用；复用零分配） */
  private readonly heights = new Float32Array(SIDE * SIDE);
  /** ★ 平滑分 S̃（3×3 均值；防掩体/阻挡格跳变把梯度带偏） */
  private readonly sm = new Float32Array(SIDE * SIDE);
  /** ★ 通行宽度 0~1（轴向连续可站格/4）与隘口标记 */
  private readonly width = new Float32Array(SIDE * SIDE);
  private readonly choke = new Uint8Array(SIDE * SIDE);
  /** 玩家位置（威胁距项；随重建刷新） */
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  /** 最近一次重建参数（局部重算 invalidateArea 必须复用同一套权重/加成） */
  private lastRaster: RasterMap | null = null;
  private lastPlan: DefensePlan | null = null;
  private lastBonus: Map<string, number> | null = null;
  private lastW: ScoreWeights | null = null;
  /** ★ 统一采样器（同域一次采样多处复用） */
  private smp: TerrainSampler | null = null;

  get isReady(): boolean { return this.ready; }

  /** ★ 通行分类（未就绪 → 0） */
  clsAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.cls[i];
  }

  /** ★ 硬边界（墙面/坑洞水域：敌人走不了） */
  blockedAt(x: number, z: number): boolean {
    return this.clsAt(x, z) >= 2;
  }

  /** ★ 战壕格（挖掘产物；可走 + 掩体加成） */
  isTrenchAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.trench[i] === 1;
  }

  /** ★ 紧贴硬墙的可站格（掩体判定；硬墙本身不可站） */
  wallNearAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.wallNear[i] === 1;
  }

  /** ★ 水域格（允许站立；分数更低，移动端在岸上 → 上岸权重） */
  isWaterAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.water[i] === 1;
  }

  /** ★ 通行宽度 0~1（轴向连续可站格；未就绪/表外 → 0） */
  widthAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.width[i];
  }

  /** ★ 隘口（窄口；盾兵守点用） */
  isChokeAt(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.choke[i] === 1;
  }

  /** ★ 路径代价倍率（坡面减速；供 HPA 等粗粒度消费） */
  costAt(x: number, z: number): number {
    const c = this.clsAt(x, z);
    if (c >= 2) return Infinity;
    return c === 1 ? SLOPE_COST : 1;
  }

  /** ★★ 掩体/战壕寻路折扣（0.6~1；《敌人管线设计.md》§5）：遮蔽越多越便宜 →
   *  拆解路径时"尽可能走掩体多的路线"（用户定调 2026-09-21）。SquadPath 逐格乘算。 */
  pathMulAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    if (i < 0 || !this.pass[i]) return 1;
    const c = this.coverF[i];
    return c > 0 ? Math.max(0.6, 1 - 0.4 * c) : 1;
  }

  /** 全量重建（触发戳 = 落点版本 + 态势代次；掩体/挖掘走局部重算）
   *  @param playerX,playerZ 玩家位置（威胁距项 T；缺省 0 视为无威胁） */
  rebuild(
    raster: RasterMap, plan: DefensePlan, builtCovers: readonly { x: number; z: number }[],
    p: number, stamp: number, posture: BattlePosture = 'patrol',
    playerX = 0, playerZ = 0,
  ): void {
    if (this.ready && stamp === this.stamp) return;
    this.stamp = stamp;
    this.sx = plan.cx - R;
    this.sz = plan.cz - R;
    this.lastRaster = raster;
    this.lastPlan = plan;
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;
    this.smp = samplerFor(raster);
    this.lastW = weightsFor(p, posture);
    this.lastBonus = this.buildBonus(plan, builtCovers);
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) this.writeFeature(ix, iz);
    }
    this.classify(0, 0, SIDE - 1, SIDE - 1);
    this.smoothWindow(0, 0, SIDE - 1, SIDE - 1);
    this.ready = true;
  }

  /** ★ 局部重算（挖掘/新掩体）：脏窗 + 邻环 → 特征 + 分类（邻环供坡面/墙面/战壕判据）
   *  @param dug 该窗是"显式挖掘"（战壕）→ 打挖掘标记，阈值放宽到 0.12m */
  invalidateArea(x: number, z: number, r = 12, dug = false): void {
    if (!this.ready || !this.lastRaster) return;
    let ix0 = Math.floor((x - r - this.sx) / CELL);
    let iz0 = Math.floor((z - r - this.sz) / CELL);
    let ix1 = Math.ceil((x + r - this.sx) / CELL);
    let iz1 = Math.ceil((z + r - this.sz) / CELL);
    if (ix1 < 0 || iz1 < 0 || ix0 >= SIDE || iz0 >= SIDE) return;
    const dx0 = Math.max(0, ix0), dz0 = Math.max(0, iz0);
    const dx1 = Math.min(SIDE - 1, ix1), dz1 = Math.min(SIDE - 1, iz1);
    if (dug) {
      for (let iz = dz0; iz <= dz1; iz++) {
        for (let ix = dx0; ix <= dx1; ix++) this.dug[iz * SIDE + ix] = 1;
      }
    }
    ix0 = Math.max(0, ix0 - 1); iz0 = Math.max(0, iz0 - 1);
    ix1 = Math.min(SIDE - 1, ix1 + 1); iz1 = Math.min(SIDE - 1, iz1 + 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) this.writeFeature(ix, iz);
    }
    this.classify(ix0, iz0, ix1, iz1);
    this.smoothWindow(
      Math.max(0, ix0 - 1), Math.max(0, iz0 - 1),
      Math.min(SIDE - 1, ix1 + 1), Math.min(SIDE - 1, iz1 + 1),
    );
  }

  /** ★ 平滑分 S̃（3×3 均值；未就绪/表外 → null） */
  smoothAt(x: number, z: number): number | null {
    if (!this.ready) return null;
    const i = this.indexAt(x, z);
    return i < 0 || !this.pass[i] ? null : this.sm[i];
  }

  /** ★ 平滑梯度（中心差分、单位向量；写入 out；表边/无梯度 → false）
   *  用途：站位/施工点微调（≤2m 小步长）、集结点漂移、热力图可视化 */
  gradientInto(x: number, z: number, out: { x: number; z: number }): boolean {
    if (!this.ready) return false;
    const i = this.indexAt(x, z);
    if (i < 0 || !this.pass[i]) return false;
    const ix = i % SIDE, iz = (i - ix) / SIDE;
    if (ix === 0 || iz === 0 || ix === SIDE - 1 || iz === SIDE - 1) return false;
    const gx = (this.sm[i + 1] - this.sm[i - 1]) / (2 * CELL);
    const gz = (this.sm[i + SIDE] - this.sm[i - SIDE]) / (2 * CELL);
    const l = Math.hypot(gx, gz);
    if (l < 1e-6) { out.x = 0; out.z = 0; return false; }
    out.x = gx / l; out.z = gz / l;
    return true;
  }

  /** ★ 平台区（|∇S̃| 小且分不为负）：集结点/驻守优选位 */
  isPlateau(x: number, z: number, eps = 0.25): boolean {
    if (!this.ready) return false;
    const i = this.indexAt(x, z);
    if (i < 0 || !this.pass[i] || this.sm[i] < 0) return false;
    const ix = i % SIDE, iz = (i - ix) / SIDE;
    if (ix === 0 || iz === 0 || ix === SIDE - 1 || iz === SIDE - 1) return true;
    const gx = Math.abs(this.sm[i + 1] - this.sm[i - 1]);
    const gz = Math.abs(this.sm[i + SIDE] - this.sm[i - SIDE]);
    return Math.hypot(gx, gz) < eps;
  }

  /** ★ 重建时权重快照（parity 断言用：score[] 烙的就是这套） */
  weightsSnapshot(): ScoreWeights | null {
    return this.lastW;
  }

  /** 该点评分（未就绪/表外 → null；不可站 → -1e9） */
  scoreAt(x: number, z: number): number | null {
    if (!this.ready) return null;
    const i = this.indexAt(x, z);
    return i < 0 ? null : (this.pass[i] ? this.score[i] : -1e9);
  }

  /** ★ 原始特征读口（L3 `UnitStrategy.scoreForUnit` 用；重构 P1）
   *  未就绪/表外 → null；threatN/nearF 与 score 同口径；玩家位置读时传入（比烙死进 score 的更实时） */
  featsAt(x: number, z: number, playerX = 0, playerZ = 0): CellFeats | null {
    if (!this.ready || !this.lastPlan) return null;
    const i = this.indexAt(x, z);
    if (i < 0) return null;
    const plan = this.lastPlan;
    // ★ 距离/威胁一律用**格心**算（score[] 烙在格心；用查询点会漂 ±2m 破坏 parity）
    const ix = i % SIDE, iz = (i - ix) / SIDE;
    const gx = this.sx + ix * CELL + CELL / 2;
    const gz = this.sz + iz * CELL + CELL / 2;
    const d = Math.hypot(gx - plan.cx, gz - plan.cz);
    const dt = Math.hypot(gx - playerX, gz - playerZ);
    const cls = this.cls[i];
    return {
      pass: this.pass[i] === 1,
      h: this.heights[i],
      shipD: (d / R) * DIST_SCALE,
      nearF: d < 30 ? -(1 - d / 30) * 4 : 0,
      threatN: (dt / R) * DIST_SCALE,
      playerD: dt,
      cover: this.featCover[i],
      width: this.width[i],
      choke: this.choke[i],
      trench: this.trench[i],
      constTerm:
        this.wallNear[i] * WALL_COVER_SCORE +
        this.trench[i] * TRENCH_SCORE -
        this.water[i] * WATER_PENALTY -
        (cls === 1 ? SLOPE_PENALTY : 0),
    };
  }

  /** ★ 半径内最高分战壕格（全兵种战壕偏好；窗口扫描；可限定距离带 [minD, maxD]）
   *  距离以 (x,z) 为圆心；无 → null */
  bestTrenchNear(
    x: number, z: number, radius: number, minD = 0, maxD = Infinity,
  ): { x: number; z: number; score: number } | null {
    if (!this.ready) return null;
    const ix0 = Math.max(0, Math.floor((x - radius - this.sx) / CELL));
    const iz0 = Math.max(0, Math.floor((z - radius - this.sz) / CELL));
    const ix1 = Math.min(SIDE - 1, Math.ceil((x + radius - this.sx) / CELL));
    const iz1 = Math.min(SIDE - 1, Math.ceil((z + radius - this.sz) / CELL));
    const r2 = radius * radius;
    const min2 = minD * minD, max2 = maxD * maxD;
    let best: { x: number; z: number; score: number } | null = null;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (this.trench[i] !== 1 || !this.pass[i]) continue;
        const bx = this.sx + ix * CELL + CELL / 2;
        const bz = this.sz + iz * CELL + CELL / 2;
        const d2 = (bx - x) ** 2 + (bz - z) ** 2;
        if (d2 > r2 || d2 < min2 || d2 > max2) continue;
        if (!best || this.score[i] > best.score) best = { x: bx, z: bz, score: this.score[i] };
      }
    }
    return best;
  }

  /** ★ 半径内最高分格（窗口扫描；消费方：站位/集结/施工排序；无 → null） */
  bestNear(x: number, z: number, radius: number): { x: number; z: number; score: number } | null {
    if (!this.ready) return null;
    const ix0 = Math.max(0, Math.floor((x - radius - this.sx) / CELL));
    const iz0 = Math.max(0, Math.floor((z - radius - this.sz) / CELL));
    const ix1 = Math.min(SIDE - 1, Math.ceil((x + radius - this.sx) / CELL));
    const iz1 = Math.min(SIDE - 1, Math.ceil((z + radius - this.sz) / CELL));
    const r2 = radius * radius;
    let best: { x: number; z: number; score: number } | null = null;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (!this.pass[i]) continue;
        const bx = this.sx + ix * CELL + CELL / 2;
        const bz = this.sz + iz * CELL + CELL / 2;
        if ((bx - x) ** 2 + (bz - z) ** 2 > r2) continue;
        if (!best || this.score[i] > best.score) best = { x: bx, z: bz, score: this.score[i] };
      }
    }
    return best;
  }

  /** ★ 掩体判定（队长用）：在半径内找"敌侧有硬墙/身处战壕"的最高分格——
   *  向敌人方向 2m 处是硬边界（墙），或本格是战壕 → 视为可躲的掩体，额外加分。
   *  防御躲墙/硬边/战壕后面走这个；无 → null */
  bestCoverNear(
    x: number, z: number, radius: number, ex: number, ez: number,
  ): { x: number; z: number; score: number } | null {
    if (!this.ready) return null;
    const ix0 = Math.max(0, Math.floor((x - radius - this.sx) / CELL));
    const iz0 = Math.max(0, Math.floor((z - radius - this.sz) / CELL));
    const ix1 = Math.min(SIDE - 1, Math.ceil((x + radius - this.sx) / CELL));
    const iz1 = Math.min(SIDE - 1, Math.ceil((z + radius - this.sz) / CELL));
    const r2 = radius * radius;
    const dx = ex - x, dz = ez - z;
    const dl = Math.hypot(dx, dz) || 1;
    const tx = x + (dx / dl) * 2, tz = z + (dz / dl) * 2;   // 向敌人 2m 的探针
    let best: { x: number; z: number; score: number } | null = null;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (!this.pass[i]) continue;
        const bx = this.sx + ix * CELL + CELL / 2;
        const bz = this.sz + iz * CELL + CELL / 2;
        if ((bx - x) ** 2 + (bz - z) ** 2 > r2) continue;
        // 敌侧探针：以本格为原点、朝敌人方向 2m
        const ddx = ex - bx, ddz = ez - bz;
        const ddl = Math.hypot(ddx, ddz) || 1;
        const px2 = bx + (ddx / ddl) * 3.5, pz2 = bz + (ddz / ddl) * 3.5;
        const covered = this.trench[i] === 1 || this.wallNear[i] === 1 || this.blockedAt(px2, pz2);
        if (!covered) continue;
        const sc = this.score[i] + COVER_BONUS;
        if (!best || sc > best.score) best = { x: bx, z: bz, score: sc };
      }
    }
    return best;
  }

  clear(): void {
    this.ready = false;
    this.stamp = -1;
    this.lastRaster = null;
    this.lastPlan = null;
    this.lastBonus = null;
    this.lastW = null;
  }

  // ============================================================
  // 内部
  // ============================================================

  /** 第一遍：静态特征 + 基础分（坑水 → cls 3，其余待第二遍分类） */
  private writeFeature(ix: number, iz: number): void {
    const raster = this.lastRaster!;
    const plan = this.lastPlan!;
    const w = this.lastW!;
    const bonus = this.lastBonus!;
    const x = this.sx + ix * CELL + CELL / 2;
    const z = this.sz + iz * CELL + CELL / 2;
    const i = iz * SIDE + ix;
    const h = this.smp ? this.smp.heightAt(raster, x, z) : raster.surfaceHeightAt(x, z);
    this.heights[i] = h;
    const role = this.smp ? this.smp.roleAt(raster, x, z) : raster.tileDefAt(x, z).genRole;
    // ★ 硬边界只剩"坑洞/过低"（水域允许站立，软惩罚 + 上岸权重）
    const hardRole = role === 'pit' || h < -1.2;
    this.cls[i] = hardRole ? 3 : 0;
    this.water[i] = role === 'liquid' ? 1 : 0;
    this.trench[i] = 0;
    const bv = bonus.get(this.key(x, z)) ?? 0;
    this.featCover[i] = bv;
    this.coverF[i] = bv > 0 ? 1 : 0;
    const d = Math.hypot(x - plan.cx, z - plan.cz);
    // ★ 距离项按 R 归一化（点积量级与 h/cover 可比；见 DIST_SCALE 注释）
    let s = w.h * h + w.dist * (d / R) * DIST_SCALE + bv * w.cover;
    if (w.near > 0 && d < 30) s -= w.near * (1 - d / 30) * 4;   // 近舰负分（前期往外展开）
    // ★ T 威胁距（玩家）：负权重 = 压向玩家（总攻），正权重 = 远离（撤退）
    if (w.threat !== 0) {
      const dt = Math.hypot(x - this.lastPlayerX, z - this.lastPlayerZ);
      s += w.threat * (dt / R) * DIST_SCALE;
    }
    if (this.water[i] === 1) s -= WATER_PENALTY;                 // 水中不适（软惩罚）
    this.score[i] = s;
  }

  /** 第二遍：由邻格高差判坡面/墙面，由邻域低洼判战壕（含加减分） */
  private classify(ix0: number, iz0: number, ix1: number, iz1: number): void {
    const heights = this.heights;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (this.cls[i] === 3) { this.pass[i] = 0; this.score[i] = -1e9; this.wallNear[i] = 0; this.water[i] = 0; continue; }
        const h = heights[i];
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(h - heights[i - 1]));
        if (ix < SIDE - 1) dh = Math.max(dh, Math.abs(h - heights[i + 1]));
        if (iz > 0) dh = Math.max(dh, Math.abs(h - heights[i - SIDE]));
        if (iz < SIDE - 1) dh = Math.max(dh, Math.abs(h - heights[i + SIDE]));
        if (dh > WALL_DH) { this.cls[i] = 2; this.pass[i] = 0; this.score[i] = -1e9; this.wallNear[i] = 0; continue; }
        this.cls[i] = dh > SLOPE_DH ? 1 : 0;
        this.pass[i] = 1;
        if (this.cls[i] === 1) this.score[i] -= SLOPE_PENALTY;
        // ★ 通行宽度 W（轴向连续可站格，上限 4）与隘口 K（窄口）
        let runX = 1, runZ = 1;
        for (let k = 1; k <= 3 && ix - k >= 0 && this.pass[i - k] === 1; k++) runX++;
        for (let k = 1; k <= 3 && ix + k < SIDE && this.pass[i + k] === 1; k++) runX++;
        for (let k = 1; k <= 3 && iz - k >= 0 && this.pass[i - k * SIDE] === 1; k++) runZ++;
        for (let k = 1; k <= 3 && iz + k < SIDE && this.pass[i + k * SIDE] === 1; k++) runZ++;
        const wCells = Math.min(runX, runZ);
        this.width[i] = Math.min(1, wCells / 4);
        this.choke[i] = wCells <= 1 ? 1 : 0;
        const wt = this.lastW;
        if (wt) this.score[i] += (wt.width * this.width[i] + wt.choke * this.choke[i]) * FEAT_SCALE;
        // ★ 硬墙当掩体：紧贴墙面（邻格陡差）的可站格 → 掩体加成
        // ★ 收口：wallNear 只是"地形墙"特征（计入地形分），**不再当掩体加成**（掩体加成只来自 L2 表）
        this.wallNear[i] = dh > WALL_DH * 0.8 ? 1 : 0;
        if (this.wallNear[i] === 1) this.score[i] += WALL_COVER_SCORE;
        // ★ 收口：战壕只认**挖掘标记**（与 HoleMask 同源：digCell 层深 ≥0.12m）——
        //   不再用"自然低洼"自判（AI 的战壕语义 = L2 工事表 holes）
        this.trench[i] = this.dug[i] === 1 ? 1 : 0;
        if (this.trench[i] === 1) { this.score[i] += TRENCH_SCORE; this.coverF[i] += 1; }
      }
    }
  }

  /** 3×3 均值平滑（窗口；阻挡格不可用 → -1e9） */
  private smoothWindow(ix0: number, iz0: number, ix1: number, iz1: number): void {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (!this.pass[i]) { this.sm[i] = -1e9; continue; }
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const jz = iz + dz;
          if (jz < 0 || jz >= SIDE) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx;
            if (jx < 0 || jx >= SIDE) continue;
            const j = jz * SIDE + jx;
            if (!this.pass[j]) continue;
            sum += this.score[j]; n++;
          }
        }
        this.sm[i] = n > 0 ? sum / n : this.score[i];
      }
    }
  }

  /** 掩体/制高加成表（扫描产物 + 已建掩体） */
  private buildBonus(plan: DefensePlan, builtCovers: readonly { x: number; z: number }[]): Map<string, number> {
    const bonus = new Map<string, number>();
    for (const p of plan.posts) bonus.set(this.key(p.x, p.z), p.kind === 'cover' ? 1.2 : 0.8);
    for (const c of builtCovers) bonus.set(this.key(c.x, c.z), 2.5);   // ★ 造好的掩体 = 新有利位置
    return bonus;
  }

  /** 世界坐标 → 表内下标（表外 → -1） */
  private indexAt(x: number, z: number): number {
    const ix = Math.round((x - this.sx - CELL / 2) / CELL);
    const iz = Math.round((z - this.sz - CELL / 2) / CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return -1;
    return iz * SIDE + ix;
  }

  private key(x: number, z: number): string {
    return `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  }
}
