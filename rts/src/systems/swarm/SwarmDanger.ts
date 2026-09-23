// ============================================================
// SwarmDanger —— 危险地形口径单源表（P5 收口；《敌人管线设计.md》§5）
// ============================================================
// 治"危险口径五套并存"：各层阈值集中在此，模块一律引用本表（不再各写各的）。
//   层级分工（同表不同层，语义各自标注）：
//   · 执行层台阶（角色可上）≡ services/map/Refinements.EDGE_CLIFF_BAND
//   · 表硬边界（不可站/不可穿越）WALL_DH / 坡面 SLOPE_DH —— 真源在 TerrainScore（此处转发）
//   · A* 陡升挡 WALL_STEP（与执行层同口径，防"寻路放行/执行禁行"脱节）
//   · 代理/实体危险探测 PROBE_RISE@PROBE_R（连续陡坡 ≈40°+ 视为墙）；坑底 PIT_H
//   · 流场爬升加价 FLOW_CLIFF_DH（软代价，不阻挡）
// ============================================================

import { EDGE_CLIFF_BAND } from '../../services/map/Refinements';
import { WALL_DH, SLOPE_DH } from './TerrainScore';

export const DANGER = {
  /** 执行层可上台阶上限（米；Refinements.EDGE_CLIFF_BAND 直连） */
  CLIMB_BAND: EDGE_CLIFF_BAND,
  /** 表硬边界：4 邻域陡差 > 此值 → 不可站/不可穿越（真源 TerrainScore） */
  WALL_DH,
  /** 表坡面阈值（真源 TerrainScore） */
  SLOPE_DH,
  /** A* 陡升挡（≡ 执行层；只挡升不挡降）——历史口径：单步瞬时坎 */
  WALL_STEP: EDGE_CLIFF_BAND,
  /** ★ 绝对墙阈值（悬崖；N0《寻路与导航架构.md》§3.2）：落差 > 此值 → 双向禁（沿用表口径 WALL_DH=3.0） */
  CLIFF_DH: WALL_DH,
  /** ★ 4m 格步升上限（≈32°；= PROBE_RISE × CELL / PROBE_R）。
   *  寻路必须用这个而不是 WALL_STEP(0.6@瞬时)——40m 尺度上把连续山坡当墙会让 A* 找不到"坡"，
   *  只能直线硬爬 → "爬高地墨迹"（2026-09-23 用户实感修复）。 */
  CELL_RISE_MAX: 2.5,
  /** 危险探测陡升（米；@PROBE_R 采样，≈40°+ 视为墙） */
  PROBE_RISE: 1.0,
  /** 危险探测采样距离（米） */
  PROBE_R: 1.6,
  /** 流场爬升加价阈值（米；软代价） */
  FLOW_CLIFF_DH: 0.5,
  /** 坑底判定（米；role=pit 且 h < 此值 → 危险/死亡） */
  PIT_H: -1.2,
} as const;
