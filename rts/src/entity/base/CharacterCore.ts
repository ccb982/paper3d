// ============================================================
// entity/base/CharacterCore —— 两载体同内核：位置推进 / 爬坡 / 立面阻挡 / 贴地（重写 P1）
// ============================================================
// L2 代理与 L3 实体共用一套推进语义（用户定：地形/爬坡是每个实体都有的基础方法）：
//   ① 期望位移（dir × speed × dt）
//   ② 上坡（单一模型，2026-09-26 重构）：坡面方位 = 表标注 `uphillNormal`（法线 n + 边中点 m）。
//      规则只有两条：
//        · 想上坡（climbOrdered ‖ 方向朝坡）→ 未到坡面先走**边中点**（正对方位）；到坡面沿法线定速爬；
//        · 不想上坡但人在坡面上（局部坡度 ≥ CLIMB_SLOPE_MIN）→ 下坡小推（坡面不许驻留）。
//   ③ 立面阻挡：逐分量清零（陡升 > 台阶豁免 且不延续 = 墙；水中放宽到 SHORE_CLIMB_MAX）
//      ★ 严格爬坡（用户定 2026-09-26，所有实体基类共用）：**坡很宽、处处可爬**——
//        只要本格的坡面边朝路上（表标注），就地沿法线爬升（不绕边中点/不蹭侧壁）；
//        被墙挡住且朝路上有坡面边 → 同一条：就地正对爬。
//   ④ 贴地：位移后落差 > 台阶 → 回退（0.6 小台阶交给上层限速踏过）
//   ★ 待实装（2026-09-25 用户定）：**高精度层语义（H2）+ 跨层位移校验 canShift**——
//     所有位移（自身/推挤/贴地）统一过它；TerrainProbe.layerAt 为单源；L2/L3 同款。见《寻路重写方案.md》§4.4.5。
// 地形访问全部经 TerrainProbe 注入（实体层不依赖 systems；代理侧同一份）。
// 时间一律用**实秒**（now 从参数传入，不内部取钟）。
// ============================================================

import { CLIMB_SLOPE_MIN, CLIMB_SPEED_MUL, CLIMB_FACE_R, SHORE_CLIMB_MAX } from '../TerrainAssist';
import { EDGE_CLIFF_BAND } from '../../services/map/Refinements';
import { RasterMap } from '../../services/map/RasterMap';

export const CLIMB_TIMEOUT_S = 1.5;

/** ★ 脱埋深度（米；用户定 2026-09-26）：脚底比**顶层地表**低 ≥ 此值 = 被楔在坡体/结构内部 */
export const UNBURY_DEPTH = 1.2;

/** ★ 脱埋贴地（两载体同口径）：y 感知选层；若停在"顶层地表之下 ≥UNBURY_DEPTH"的空腔
 *  （坡背空腔/结构体内部——y 提示选层会停在底层）→ 抬到顶层，走出体内。
 *  注：当前战场无"可站顶板（隧道）"空间；若未来出现，按层语义另开口径。 */
export function unbuyGroundY(x: number, z: number, y: number): number {
  const r = RasterMap.current;
  if (!r) return y;
  const gy = r.surfaceHeightAtFor(x, z, y);
  const top = r.surfaceHeightAt(x, z);
  return Number.isFinite(top) && top - gy > UNBURY_DEPTH ? top : gy;
}

/** 上坡意图阈值（方向·法线 dot；> 此值 = 想上坡） */
const CLIMB_INTENT_DOT = 0.1;

/** ★ 跨层位移校验（H2 单源，用户定 2026-09-25）：从 (fx,fz,fy) 移到 (tx,tz) 是否允许——
 *  目的地按**当前层**取地表高；上升 > stepLimit → 不允许（自身步进/推挤/贴地共用）。 */
export function canShift(
  probe: TerrainProbe, fx: number, fz: number, fy: number, tx: number, tz: number, stepLimit: number,
): boolean {
  const h0 = probe.layerAt(fx, fz, fy);
  const h1 = probe.layerAt(tx, tz, fy);
  if (!Number.isFinite(h0) || !Number.isFinite(h1)) return true;
  return h1 - h0 <= stepLimit;
}

