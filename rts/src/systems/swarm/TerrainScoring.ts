// ============================================================
// TerrainScoring —— 评分面的唯一实现（用户定 2026-09-25 三张表原则）
// ============================================================
// 一句话：**没有第四套网格**——评分 = 三张表 + 高度的**查询时纯函数**：
//   · 地形语义表 TerrainSemantics：可站/宽度/隘口/坡（classAt/widthAt/isPassableAt/slopeAt）
//   · 可行性表 PassTable：高度真源（heightAt）
//   · 战壕掩体表 HoleMask/HoleTable：战壕（isDug）+ 掩体加成（bonus 表）
//   · 地形高度：RasterMap（经 heightAt 采样口传入）
// 评分公式/态势权重沿用 2026-09-21 定调（本文件自 TerrainScore 原样迁出，数值不变）。
// 旧 TerrainScore 的逐格表已删除（数值网格 = 越权第四真源；缓存由消费方按需加）。
// ============================================================

import type { RasterMap } from '../../services/map/RasterMap';
import type { BattlePosture } from './Posture';
import type { DefensePlan } from './LandingTerrain';
import { Sem, type TerrainSemantics } from './TerrainSemantics';
import type { HoleMask } from './HoleMask';
import type { PassTable } from './nav/PassTable';

/** 评分格边长（米；与地形块/工事同网格，用于 bonus/特征量化） */
export const CELL = 4;
/** 距离锚半径（米；覆盖落点周边，与旧表一致） */
export const R = 144;

// ---- ★ 通行分类阈值（与语义表同口径；供墙面/坡面判据） ----
/** 相邻格（4m）高差 > 1.5m ≈ 21° 视为坡面（可走、减速扣分） */
export const SLOPE_DH = 1.5;
/** 高差 > 3.0m ≈ 37° 视为墙面（硬边界，不可走） */
export const WALL_DH = 3.0;
/** 坡面代价（路径代价倍率） */
export const SLOPE_COST = 1.6;

const TRENCH_SCORE = 1.2;
const WALL_COVER_SCORE = 0.8;
const WATER_PENALTY = 0.6;
const SLOPE_PENALTY = 0.6;

/** ★ 距离项归一化：d/R（0~1）× 此系数 → 与高度/掩体量级可比 */
export const DIST_SCALE = 12;
/** ★ 宽度/隘口项的量级系数（与 DIST_SCALE 同思路：拉平到与高度可比） */
export const FEAT_SCALE = 4;

export interface ScoreWeights {
  h: number; dist: number; threat: number; cover: number; width: number; choke: number; near: number;
}

/** ★ 态势权重表（h 高度 / dist 舰距 / threat 玩家距 / cover 掩体 / width 宽度 / choke 隘口 / near 近舰负分） */
export const PHASE_WEIGHTS: Record<BattlePosture, ScoreWeights> = {
  fortify:  { h: 0.6, dist: 0.06, threat: 0, cover: 0.8, width: 0.05, choke: 0.20, near: 1.6 },
  patrol:   { h: 0.6, dist: 0.08, threat: 0, cover: 0.8, width: 0.10, choke: 0.30, near: 1.2 },
  advance:  { h: 0.5, dist: 0.02, threat: -0.05, cover: 1.0, width: 0.25, choke: 0.20, near: 0.0 },
  mass:     { h: 0.4, dist: -0.06, threat: -0.10, cover: 1.0, width: 0.35, choke: 0.10, near: 0.0 },
  assault:  { h: 0.3, dist: -0.35, threat: -0.15, cover: 0.6, width: 0.40, choke: 0.05, near: 0.0 },
  withdraw: { h: 0.5, dist: 0.25, threat: 0.60, cover: 1.2, width: 0.20, choke: 0.10, near: 0.0 },
};

/** ★ 态势强度 p 的权重锚点（连续插值；锚点沿用现行档位值） */
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

