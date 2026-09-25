// ============================================================
// TerrainAssist —— 爬山：L2 代理与 L3 实体**共用的基础地形辅助**
// ============================================================
// 用户定 2026-09-24：爬山优化是"每个实体、代理都有的基础方法"。
//   · fallLineBlend：**明显爬坡**（mag>0.22 且上坡分量>0.45）才向坡正面（fall line）混合；
//     横切缓坡不拉直（防路径与执行互相打架 → 墨迹）。
// ★ 水=正常地块（用户定 2026-09-24）：入水惩罚/涉水加价/上岸权重/涉水限速/出水逃逸全部去掉。
//   仅保留 `SHORE_CLIMB_MAX`：**当前在水中**时台阶上限放宽（否则会被岸坎挡住出不来）。
// 依赖：entity/SteerPick 的 SteerTable（模式层桥；实体不依赖 systems）。

import type { SteerTable } from './SteerPick';
import { RasterMap } from '../services/map/RasterMap';
import { finalRuling, EDGE_CLIFF_BAND } from '../services/map/Refinements';
import { BLOCK_SIZE, BLOCKS_PER_SIDE } from '../services/map/ChunkGenerator';

/** ★ 上岸爬岸上限（米）：从水里爬上陆地允许的最大抬升（> EDGE_CLIFF_BAND 的岸坎也能爬出；
 *  仅"当前在水里"时生效——陆地单位仍受 0.6m 台阶限制） */
export const SHORE_CLIMB_MAX = 2.5;

/** ★ 坡面程序化爬升（用户定 2026-09-24）：坡面**不许驻留**（要么上要么下）——
 *  坡度 ≥ 此值判"在坡面上"（米/米）；限制爬崖单位在坡面上期望朝上时进入爬坡态（定速直推）。 */
export const CLIMB_SLOPE_MIN = 0.5;
/** ★ 上坡半径（米；用户定 2026-09-25）：在坡的此半径内**想上坡必须正对坡面**（坡法线方向） */
export const CLIMB_FACE_R = 5;
/** ★ 正对阈值（dot）：方向与坡面法线对齐度 ≥ 此值才算"正对"（正对 → 爬；未正对 → 先转向坡面） */
export const CLIMB_FACE_DOT = 0.8;
/** 爬坡态单次续期时长（毫秒；到顶/坡度变缓即退出，超时兜底退出） */
export const CLIMB_PATH_MS = 1500;
/** ★ 爬坡减速（用户定 2026-09-24）：爬坡态速度乘子（L3 程序化爬坡 + L2 上坡共用口径） */
export const CLIMB_SPEED_MUL = 0.55;

/** ★ 危险点判定（L2 代理 / L3 实体同内核；用户定 2026-09-24）：
 *  坑 / 过低 = 危险；**立面**（比脚下高 > 台阶豁免且**非坡面 weld**）= 危险
 *  → 8 向候选会选低处/侧向就近绕（治"顶着坡侧壁站住不会绕"）；水/坡面放行。 */
export function dangerPointAt(
  raster: RasterMap, x: number, z: number, fromX: number, fromZ: number, fromY: number,
): boolean {
  const role = raster.tileDefAt(x, z).genRole;
  if (role === 'liquid') return false;              // 水=正常地块（提前豁免，含深水）
  const h = raster.surfaceHeightAtFor(x, z, fromY);
  if (role === 'pit') return true;
  if (h < -1.2) return true;
  const wet = raster.tileDefAt(fromX, fromZ).genRole === 'liquid';
  const rise = h - raster.surfaceHeightAtFor(fromX, fromZ, fromY);
  if (rise > (wet ? SHORE_CLIMB_MAX : EDGE_CLIFF_BAND)) {
    // ★ 查"脚下块 → 候选方向"这条边（原来查候选点自己的块=查错边 → 硬边误判成坡 → 飞檐走壁）
    const ux = x - fromX, uz = z - fromZ;
    const dIdx = (Math.abs(ux) >= Math.abs(uz) ? (ux > 0 ? 0 : 1) : (uz > 0 ? 2 : 3)) as 0 | 1 | 2 | 3;
    const fbx = Math.floor(fromX / BLOCK_SIZE), fbz = Math.floor(fromZ / BLOCK_SIZE);
    const src = raster.chunkSource(Math.floor(fbx / BLOCKS_PER_SIDE), Math.floor(fbz / BLOCKS_PER_SIDE));
    if (finalRuling(src, fbx, fbz, dIdx) !== 'weld') return true;   // 硬边立面 → 危险（绕）
  }
  return false;
}

/** 坡正面混合：把期望方向 (dx,dz) 按需向最陡上升方向混合（写 out） */
export function fallLineBlend(
  tbl: SteerTable | null, x: number, z: number, dx: number, dz: number, out: { x: number; z: number },
): void {
  out.x = dx; out.z = dz;
  if (!tbl?.slopeGradAt || (dx === 0 && dz === 0)) return;
  const g = tbl.slopeGradAt(x, z);
  // ★ 表外/未就绪 → 梯度 NaN：必须挡住（NaN 会污染期望方向 → pickSteer 期望=0 → 原地转圈）
  if (!Number.isFinite(g.mag) || !Number.isFinite(g.gx) || !Number.isFinite(g.gz) || g.mag <= 0.22) return;
  const up = dx * g.gx + dz * g.gz;
  if (up <= 0.45) return;
  const mx = dx * 0.65 + g.gx * 0.35;
  const mz = dz * 0.65 + g.gz * 0.35;
  const l = Math.hypot(mx, mz);
  if (!Number.isFinite(l) || l < 1e-4) return;
  out.x = mx / l;
  out.z = mz / l;
}