/** 地形探针（实体层注入；实现方：L3 走 RasterMap、L2 走表桥） */
export interface TerrainProbe {
  /** 地表高（带自身高度选层） */
  heightAt(x: number, z: number, y: number): number;
  /** 是否水中（genRole === 'liquid'；水=正常地块，仅爬岸放宽用） */
  wetAt(x: number, z: number): boolean;
  /** 坡面梯度（米/米）；无 → null */
  slopeGradAt(x: number, z: number): { gx: number; gz: number; mag: number } | null;
  /** "脚下块→该方向"的边是否坡面（weld） */
  isWeldEdge(x: number, z: number, dirX: number, dirZ: number): boolean;
  /** ★ 上坡半径内最近坡面的**正对方向**（单位向量；无坡 → null）——上坡必须正对坡面（用户定 2026-09-25） */
  uphillNormal?(x: number, z: number, r: number, dirX?: number, dirZ?: number):
    { ux: number; uz: number; mx?: number; mz?: number; rise?: number } | null;
  /** ★ 高精度层（H2 单源，用户定 2026-09-25）：该点在当前脚底高度附近的**地表层高**（y 感知选层） */
  layerAt(x: number, z: number, y: number): number;
}

export interface StepInput {
  /** 当前位置 / 脚底高 */
  x: number;
  y: number;
  z: number;
  dt: number;
  /** 期望方向（单位向量；零 = 站桩） */
  dirX: number;
  dirZ: number;
  speed: number;
  /** 寻路标注：此处必须爬坡 */
  climbOrdered: boolean;
  /** 限制爬崖（敌人）：立面阻挡 + 程序化爬坡 */
  blockCliffClimb: boolean;
  /** 无视地形落差（载具/飞行） */
  climbAnyTerrain: boolean;
  /** 碰撞盒半宽 / 半深（立面阻挡采样偏移） */
  hx: number;
  hz: number;
  /** 攀爬插值/空中接管时挂起（本拍不动） */
  suspended: boolean;
}

export interface StepResult {
  dx: number;
  dz: number;
  /** 贴地高度（调用方写 y） */
  gy: number;
  /** 本拍处于爬坡态（定速直推） */
  climbing: boolean;
  /** 被立面阻挡（调试） */
  blocked: boolean;
  /** 大落差回退（贴地失败） */
  reverted: boolean;
}

export class CharacterCore {
  /** 结果复用（零分配） */
  private readonly out: StepResult = { dx: 0, dz: 0, gy: 0, climbing: false, blocked: false, reverted: false };

  /** 是否处于爬坡态（表现层/减速用） */
  get climbing(): boolean {
    return this.out.climbing;
  }

