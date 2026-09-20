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
import type { BattlePosture } from './Posture';
import type { DefensePlan } from './LandingTerrain';

/** 评分格边长（米；★ 4m = 地形块网格，与挖掘同源） */
const CELL = 4;
/** 表半径（米；覆盖落点周边） */
const R = 144;
const SIDE = Math.floor((R * 2) / CELL) + 1;

// ---- ★ 通行分类（cls）：0 可走 / 1 坡面(减速) / 2 墙面(硬边界) / 3 坑洞水域(硬边界) ----
/** 相邻格（4m）高差 > 1.5m ≈ 21° 视为坡面（可走、减速扣分） */
const SLOPE_DH = 1.5;
/** 高差 > 3.0m ≈ 37° 视为墙面（硬边界，不可走） */
const WALL_DH = 3.0;
/** 低于邻域均值 ≥ 0.6m → 自然低洼视为战壕（可走 + 掩体加成） */
const TRENCH_DH = 0.6;
/** ★ 被"挖掘标记"过的格：阈值降到 0.12m（digRect 一次只 +1 层 ≈0.2m） */
const TRENCH_DH_DUG = 0.12;
const TRENCH_SCORE = 1.2;
/** ★ 紧贴硬墙的可站格 → 掩体加成（硬墙当掩体；不挡站位的墙给邻格加分） */
const WALL_COVER_SCORE = 0.8;
/** 坡面代价（分数扣减 / 路径代价倍率） */
const SLOPE_PENALTY = 0.6;
export const SLOPE_COST = 1.6;

/** ★ 态势权重表（h 高度 / dist 舰船距离 / cover 掩体制高 / near 近舰负分） */
export const PHASE_WEIGHTS: Record<BattlePosture, { h: number; dist: number; cover: number; near: number }> = {
  fortify:  { h: 0.6, dist: 0.06, cover: 0.8, near: 1.6 },   // 前期：距离权重低，靠近飞船负分
  patrol:   { h: 0.6, dist: 0.08, cover: 0.8, near: 1.2 },
  advance:  { h: 0.5, dist: 0.02, cover: 1.0, near: 0.0 },
  mass:     { h: 0.4, dist: -0.06, cover: 1.0, near: 0.0 },
  assault:  { h: 0.3, dist: -0.35, cover: 0.6, near: 0.0 },  // 总攻：舰船距离猛加（负号=越近越高）
  withdraw: { h: 0.5, dist: 0.25, cover: 1.2, near: 0.0 },   // 撤退：远离舰船
};

