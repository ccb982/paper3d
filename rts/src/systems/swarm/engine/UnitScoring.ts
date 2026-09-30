// ============================================================
// engine/UnitScoring —— 兵种合成「共享数学」+ 路由（D3；《地形语义表设计.md》§6）
// ============================================================
// ★ 架构：**地形表只给事实（真相源）**；「事实 + 事态 → 该兵种偏好」的**系数表**
//   下移进**兵种管理器**（Melee/Ranged/Flyer/Engineer 各自的 TACTICS）。
//   本文件只做三件事（无任何兵种决策）：
//     ① 事实 → CellFeats 的**中性映射**（kind/narrow/slopeDir/occluded → 数值字段）
//     ② 事态 p × 该兵种系数表 → 权重（curveAt × mul；曲线/系数都在管理器）
//     ③ 路由：scoreFor(type, ctx, x, z) → 对应管理器策略
// ★ 已废：TerrainScoring（旧"共享评分单一实现"）。WALL_DH/SLOPE_DH 单源 = TerrainSemantics。
// ============================================================

import type { BattlePosture } from '../Posture';
import { KIND, SLOPE_DIR, WALL_DH, type TerrainSemantics } from '../TerrainSemantics';

/** 距离项归一化（d/R × 此系数；与高度/掩体量级可比） */
export const DIST_SCALE = 12;
/** 缝道/事实项的量级系数 */
export const FEAT_SCALE = 4;
/** 评分半径（米） */
export const R = 144;

/** ★ 只读战术上下文（data 层每拍构建；管理器策略/共享数学消费） */
export interface TacticalCtx {
  /** 事实表（C1/C2/C3） */
  facts: TerrainSemantics;
  /** 高度真源（RasterMap 采样口） */
  heightAt: (x: number, z: number) => number;
  /** 掩体/工事加成（buildBonus 产物；键 = `${round(x/4)},${round(z/4)}`） */
  bonus: ReadonlyMap<string, number>;
  /** 水（可走，仅代价；可选） */
  waterAt?: (x: number, z: number) => boolean;
  /** 战壕（挖掘；可选） */
  isDugAt?: (x: number, z: number) => boolean;
  /** 舰（C3 参照） */
  ship: { x: number; z: number };
  /** 玩家（威胁方向） */
  player: { x: number; z: number };
  /** 事态强度 p（0~1；唯一来源 = 事态函数） */
  p: number;
  /** 联合态势（仅 withdraw 用） */
  posture: BattlePosture;
  /** 距离系数时间增益（用户定 2026-09-25；日报末放大） */
  distGain: number;
}

/** 事实快照（中性；无兵种权重） */
export interface CellFeats {
  pass: boolean;
  h: number;
  shipD: number;      // 归一舰距 (d/R)·DIST_SCALE
  nearF: number;      // 近舰负分项（≤0；× w.near）
  threatN: number;    // 归一玩家距 (dt/R)·DIST_SCALE
  playerD: number;    // 玩家距（米；射程带用）
  cover: number;      // 掩体加成原值
  gap: number;        // 缝道宽度 0~1（narrowW/4；0=非缝道）
  choke: number;      // 窄口 0/1（narrowW=1）
  trench: number;     // 战壕 0/1
  hidden: number;     // 对舰遮挡 0/1
  high: number;       // 高地面（山顶/高原）0/1
  front: number;      // 迎舰坡 0/1
  constTerm: number;  // 贴墙/战壕/水/坡常量项
}

/** 权重字段名 */
export type WeightField = 'h' | 'dist' | 'threat' | 'cover' | 'gap' | 'narrow' | 'hidden' | 'high' | 'front' | 'near';
export type ScoreWeights = Record<WeightField, number>;
/** 事态曲线：p 锚点（前缀和 = 与旧 PHASE 口径同锚） */
export type Curve = ReadonlyArray<readonly [number, number]>;

/** 曲线 p 锚点（事件插值） */
export const CURVE_P: readonly number[] = [0.05, 0.25, 0.45, 0.65, 0.9];

/** 该兵种的战术系数（**决策表**，写在各兵种管理器里） */
export interface UnitTactics {
  /** 每字段系数（乘在曲线上；不同兵种不同） */
  mul: ScoreWeights;
  /** 本兵种自己的事态曲线（缺省 = 中性曲线；想独立调就写自己的） */
  curves?: Partial<Record<WeightField, Curve>>;
  /** 撤退档基值（× mul；缺省 = 用曲线） */
  withdraw?: ScoreWeights;
  /** 远程射程带（米）：站位距玩家落 [25,55] 外按米线性罚（×BAND_W×band） */
  band?: number;
  /** 后勤"远离接敌"：距玩家越远越有利（×AWAY_W×away） */
  away?: number;
  /** 近战谓词：可站高地面（山顶/高原）**硬排除**（不走高地） */
  avoidHigh?: boolean;
}

