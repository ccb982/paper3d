// ============================================================
// entity/base/CharacterCore —— 两载体同内核：位置推进 / 爬坡 / 立面阻挡 / 贴地（重写 P1）
// ============================================================
// L2 代理与 L3 实体共用一套推进语义（用户定：地形/移动是每个实体都有的基础方法）：
//   ① 期望位移（dir × speed × dt）
//   ② 上坡（用户定 2026-09-26）= **凭证式**：路线经表预处理上坡点插点（nav/ClimbVia）并发放
//      **爬坡凭证**（climb=true → 队长/代理的 climb 令）——**只有"人在上坡点 + 持凭证"才可爬坡**；
//      无凭证或不在点上一律不爬（**没有自主上坡/搜索坡点这个操作**）。
//   ③ 立面阻挡：逐分量清零（陡升 > 台阶豁免 且该向不是坡(weld) = 墙；水中放宽到 SHORE_CLIMB_MAX）
//   ④ 贴地/脱埋：位移后落差 > 台阶 → 回退（weld 坡面除外；0.6 小台阶交给上层限速踏过）；
//      埋在顶层下 ≥UNBURY_DEPTH → 吸附顶层。
// 地形访问全部经 TerrainProbe 注入（实体层不依赖 systems；代理侧同一份）。
// 时间一律用**实秒**（now 从参数传入，不内部取钟）。
// ============================================================

import { CLIMB_SPEED_MUL, SHORE_CLIMB_MAX } from '../TerrainAssist';
import { EDGE_CLIFF_BAND } from '../../services/map/Refinements';
import { RasterMap } from '../../services/map/RasterMap';

/** ★ 脱埋深度（米）：脚底比顶层地表低 ≥ 此值 = 被楔在坡体/结构内部 */
export const UNBURY_DEPTH = 1.2;

/** ★ 上坡点到位容差（米；凭证式上坡：人须在此邻域内才认"在上坡点"） */
const CLIMB_POINT_TOL = 1.2;
/** ★ 高落差硬壁斥力（用户定 2026-09-26）：生效半径（米，外为 0）/ 采样档（米）/ 推力（速度占比） */
const WALL_REPEL_R = 2.0;
const WALL_REPEL_D = [0.6, 1.2, 1.8] as const;
const WALL_PUSH = 0.6;

/** ★ 脱埋贴地（两载体同口径）：y 感知选层；若停在"顶层地表之下 ≥UNBURY_DEPTH"的空腔
 *  → 抬到顶层，走出体内。 */
export function unbuyGroundY(x: number, z: number, y: number): number {
  const r = RasterMap.current;
  if (!r) return y;
  const gy = r.surfaceHeightAtFor(x, z, y);
  const top = r.surfaceHeightAt(x, z);
  return Number.isFinite(top) && top - gy > UNBURY_DEPTH ? top : gy;
}

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
  /** ★ 高精度层（H2 单源，用户定 2026-09-25）：该点在当前脚底高度附近的**地表层高**（y 感知选层） */
  layerAt(x: number, z: number, y: number): number;
  /** ★ 顶层地表（脱埋用；无 → 不做脱埋） */
  topAt?(x: number, z: number): number;
  /** ★ 可行性表查询（可选；生产 = PassTable.canStep）：该向边是否可行（硬墙/坑/单向=不可行） */
  canStep?(x: number, z: number, dx: number, dz: number): boolean;
  /** ★ 上坡点（表预处理；连续性段中心、坡面前 2m）——凭证式上坡的"点位" */
  climbPoint?(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number; rise: number } | null;
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
  /** ★ 爬坡凭证（路线发放：climb=true → 队长/代理的 climb 令）；无凭证不得爬 */
  climbOrdered?: boolean;
  /** ★ 凭证自带的**上坡点**（路线里插的点）；内核据此判"在坡点"（与朝向无关） */
  climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number };
  /** 限制爬崖（敌人）：立面阻挡（坡面 weld 放行） */
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
  /** ★ 本拍发生脱埋吸附（y 已抬到顶层；调用方应直接采用 gy 并跳过回退） */
  unburied: boolean;
}