  /** 推进一帧：返回实际位移与贴地高（调用方写位置；分离/推挤在调用方之后做） */
  step(inp: StepInput, probe: TerrainProbe, nowS: number): StepResult {
    const out = this.out;
    out.blocked = false;
    out.reverted = false;
    out.climbing = false;
    let dx = 0;
    let dz = 0;
    if (inp.suspended) {
      out.dx = 0;
      out.dz = 0;
      out.gy = probe.heightAt(inp.x, inp.z, inp.y);
      return out;
    }
    dx = inp.dirX * inp.speed * inp.dt;
    dz = inp.dirZ * inp.speed * inp.dt;

    // ---- 上坡（就地模型，2026-09-26；两载体同内核） ----
    //   坡面 = 本格自己的表标注坡面边（`uphillNormal`；**坡很宽，处处可爬，不绕边中点**）：
    //     ① 想上坡（显式爬坡令 ‖ 方向朝坡）→ 就地沿法线定速爬升（爬坡态跳过墙检，坡度由表保证）；
    //     ② 不想上坡但人在坡面上 → 下坡小推（坡面不许驻留）。
    if (inp.blockCliffClimb && !inp.climbAnyTerrain) {
      const dl0 = Math.hypot(inp.dirX, inp.dirZ) || 1;
      const face = probe.uphillNormal ? probe.uphillNormal(inp.x, inp.z, CLIMB_FACE_R, inp.dirX, inp.dirZ) : null;
      if (face) {
        const dot = (inp.dirX * face.ux + inp.dirZ * face.uz) / dl0;
        const wantsUp = inp.climbOrdered || dot > CLIMB_INTENT_DOT;
        if (wantsUp) {
          out.climbing = true;
          dx = face.ux * inp.speed * CLIMB_SPEED_MUL * inp.dt;
          dz = face.uz * inp.speed * CLIMB_SPEED_MUL * inp.dt;
        } else {
          const sg = probe.slopeGradAt ? probe.slopeGradAt(inp.x, inp.z) : null;
          if (sg && sg.mag >= CLIMB_SLOPE_MIN) {
            dx = -face.ux * inp.speed * inp.dt * 0.6;
            dz = -face.uz * inp.speed * inp.dt * 0.6;
          }
        }
      }
    }

    // ---- 立面阻挡（逐分量清零；坡面/水中豁免） ----
    const wetHere = probe.wetAt(inp.x, inp.z);
    const stepLimit = wetHere ? SHORE_CLIMB_MAX : EDGE_CLIFF_BAND;
    if (!out.climbing && !inp.climbAnyTerrain && inp.blockCliffClimb) {
      const yHere = probe.heightAt(inp.x, inp.z, inp.y);
      const m = 0.1;
      /** 该采样点是否"墙"（B3，用户定 2026-09-25）：陡升 > 台阶豁免 **且该向不是坡(weld)**。
       *  坡 = 可爬通道（程序化爬坡）；硬边大落差 = 墙（只下不上）。不再用"连续上升即非墙"猜。 */
      const isWall = (sx: number, sz: number, ux: number, uz: number): boolean => {
        const h1 = probe.heightAt(sx, sz, inp.y);
        if (h1 - yHere <= stepLimit) return false;
        return !probe.isWeldEdge(inp.x, inp.z, ux, uz);
      };
      if (dx > 0 && isWall(inp.x + inp.hx + m, inp.z, 1, 0)) { dx = 0; out.blocked = true; }
      else if (dx < 0 && isWall(inp.x - inp.hx - m, inp.z, -1, 0)) { dx = 0; out.blocked = true; }
      if (dz > 0 && isWall(inp.x, inp.z + inp.hz + m, 0, 1)) { dz = 0; out.blocked = true; }
      else if (dz < 0 && isWall(inp.x, inp.z - inp.hz - m, 0, -1)) { dz = 0; out.blocked = true; }
    }

    // ---- 严格爬坡（基类共用，用户定 2026-09-26）：被墙挡住且朝路上有本格坡面边 → 就地爬 ----
    //   （坡很宽、处处可爬；**不许**绕边中点，也不许贴着坡脚/侧壁蹭。）
    if (out.blocked && !out.climbing && inp.blockCliffClimb && !inp.climbAnyTerrain) {
      const f2 = probe.uphillNormal ? probe.uphillNormal(inp.x, inp.z, CLIMB_FACE_R, inp.dirX, inp.dirZ) : null;
      if (f2) {
        out.climbing = true;
        dx = f2.ux * inp.speed * CLIMB_SPEED_MUL * inp.dt;
        dz = f2.uz * inp.speed * CLIMB_SPEED_MUL * inp.dt;
      }
    }

    // ---- 贴地：大落差回退（0.6 以下小台阶由上层限速踏过） ----
    const gy = probe.heightAt(inp.x + dx, inp.z + dz, inp.y);
    if (!out.climbing && !inp.climbAnyTerrain && gy - inp.y > stepLimit) {
      dx = 0;
      dz = 0;
      out.reverted = true;
    }
    out.dx = dx;
    out.dz = dz;
    out.gy = gy;
    return out;
  }
}