/** ★ 原始特征（L3 scoreFor 读口）：不含兵种权重的字段快照。
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

/** ★ 评分数据源（SwarmData 每拍注入；全是只读句柄/快照，不含数值网格） */
export interface ScoringSources {
  raster: RasterMap;
  semantics: TerrainSemantics;
  holeMask: HoleMask;
  passTable: PassTable;
  plan: DefensePlan;
  /** 掩体/工事加成（buildBonus 产物；键 = `round(x/4),round(z/4)`） */
  bonus: ReadonlyMap<string, number>;
  weights: ScoreWeights;
  heightAt: (x: number, z: number) => number;
  playerX: number;
  playerZ: number;
}

/** ★ 掩体/制高加成表（扫描产物 + 已建掩体；键同旧 TerrainScore.key） */
export function buildBonus(plan: DefensePlan, builtCovers: readonly { x: number; z: number }[]): Map<string, number> {
  const bonus = new Map<string, number>();
  for (const p of plan.posts) bonus.set(bonusKey(p.x, p.z), p.kind === 'cover' ? 1.2 : 0.8);
  for (const c of builtCovers) bonus.set(bonusKey(c.x, c.z), 2.5);   // ★ 造好的掩体 = 新有利位置
  return bonus;
}

export function bonusKey(x: number, z: number): string {
  return `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
}

/** 4m 邻格高差判据（与旧 classify 同口径；heightAt 直读地形真源） */
function dhAt(src: ScoringSources, x: number, z: number): number {
  const h = src.heightAt(x, z);
  return Math.max(
    Math.abs(h - src.heightAt(x + CELL, z)),
    Math.abs(h - src.heightAt(x - CELL, z)),
    Math.abs(h - src.heightAt(x, z + CELL)),
    Math.abs(h - src.heightAt(x, z - CELL)),
  );
}

/** ★ 原始特征（查询时算；不建表）。px,pz = 玩家位置（威胁距/射程带用） */
export function featsAt(src: ScoringSources, x: number, z: number, px: number, pz: number): CellFeats {
  const plan = src.plan;
  const d = Math.hypot(x - plan.cx, z - plan.cz);
  const dt = Math.hypot(x - px, z - pz);
  const dh = dhAt(src, x, z);
  const pass = src.semantics.isPassableAt(x, z) && dh <= WALL_DH;
  const slope = pass && dh > SLOPE_DH;
  const wallNear = pass && dh > WALL_DH * 0.8;
  const water = src.raster.tileDefAt(x, z).genRole === 'liquid';
  const trench = src.holeMask.isDug(x, z);
  return {
    pass,
    h: src.heightAt(x, z),
    shipD: (d / R) * DIST_SCALE,
    nearF: d < 30 ? -(1 - d / 30) * 4 : 0,
    threatN: (dt / R) * DIST_SCALE,
    playerD: dt,
    cover: src.bonus.get(bonusKey(x, z)) ?? 0,
    width: src.semantics.widthAt(x, z),
    choke: src.semantics.classAt(x, z) === Sem.Choke ? 1 : 0,
    trench: trench ? 1 : 0,
    constTerm:
      (wallNear ? WALL_COVER_SCORE : 0) +
      (trench ? TRENCH_SCORE : 0) -
      (water ? WATER_PENALTY : 0) -
      (slope ? SLOPE_PENALTY : 0),
  };
}

/** ★ 评分（mixed 口径，与旧 TerrainScore.score[] 同公式；权重里的 dist 已含时间增益）
 *  不可站 → -1e9；未注入数据源 → null */
export function scoreAt(src: ScoringSources | null, x: number, z: number): number | null {
  if (!src) return null;
  const f = featsAt(src, x, z, src.playerX, src.playerZ);
  if (!f.pass) return -1e9;
  const w = src.weights;
  return w.h * f.h + w.dist * f.shipD + w.cover * f.cover + w.near * f.nearF
    + w.threat * f.threatN + (w.width * f.width + w.choke * f.choke) * FEAT_SCALE + f.constTerm;
}