export class CharacterCore {
  /** 结果复用（零分配） */
  private readonly out: StepResult = { dx: 0, dz: 0, gy: 0, climbing: false, blocked: false, reverted: false, unburied: false };

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
    out.unburied = false;
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

    // ---- 凭证式上坡（用户定）：凭证由**路线**持有（寻路走完才回收）；
    //      人在上坡点 + 持凭证 → 沿法线定速爬。无凭证不爬（无自主）。
    if (inp.blockCliffClimb && !inp.climbAnyTerrain && inp.climbOrdered) {
      const run = inp.climbPt ?? (probe.climbPoint ? probe.climbPoint(inp.x, inp.z, inp.dirX, inp.dirZ) : null);
      if (run) {
        const tx = -run.uz, tz = run.ux;
        const tOff = (inp.x - run.x) * tx + (inp.z - run.z) * tz;       // 切向偏（横向）
        const sOff = (inp.x - run.x) * run.ux + (inp.z - run.z) * run.uz; // 沿法线（<0 = 还没到点）
        if (Math.abs(tOff) <= CLIMB_POINT_TOL && sOff >= -CLIMB_POINT_TOL) {
          out.climbing = true;
          dx = run.ux * inp.speed * CLIMB_SPEED_MUL * inp.dt;
          dz = run.uz * inp.speed * CLIMB_SPEED_MUL * inp.dt;
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

      // ---- 硬墙斥力（用户定 2026-09-26）：**依据可行性表**——四向边若**不可行**
      //   （PassTable.canStep=false：硬墙/坑/单向），按"离该格边的距离"给远离推力（近大远小）。
      //   与前进叠加、不反向抵消；攀爬/坡面（可行边）不受影响。
      if (probe.canStep) {
        const CELL = 4;   // 与 PassTable 同格（4m）
        const cx = Math.floor(inp.x / CELL) * CELL + CELL / 2;
        const cz = Math.floor(inp.z / CELL) * CELL + CELL / 2;
        let rx = 0, rz = 0;
        const wOf = (dist: number): number => {
          const w = (WALL_REPEL_R - dist) / WALL_REPEL_R;
          return w > 0 ? w : 0;
        };
        if (!probe.canStep(inp.x, inp.z, 1, 0)) rx -= wOf(cx + CELL / 2 - inp.x);
        if (!probe.canStep(inp.x, inp.z, -1, 0)) rx += wOf(inp.x - (cx - CELL / 2));
        if (!probe.canStep(inp.x, inp.z, 0, 1)) rz -= wOf(cz + CELL / 2 - inp.z);
        if (!probe.canStep(inp.x, inp.z, 0, -1)) rz += wOf(inp.z - (cz - CELL / 2));
        if (rx !== 0 || rz !== 0) {
          const rl = Math.hypot(rx, rz);
          dx += (rx / rl) * inp.speed * inp.dt * WALL_PUSH;
          dz += (rz / rl) * inp.speed * inp.dt * WALL_PUSH;
        }
      }
    }

    // ---- 贴地/脱埋（上坡由此自然发生：weld 坡面允许沿面上升；无"爬坡态"） ----
    const gx = inp.x + dx, gz = inp.z + dz;
    const gyAware = probe.heightAt(gx, gz, inp.y);
    const top = probe.topAt ? probe.topAt(gx, gz) : undefined;
    const unburied = top !== undefined && Number.isFinite(top) && top - gyAware > UNBURY_DEPTH;
    if (unburied) {
      out.unburied = true;
      out.blocked = false;
      dx = 0;
      dz = 0;   // 本拍只做竖直吸附（防水平穿模）；下一拍正常走
    } else if (!out.climbing && !inp.climbAnyTerrain && gyAware - inp.y > stepLimit) {
      // ★ 坡面（weld）放行：沿坡面自然贴地上行（用户定：没有自主上坡操作，只有走上坡点）
      const ax = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const az = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      const onWeld = (ax !== 0 && probe.isWeldEdge(inp.x, inp.z, ax, 0))
        || (az !== 0 && probe.isWeldEdge(inp.x, inp.z, 0, az));
      if (!onWeld) { dx = 0; dz = 0; out.reverted = true; }
    }
    out.dx = dx;
    out.dz = dz;
    out.gy = unburied ? (top as number) : gyAware;
    return out;
  }
}
