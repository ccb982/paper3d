// ============================================================
// entity/base/Climb —— 显式爬坡专用件（基类单点；代理/队长/实体共用）
// ============================================================
// 用户定 2026-09-26：**所有爬坡修改收敛到这里**，其余地方不再出现爬坡分支。
// 爬坡 = **两步**（用户定）：
//   【第一步·到位】到坡面**正下方中心**（低侧格心；只沿**切向**横移消除偏置）——
//     · 只做切向位移（不推法线）：绝不进坡体、不撞坡的**侧壁**（治"卡在坡面侧壁"）；
//     · 到位判定 = 切向偏置 |t| ≤ CLIMB_ALIGN_TOL。
//   【第二步·爬升】已到位（或已正对）→ 沿表标注**法线**定速爬（爬坡态跳过墙检，坡度由表保证）。
// 另有：
//   · 坡面不许驻留：不想上坡但人在坡面上（局部坡度 ≥ CLIMB_SLOPE_MIN）→ 下坡小推；
//   · 被墙挡住且**已到位**、朝路上有本格坡面边 → 就地爬（严格；防侧壁蹭）；
//   · **脱埋**：脚底比顶层地表低 ≥ UNBURY_DEPTH 且**不在坡道格**（防坡道上误吸）→ 吸附 y=顶层。
// 依赖：地形经 TerrainProbe 注入（实体层不依赖 systems）；本文件不持状态（纯函数）。
// ============================================================

import { CLIMB_SLOPE_MIN, CLIMB_SPEED_MUL, CLIMB_FACE_R } from '../TerrainAssist';
import { RasterMap } from '../../services/map/RasterMap';
import type { TerrainProbe } from './CharacterCore';

/** 上坡意图阈值（方向·法线 dot；> 此值 = 想上坡） */
const CLIMB_INTENT_DOT = 0.1;
/** 到位容差（米；切向偏置 ≤ 此值 = 已在坡面正下方中心，可爬） */
export const CLIMB_ALIGN_TOL = 1.2;
/** 坡面下方中心的低侧退距（米；= 半格 → 低侧格心） */
const BASE_CENTER_BACK = 2;

/** ★ 脱埋深度（米）：脚底比顶层地表低 ≥ 此值 = 被楔在坡体/结构内部 */
export const UNBURY_DEPTH = 1.2;

export interface ClimbInput {
  x: number; z: number; y: number; dt: number;
  /** 期望方向（单位向量；零 = 站桩） */
  dirX: number; dirZ: number;
  speed: number;
  /** 寻路标注：此处必须爬坡（路段★/本步跨坡边） */
  climbOrdered: boolean;
  /** 限制爬崖（敌人）；false = 无视（载具/飞行） */
  blockCliffClimb: boolean;
  /** 无视地形落差（载具/飞行） */
  climbAnyTerrain: boolean;
}

/** 爬坡位移输出（写回调用方的 dx/dz/climbing） */
export interface ClimbOut {
  dx: number;
  dz: number;
  climbing: boolean;
  /** 本拍处于【第一步·到位】（去坡面正下方中心；此时**不接管**严格爬坡） */
  approaching?: boolean;
}