/** 中性曲线（事态函数的中立形状；兵种可整体覆盖某字段） */
export const NEUTRAL_CURVES: Record<WeightField, Curve> = {
  h:      [[0.05, 0.6], [0.25, 0.6], [0.45, 0.5], [0.65, 0.4], [0.9, 0.3]],
  dist:   [[0.05, 0.06], [0.25, 0.08], [0.45, 0.02], [0.65, -0.06], [0.9, -0.35]],
  threat: [[0.05, 0], [0.25, 0], [0.45, -0.05], [0.65, -0.1], [0.9, -0.15]],
  cover:  [[0.05, 0.8], [0.25, 0.8], [0.45, 1.0], [0.65, 1.0], [0.9, 0.6]],
  gap:    [[0.05, 0.05], [0.25, 0.1], [0.45, 0.25], [0.65, 0.35], [0.9, 0.4]],
  narrow: [[0.05, 0.2], [0.25, 0.3], [0.45, 0.2], [0.65, 0.1], [0.9, 0.05]],
  hidden: [[0.05, 0], [0.9, 0]],
  high:   [[0.05, 0], [0.9, 0]],
  front:  [[0.05, 0], [0.9, 0]],
  near:   [[0.05, 1.6], [0.25, 1.2], [0.45, 0], [0.65, 0], [0.9, 0]],
};

/** 中性（mixed）：无兵种偏好 */
export const MIXED_TACTICS: UnitTactics = {
  mul: { h: 1, dist: 1, threat: 1, cover: 1, gap: 1, narrow: 1, hidden: 1, high: 1, front: 1, near: 1 },
};

// ---- 策略注入（避免循环：管理器只 import type，接线在本文件底部） ----
import { MELEE_DEFENSE_TACTICS, MELEE_ASSAULT_TACTICS } from './MeleeManager';
import { RANGED_TACTICS } from './RangedManager';
import { FLYER_TACTICS } from './FlyerManager';
import { ENGINEER_TACTICS } from './EngineerManager';
import type { SquadType } from '../../../entity/SwarmUnit';

const BY_TYPE: Record<SquadType, UnitTactics> = {
  defense: MELEE_DEFENSE_TACTICS,
  assault: MELEE_ASSAULT_TACTICS,
  ranged: RANGED_TACTICS,
  logistics: ENGINEER_TACTICS,
  flyer: FLYER_TACTICS,
  mixed: MIXED_TACTICS,
};

/** 曲线取值（分段线性） */
export function curveAt(p: number, c: Curve): number {
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  let a = c[0];
  for (const b of c) {
    if (t <= b[0]) {
      const span = b[0] - a[0];
      const k = span > 0 ? (t - a[0]) / span : 0;
      return a[1] + (b[1] - a[1]) * k;
    }
    a = b;
  }
  return c[c.length - 1][1];
}

/** 事态 p（+该兵种系数表）→ 权重 */
export function weightsOf(t: UnitTactics, p: number, posture: BattlePosture): ScoreWeights {
  const out = {} as ScoreWeights;
  const fields: WeightField[] = ['h', 'dist', 'threat', 'cover', 'gap', 'narrow', 'hidden', 'high', 'front', 'near'];
  for (const f of fields) {
    const base = posture === 'withdraw' && t.withdraw ? t.withdraw[f] : curveAt(p, t.curves?.[f] ?? NEUTRAL_CURVES[f]);
    out[f] = base * t.mul[f];
  }
  return out;
}

/** 掩体加成键（同网格 4m） */
export function bonusKey(x: number, z: number): string {
  return `${Math.round(x / 4)},${Math.round(z / 4)}`;
}

/** 4m 邻格高差（heightAt 直读真源） */
function dhAt(ctx: TacticalCtx, x: number, z: number): number {
  const h = ctx.heightAt(x, z);
  return Math.max(
    Math.abs(h - ctx.heightAt(x + 4, z)),
    Math.abs(h - ctx.heightAt(x - 4, z)),
    Math.abs(h - ctx.heightAt(x, z + 4)),
    Math.abs(h - ctx.heightAt(x, z - 4)),
  );
}