export interface ScoreWeights { h: number; dist: number; cover: number; near: number }

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
        cover: wa.cover + (wb.cover - wa.cover) * k,
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
  /** ★ 挖掘标记格（显式挖过的格；阈值放宽到 0.12m；跨重建保留） */
  private readonly dug = new Uint8Array(SIDE * SIDE);
  /** 重建中间量：逐格高度（第二遍算坡面/墙面/战壕用；复用零分配） */
  private readonly heights = new Float32Array(SIDE * SIDE);
  /** 最近一次重建参数（局部重算 invalidateArea 必须复用同一套权重/加成） */
  private lastRaster: RasterMap | null = null;
  private lastPlan: DefensePlan | null = null;
  private lastBonus: Map<string, number> | null = null;
  private lastW: ScoreWeights | null = null;

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

  /** ★ 路径代价倍率（坡面减速；供 SquadPath/HPA 消费，⏳ 接线） */
  costAt(x: number, z: number): number {
    const c = this.clsAt(x, z);
    if (c >= 2) return Infinity;
    return c === 1 ? SLOPE_COST : 1;
  }

  /** 全量重建（触发戳 = 落点版本 + 态势代次；掩体/挖掘走局部重算） */
  rebuild(
    raster: RasterMap, plan: DefensePlan, builtCovers: { x: number; z: number }[],
    p: number, stamp: number, posture: BattlePosture = 'patrol',
  ): void {
    if (this.ready && stamp === this.stamp) return;
    this.stamp = stamp;
    this.sx = plan.cx - R;
    this.sz = plan.cz - R;
    this.lastRaster = raster;
    this.lastPlan = plan;
    this.lastW = weightsFor(p, posture);
    this.lastBonus = this.buildBonus(plan, builtCovers);
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) this.writeFeature(ix, iz);
    }
    this.classify(0, 0, SIDE - 1, SIDE - 1);
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
  }

  /** 该点评分（未就绪/表外 → null；不可站 → -1e9） */
  scoreAt(x: number, z: number): number | null {
    if (!this.ready) return null;
    const i = this.indexAt(x, z);
    return i < 0 ? null : (this.pass[i] ? this.score[i] : -1e9);
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

  /** 半径内最高分格（消费方：站位/集结/施工排序；无 → null） */
  bestNear(x: number, z: number, radius: number): { x: number; z: number; score: number } | null {
    if (!this.ready) return null;
    const r2 = radius * radius;
    let best: { x: number; z: number; score: number } | null = null;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
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
    const h = raster.surfaceHeightAt(x, z);
    this.heights[i] = h;
    const role = raster.tileDefAt(x, z).genRole;
    const hardRole = role === 'pit' || (role === 'liquid' && h < -0.8) || h < -1.2;
    this.cls[i] = hardRole ? 3 : 0;
    this.trench[i] = 0;
    const d = Math.hypot(x - plan.cx, z - plan.cz);
    let s = w.h * h + w.dist * d + (bonus.get(this.key(x, z)) ?? 0) * w.cover;
    if (w.near > 0 && d < 30) s -= w.near * (1 - d / 30) * 4;   // 近舰负分（前期往外展开）
    this.score[i] = s;
  }

  /** 第二遍：由邻格高差判坡面/墙面，由邻域低洼判战壕（含加减分） */
  private classify(ix0: number, iz0: number, ix1: number, iz1: number): void {
    const heights = this.heights;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        if (this.cls[i] === 3) { this.pass[i] = 0; this.score[i] = -1e9; continue; }
        const h = heights[i];
        let dh = 0, sum = 0, n = 0;
        if (ix > 0) { const v = heights[i - 1]; dh = Math.max(dh, Math.abs(h - v)); sum += v; n++; }
        if (ix < SIDE - 1) { const v = heights[i + 1]; dh = Math.max(dh, Math.abs(h - v)); sum += v; n++; }
        if (iz > 0) { const v = heights[i - SIDE]; dh = Math.max(dh, Math.abs(h - v)); sum += v; n++; }
        if (iz < SIDE - 1) { const v = heights[i + SIDE]; dh = Math.max(dh, Math.abs(h - v)); sum += v; n++; }
        if (dh > WALL_DH) { this.cls[i] = 2; this.pass[i] = 0; this.score[i] = -1e9; continue; }
        this.cls[i] = dh > SLOPE_DH ? 1 : 0;
        this.pass[i] = 1;
        if (this.cls[i] === 1) this.score[i] -= SLOPE_PENALTY;
        // ★ 硬墙当掩体：紧贴墙面（邻格陡差）的可站格 → 掩体加成
        if (dh > WALL_DH * 0.8) this.score[i] += WALL_COVER_SCORE;
        // 战壕：显式挖掘标记 → 直接算；否则看自然低洼（低于邻域）
        const thr = this.dug[i] === 1 ? TRENCH_DH_DUG : TRENCH_DH;
        const low = this.dug[i] === 1 || (n > 0 && (sum / n - h) > thr);
        this.trench[i] = low ? 1 : 0;
        if (low) this.score[i] += TRENCH_SCORE;
      }
    }
  }

  /** 掩体/制高加成表（扫描产物 + 已建掩体） */
  private buildBonus(plan: DefensePlan, builtCovers: { x: number; z: number }[]): Map<string, number> {
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
