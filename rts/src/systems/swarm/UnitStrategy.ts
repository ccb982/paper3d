// ============================================================
// UnitStrategy —— L3 兵种战术策略函数（重构 P1；《敌人管线设计.md》§1.4/§1.6、总纲 §2）
// ============================================================
// 一句话：scoreFor(兵种, 格) = 事态基权 weightsFor(p,posture) × 兵种修正 MUL × 合成字段
//   （TerrainScore.featsAt 的 h/舰距/玩家距/掩体/宽度/隘口/近舰 + 常量项）——
//   合成层只产字段，兵种偏好在此加权（读时算，O(1)，不建表不缓存）。
// 消费方（总纲 P1-2/3/4 逐点切）：SteerPick 候选打分 / SquadPath 路径代价 / Decide 选格。
// ============================================================

import { FEAT_SCALE, DIST_SCALE, type CellFeats, type ScoreWeights } from './TerrainScore';
import type { SquadType } from '../../entity/SwarmUnit';

/** ★ 距离混合调参（用户定 2026-09-25）：近舰距离权重放大 / 地形权重衰减（远舰反之） */
const NEAR_DIST_BOOST = 8;
const NEAR_TERRAIN_DAMP = 0.35;

/** 兵种特征权重乘子（缺省 1；《设计》§1.4 矩阵：
 *  盾=隘口/掩体/宽度大优先 · 突=压向玩家(threat×)·接受低掩体 · 远程=高地+掩体+射程带 ·
 *  后勤=远离接敌(away)+相对弱外推(dist/near 调低 → 靠舰侧；行为 rear 由 rear 使命兜) */
const MUL: Record<SquadType, {
  h: number; dist: number; threat: number; cover: number; width: number; choke: number; near: number; band: number; away: number;
}> = {
  defense:   { h: 1.0, dist: 1.1, threat: 1.0, cover: 1.4, width: 1.6, choke: 2.5, near: 1.2, band: 0, away: 0 },
  assault:   { h: 0.8, dist: 1.3, threat: 1.6, cover: 0.7, width: 1.2, choke: 0.6, near: 0.8, band: 0, away: 0 },
  ranged:    { h: 2.2, dist: 1.0, threat: 1.0, cover: 1.2, width: 0.8, choke: 0.8, near: 1.0, band: 1, away: 0 },
  logistics: { h: 0.5, dist: 0.6, threat: 1.0, cover: 0.9, width: 0.6, choke: 0.7, near: 0.5, band: 0, away: 1 },
  flyer:     { h: 1.0, dist: 1.0, threat: 1.0, cover: 1.0, width: 1.0, choke: 1.0, near: 1.0, band: 0, away: 0 },
  mixed:     { h: 1.0, dist: 1.0, threat: 1.0, cover: 1.0, width: 1.0, choke: 1.0, near: 1.0, band: 0, away: 0 },
};

/** 远程射程带（米）：站位距玩家落 [BAND_LO, BAND_HI] 外按米线性罚（× BAND_W × m.band） */
const BAND_LO = 25;
const BAND_HI = 55;
const BAND_W = 0.06;
/** 后勤"远离接敌"（米）：距玩家越远越有利，封顶 80m（× AWAY_W × m.away）——
 *  类型常驻偏好（事态 threat 权重不激活时也生效），照《设计》§1.4"后勤=远离接敌" */
const AWAY_CAP = 80;
const AWAY_W = 0.06;

/** ★ L3 兵种战术策略函数：该格对该兵种的有利度（无特征/不可站 → -1e9） */
export function scoreForUnit(type: SquadType, f: CellFeats | null, base: ScoreWeights): number {
  if (!f || !f.pass) return -1e9;
  const m = MUL[type] ?? MUL.mixed;
  // ★ 评分动态化（用户定 2026-09-25）：**地形分与距离分不固定相加**——
  //   近舰（k→1）距离权重 > 地形权重（守家）；远舰（k→0）地形权重 > 距离权重（野战）。
  const k = Math.max(0, Math.min(1, 1 - f.shipD / DIST_SCALE));
  const distBoost = 1 + (NEAR_DIST_BOOST - 1) * k;          // 距离项：近舰放大
  const terrainDamp = 1 - (1 - NEAR_TERRAIN_DAMP) * k;      // 地形项：近舰衰减
  let s =
    base.h * m.h * f.h * terrainDamp +
    base.dist * m.dist * f.shipD * distBoost +
    base.threat * m.threat * f.threatN * terrainDamp +
    base.cover * m.cover * f.cover * terrainDamp +
    (base.width * m.width * f.width + base.choke * m.choke * f.choke) * FEAT_SCALE * terrainDamp +
    base.near * m.near * f.nearF * terrainDamp;
  if (m.band > 0) {
    const over = f.playerD < BAND_LO ? BAND_LO - f.playerD : f.playerD > BAND_HI ? f.playerD - BAND_HI : 0;
    s -= over * BAND_W * m.band;
  }
  if (m.away > 0) s += m.away * Math.min(f.playerD, AWAY_CAP) * AWAY_W;
  return s + f.constTerm;
}