/** ①② 两步爬坡意图（墙检**之前**调用；可能直接改写 dx/dz 并置 climbing/approaching） */
export function climbIntent(probe: TerrainProbe, inp: ClimbInput, out: ClimbOut): void {
  if (!inp.blockCliffClimb || inp.climbAnyTerrain) return;
  const dl0 = Math.hypot(inp.dirX, inp.dirZ) || 1;
  const face = probe.uphillNormal ? probe.uphillNormal(inp.x, inp.z, CLIMB_FACE_R, inp.dirX, inp.dirZ) : null;
  if (!face) return;
  const dot = (inp.dirX * face.ux + inp.dirZ * face.uz) / dl0;
  const wantsUp = inp.climbOrdered || dot > CLIMB_INTENT_DOT;
  if (!wantsUp) {
    // 坡面不许驻留：人在坡面上 → 下坡小推（不在坡面上则不动）
    const sg = probe.slopeGradAt ? probe.slopeGradAt(inp.x, inp.z) : null;
    if (sg && sg.mag >= CLIMB_SLOPE_MIN) {
      out.dx = -face.ux * inp.speed * inp.dt * 0.6;
      out.dz = -face.uz * inp.speed * inp.dt * 0.6;
    }
    return;
  }
  // 【第一步】到位：坡面正下方中心 = 边中点沿法线退回低侧半格
  const bcx = (face.mx ?? inp.x) - face.ux * BASE_CENTER_BACK;
  const bcz = (face.mz ?? inp.z) - face.uz * BASE_CENTER_BACK;
  // 切向（垂直于法线）偏置：t > 0 表示偏在切线正方向一侧
  const tx = -face.uz, tz = face.ux;
  const t = (inp.x - bcx) * tx + (inp.z - bcz) * tz;
  if (Math.abs(t) > CLIMB_ALIGN_TOL) {
    // 只沿**坡脚切向**横移到中心：不推法线（不进坡体、不撞侧壁）
    const s = t > 0 ? -1 : 1;
    out.dx = s * tx * inp.speed * inp.dt;
    out.dz = s * tz * inp.speed * inp.dt;
    out.approaching = true;
    return;
  }
  // 【第二步】已到位 → 沿法线定速爬升
  out.climbing = true;
  out.dx = face.ux * inp.speed * CLIMB_SPEED_MUL * inp.dt;
  out.dz = face.uz * inp.speed * CLIMB_SPEED_MUL * inp.dt;
}

/** 【第二步·严格】被墙挡住且**已到位**、朝路上有本格坡面边 → 就地爬。
 *  （第一步·到位过程中**不接管**——否则会在侧壁就地爬，正是要治的病。） */
export function climbStrict(probe: TerrainProbe, inp: ClimbInput, out: ClimbOut, blocked: boolean): boolean {
  if (!blocked || out.climbing || out.approaching || !inp.blockCliffClimb || inp.climbAnyTerrain) return false;
  const face = probe.uphillNormal ? probe.uphillNormal(inp.x, inp.z, CLIMB_FACE_R, inp.dirX, inp.dirZ) : null;
  if (!face) return false;
  out.climbing = true;
  out.dx = face.ux * inp.speed * CLIMB_SPEED_MUL * inp.dt;
  out.dz = face.uz * inp.speed * CLIMB_SPEED_MUL * inp.dt;
  return true;
}

/** ④ 脱埋贴地（y 吸附；probe 口径）：正常 = y 感知层高；埋在顶层下 ≥UNBURY_DEPTH
 *  且 **suppressUnbury=false**（非坡道格）→ 吸附顶层。 */
export function groundResolve(
  probe: TerrainProbe, x: number, z: number, y: number, suppressUnbury = false,
): { y: number; unburied: boolean } {
  const gy = probe.heightAt(x, z, y);
  if (suppressUnbury) return { y: gy, unburied: false };
  const top = probe.topAt ? probe.topAt(x, z) : undefined;
  if (top !== undefined && Number.isFinite(top) && top - gy > UNBURY_DEPTH) return { y: top, unburied: true };
  return { y: gy, unburied: false };
}

/** ④ 脱埋贴地（渲染/批量同步口径：直读 RasterMap，规则与 `groundResolve` 相同；坡道格不吸） */
export function groundResolveRaster(x: number, z: number, y: number): { y: number; unburied: boolean } {
  const r = RasterMap.current;
  if (!r) return { y, unburied: false };
  const gy = r.surfaceHeightAtFor(x, z, y);
  const top = r.surfaceHeightAt(x, z);
  if (Number.isFinite(top) && top - gy > UNBURY_DEPTH) return { y: top, unburied: true };
  return { y: gy, unburied: false };
}
