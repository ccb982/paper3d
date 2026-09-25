// ============================================================
// entity/base/CharacterCore —— 两载体同内核：位置推进 / 爬坡 / 立面阻挡 / 贴地（重写 P1）
// ============================================================
// L2 代理与 L3 实体共用一套推进语义（用户定：地形/爬坡是每个实体都有的基础方法）：
//   ① 期望位移（dir × speed × dt）
//   ② 程序化爬坡：寻路标注 climb 或 坡度 ≥ CLIMB_SLOPE_MIN 且是坡面(weld) 且朝上
//      → 定速沿梯度直推（CLIMB_SPEED_MUL）；坡面不许驻留（站桩给下坡小推力）
//   ③ 立面阻挡：逐分量清零（陡升 > 台阶豁免 且不延续 = 墙；水中放宽到 SHORE_CLIMB_MAX）
//   ④ 贴地：位移后落差 > 台阶 → 回退（0.6 小台阶交给上层限速踏过）
// 地形访问全部经 TerrainProbe 注入（实体层不依赖 systems；代理侧同一份）。
// 时间一律用**实秒**（now 从参数传入，不内部取钟）。
// ============================================================

import { CLIMB_SLOPE_MIN, CLIMB_SPEED_MUL, SHORE_CLIMB_MAX } from '../TerrainAssist';
import { EDGE_CLIFF_BAND } from '../../services/map/Refinements';

/** 爬坡单次续期（实秒；与 TerrainAssist.CLIMB_PATH_MS 同源） */
export const CLIMB_TIMEOUT_S = 1.5;

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
  /** 爬坡态截止（实秒） */
  private climbUntil = 0;
  private climbDirX = 0;
  private climbDirZ = 0;
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

    // ---- 程序化爬坡（寻路标注优先；否则按坡度判坡面） ----
    if (inp.blockCliffClimb && !inp.climbAnyTerrain) {
      if (inp.climbOrdered) {
        if (dx !== 0 || dz !== 0) {
          this.climbUntil = nowS + CLIMB_TIMEOUT_S;
          const l = Math.hypot(dx, dz) || 1;
          this.climbDirX = dx / l;
          this.climbDirZ = dz / l;
        }
        out.climbing = nowS < this.climbUntil;
      } else {
        const g = probe.slopeGradAt(inp.x, inp.z);
        if (g && g.mag >= CLIMB_SLOPE_MIN && probe.isWeldEdge(inp.x, inp.z, g.gx, g.gz)) {
          const ux = g.gx / g.mag;
          const uz = g.gz / g.mag;
          const up = inp.dirX * ux + inp.dirZ * uz;
          if (up > 0.25) {
            this.climbUntil = nowS + CLIMB_TIMEOUT_S;
            this.climbDirX = ux;
            this.climbDirZ = uz;
          } else if (this.climbUntil < nowS) {
            // 坡面不许驻留：站桩/下行给下坡小推力（要么上要么下）
            dx -= ux * inp.speed * inp.dt * 0.6;
            dz -= uz * inp.speed * inp.dt * 0.6;
          }
          out.climbing = nowS < this.climbUntil;
        } else {
          this.climbUntil = 0;
        }
      }
      if (out.climbing) {
        dx = this.climbDirX * inp.speed * CLIMB_SPEED_MUL * inp.dt;
        dz = this.climbDirZ * inp.speed * CLIMB_SPEED_MUL * inp.dt;
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