/** ★ 事实 → 中性特征快照（查询时算；不建表）。px,pz 覆盖 ctx.player（威胁距/射程带用） */
export function featsAt(ctx: TacticalCtx, x: number, z: number, px?: number, pz?: number): CellFeats | null {
  const c = ctx.facts.cellAt(x, z);
  if (!c) return null;
  const tx = px ?? ctx.player.x, tz = pz ?? ctx.player.z;
  const d = Math.hypot(x - ctx.ship.x, z - ctx.ship.z);
  const dt = Math.hypot(x - tx, z - tz);
  const dh = dhAt(ctx, x, z);
  const pass = ctx.facts.isPassableAt(x, z) && dh <= WALL_DH;
  const slope = pass && dh > 1.5;
  const wallNear = pass && dh > WALL_DH * 0.8;
  const water = ctx.waterAt ? ctx.waterAt(x, z) : false;
  const trench = ctx.isDugAt ? ctx.isDugAt(x, z) : false;
  const high = c.kind === KIND.Peak || c.kind === KIND.Plateau ? 1 : 0;
  return {
    pass,
    h: ctx.heightAt(x, z),
    shipD: (d / R) * DIST_SCALE,
    nearF: d < 30 ? -(1 - d / 30) * 4 : 0,
    threatN: (dt / R) * DIST_SCALE,
    playerD: dt,
    cover: ctx.bonus.get(bonusKey(x, z)) ?? 0,
    gap: Math.min(1, c.narrowW / 4),
    choke: c.narrowW === 1 ? 1 : 0,
    trench: trench ? 1 : 0,
    hidden: c.occluded ? 1 : 0,
    high,
    front: c.slopeDir === SLOPE_DIR.Front ? 1 : 0,
    constTerm:
      (wallNear ? 0.8 : 0) +
      (trench ? 1.2 : 0) -
      (water ? 0.6 : 0) -
      (slope ? 0.6 : 0),
  };
}

// 距离混合调参（用户定 2026-09-25；近舰距离权重放大/地形权重衰减）
const NEAR_DIST_BOOST = 8;
const NEAR_TERRAIN_DAMP = 0.35;
// 远程射程带（米）与后勤远离项
const BAND_LO = 25, BAND_HI = 55, BAND_W = 0.06;
const AWAY_CAP = 80, AWAY_W = 0.06;

/** ★ 合成（共享数学；系数全来自管理器策略）：无特征/不可站 → -1e9 */
export function composeScore(t: UnitTactics, f: CellFeats | null, ctx: TacticalCtx): number {
  if (!f || !f.pass) return -1e9;
  if (t.avoidHigh && f.high > 0) return -1e9;   // 近战谓词：不走高地（山顶/高原排除）
  const w = weightsOf(t, ctx.p, ctx.posture);
  const k = Math.max(0, Math.min(1, 1 - f.shipD / DIST_SCALE));
  const distBoost = 1 + (NEAR_DIST_BOOST - 1) * k;          // 近舰距离项放大
  const terrainDamp = 1 - (1 - NEAR_TERRAIN_DAMP) * k;      // 近舰地形项衰减
  let s =
    w.h * f.h * terrainDamp +
    w.dist * f.shipD * distBoost * ctx.distGain +
    w.threat * f.threatN * terrainDamp +
    w.cover * f.cover * terrainDamp +
    (w.gap * f.gap + w.narrow * f.choke) * FEAT_SCALE * terrainDamp +
    (w.hidden * f.hidden + w.high * f.high + w.front * f.front) * FEAT_SCALE * terrainDamp +
    w.near * f.nearF * terrainDamp;
  if (t.band && t.band > 0) {
    const over = f.playerD < BAND_LO ? BAND_LO - f.playerD : f.playerD > BAND_HI ? f.playerD - BAND_HI : 0;
    s -= over * BAND_W * t.band;
  }
  if (t.away && t.away > 0) s += t.away * Math.min(f.playerD, AWAY_CAP) * AWAY_W;
  return s + f.constTerm;
}

/** ★ 兵种分（路由）：该格对该兵种的有利度 */
export function scoreFor(type: SquadType, ctx: TacticalCtx, x: number, z: number, px?: number, pz?: number): number {
  const t = BY_TYPE[type] ?? MIXED_TACTICS;
  return composeScore(t, featsAt(ctx, x, z, px, pz), ctx);
}

/** ★ 中立表分（执行层候选方向打分用；无上下文 → null） */
export function scoreTileAt(ctx: TacticalCtx | null, x: number, z: number): number | null {
  if (!ctx) return null;
  return composeScore(MIXED_TACTICS, featsAt(ctx, x, z), ctx);
}
