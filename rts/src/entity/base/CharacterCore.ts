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
/** ★ 坡前起爬带（米；在坡点法线前方此范围内即可起爬——"聚在坡下就能爬"） */
const BASE_NEAR = 2.5;
/** ★ 爬升自主速下限（用户定 2026-09-26）：承诺期内停步/零限速不得压死爬坡 */
const CLIMB_MIN_SPEED = 2.5;
/** ★ 起爬点半径（用户定 2026-09-26）：**爬坡必须从爬坡点起步**，到点才起 */
const CLIMB_START_R = 0.6;
/** ★ 起爬精确记录（用户定）：最近 48 次会话（起点/点位/实测距/结局） */
export const CLIMB_TRACE: {
  id: number; t: number; phase: string; x: number; z: number; y?: number;
  px: number; pz: number; d: number; tOff: number; sOff: number; frames: number;
  y0: number; top0: number; buryMax: number; footGap: number;   // ★ 脚高记录：起步脚高/起步表面/最深埋深/当前脚面差
}[] = [];
let CLIMB_SEQ = 0;
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
  climbPoint?(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number; rise: number; lx: number; lz: number } | null;
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
  climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number };
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

/** ★ 上坡流程计数（用户定 2026-09-26；探针读数用） */
export const CLIMB_STATS = {
  cred: 0,        // 凭证抵达核心（climbOrdered 帧）
  noRun: 0,       // 有凭证但查不到坡带
  run: 0,         // 查到坡带
  guardFail: 0,   // 硬性防线不过（本格无 climb 位）
  climbSteps: 0,  // 执行上升帧
  units: 0,       // 曾进入爬升态的核数
  sessions: 0,    // 起爬会话（提交）数
  approach: 0,    // 强制走位帧（退出/横移/进点）
  badStarts: 0,   // 起爬点偏离 > 起爬半径（应恒 0）
  startDistMax: 0, // 实测起爬距最大值
  landed: 0,      // 到落点完成会话数
  abandoned: 0,   // 被拉离现场弃约数
  buryFrames: 0,  // 爬升中脚低于表面 >0.3m 的帧数（“卡地里”指标）
};

export class CharacterCore {
  private everClimbed = false;
  /** ★ 爬升承诺（用户定 2026-09-26）：一旦起爬 → 锁存本次坡+落点，不受凭证丢失/steer 过期/限速/到达停步影响，直到落点。 */
  private session: {
    run: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number };
    lx: number; lz: number;
    tr: { id: number; t: number; phase: string; x: number; z: number; y?: number; px: number; pz: number; d: number; tOff: number; sOff: number; frames: number; y0: number; top0: number; buryMax: number; footGap: number };
  } | null = null;
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

    // ---- 凭证式上坡（用户定 2026-09-26 最终口径）：
    //   一旦起爬 → **承诺（ClimbCommit）**：锁存本次坡+落点，凭证丢失/steer 过期/限速/停步均不得中断，直到落点；
    //   未起爬时 **强制走位三点式**：①退出坡面 → ②坡底横移对齐 → ③正向进点；
    //   **起爬必须在爬坡点（≤CLIMB_START_R=0.6m）**，此时才查硬性防线（本格有 climb 位，禁硬边上爬）；
    //   精确记录：CLIMB_TRACE（起点坐标/点位/实测距/结局）。
    const committed = this.session !== null;
    if (committed && inp.climbAnyTerrain) { this.session = null; CLIMB_STATS.abandoned++; }   // 切到自由爬坡 → 弃约
    if (!inp.climbAnyTerrain && (committed || (inp.blockCliffClimb && inp.climbOrdered))) {
      const run = committed ? this.session!.run
        : (inp.climbPt ?? (probe.climbPoint ? probe.climbPoint(inp.x, inp.z, inp.dirX, inp.dirZ) : null));
      if (!committed) { CLIMB_STATS.cred++; if (!run) CLIMB_STATS.noRun++; }
      if (run) {
        const tx = -run.uz, tz = run.ux;
        const tOff = (inp.x - run.x) * tx + (inp.z - run.z) * tz;
        const sOff = (inp.x - run.x) * run.ux + (inp.z - run.z) * run.uz;
        const rw = (run as { w?: number; width?: number }).w ?? (run as { width?: number }).width ?? 3;
        const halfSpan = Math.max(CLIMB_POINT_TOL, Math.min(6, rw * 2));
        const lx = committed ? this.session!.lx : (run.lx ?? run.x + run.ux * 3.5);
        const lz = committed ? this.session!.lz : (run.lz ?? run.z + run.uz * 3.5);
        const dl = Math.hypot(lx - run.x, lz - run.z);   // 落点的法向坐标
        // ★ 到达（用户定 2026-09-26）：到落点附近（或已越过法向坐标）**且 脚已着地**
        //   （脚底贴到当前位置的最高表面；埋在体内/悬空都不算爬完）。
        const footTop = probe.topAt ? probe.topAt(inp.x, inp.z) : probe.heightAt(inp.x, inp.z, inp.y);
        const footOn = Number.isFinite(footTop) && Math.abs(footTop - inp.y) <= 0.25;
        const atLand = (Math.hypot(inp.x - lx, inp.z - lz) <= 1.0 || sOff >= dl - 0.6) && footOn;
        // ★ 承诺续爬（不可中断）：不再复核 atBase/硬边；
        //   仅在被明显拉离现场（回收/传送）时弃约。到落点 = 完成。
        if (committed) {
          const tr = this.session!.tr;
          tr.frames++;
          tr.footGap = Number.isFinite(footTop) ? footTop - inp.y : 0;   // 脚面差（<0 = 埋在地里）
          if (tr.footGap < -0.3) CLIMB_STATS.buryFrames++;
          if (-tr.footGap > tr.buryMax) tr.buryMax = -tr.footGap;
          const far = sOff < -(BASE_NEAR + 8) || Math.abs(tOff) > halfSpan + 8;
          if (far) { this.session = null; CLIMB_STATS.abandoned++; tr.phase = 'abandoned'; tr.x = inp.x; tr.z = inp.z; tr.y = inp.y; }
          else if (atLand) { this.session = null; CLIMB_STATS.landed++; tr.phase = 'landed'; tr.x = inp.x; tr.z = inp.z; tr.y = inp.y; }
          else {
            out.climbing = true;
            CLIMB_STATS.climbSteps++;
            const sp = inp.speed > 0.05 ? inp.speed : CLIMB_MIN_SPEED;   // 自主速：停步限速不能压死爬坡
            dx = run.ux * sp * CLIMB_SPEED_MUL * inp.dt;
            dz = run.uz * sp * CLIMB_SPEED_MUL * inp.dt;
          }
        } else {
          // ★★ 强制走位（用户定 2026-09-26）：**爬坡必须从爬坡点起步**——三点式：
          //   ① 退出坡面（深入/贴面且未对齐 → 沿 -n 后退）
          //   ② 沿坡底横移对齐（|tOff|>0.35 → 沿 ∓t 移到点的法线上）
          //   ③ 正向进点（对齐后沿 +n 进点）→ 到点（硬边防线）起步。
          CLIMB_STATS.run++;
          const dPt = Math.hypot(inp.x - run.x, inp.z - run.z);
          if (!atLand) {
            const sp = inp.speed > 0.05 ? inp.speed : CLIMB_MIN_SPEED;
            const deep = sOff > 0.3;
            const hugMis = Math.abs(tOff) > 1.0 && sOff > -1.0;
            if (deep || hugMis) {                       // ① 退出
              out.climbing = true; CLIMB_STATS.approach++;
              dx = -run.ux * sp * inp.dt; dz = -run.uz * sp * inp.dt;
            } else if (Math.abs(tOff) > 0.35) {         // ② 横移对齐
              const s = tOff > 0 ? -1 : 1;
              out.climbing = true; CLIMB_STATS.approach++;
              dx = s * tx * sp * inp.dt; dz = s * tz * sp * inp.dt;
            } else if (dPt > CLIMB_START_R) {           // ③ 正向进点
              out.climbing = true; CLIMB_STATS.approach++;
              dx = run.ux * sp * inp.dt; dz = run.uz * sp * inp.dt;
            } else {                                    // ④ 在点：硬边防线→起步
              const own = probe.climbPoint ? probe.climbPoint(inp.x, inp.z, run.ux, run.uz) : run;
              if (own !== null) {
                const top0 = probe.topAt ? probe.topAt(inp.x, inp.z) : probe.heightAt(inp.x, inp.z, inp.y);
                const tr = { id: ++CLIMB_SEQ, t: nowS, phase: 'ascend', x: inp.x, z: inp.z, y: inp.y,
                  px: run.x, pz: run.z, d: dPt, tOff, sOff, frames: 0,
                  y0: inp.y, top0: Number.isFinite(top0) ? top0 : inp.y, buryMax: 0, footGap: 0 };
                CLIMB_TRACE.push(tr);
                if (CLIMB_TRACE.length > 48) CLIMB_TRACE.shift();
                this.session = { run, lx, lz, tr };
                CLIMB_STATS.sessions++;
                CLIMB_STATS.startDistMax = Math.max(CLIMB_STATS.startDistMax, dPt);
                if (dPt > CLIMB_START_R + 0.05) CLIMB_STATS.badStarts++;
                out.climbing = true;
                CLIMB_STATS.climbSteps++;
                if (!this.everClimbed) { this.everClimbed = true; CLIMB_STATS.units++; }
                dx = run.ux * sp * CLIMB_SPEED_MUL * inp.dt;
                dz = run.uz * sp * CLIMB_SPEED_MUL * inp.dt;
              } else CLIMB_STATS.guardFail++;
            }
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
    // ★ 爬坡防卡地里（用户定 2026-09-26）：爬升态下贴地高取**上层表面**（y 抬到坡面/顶面），
    //   否则 y 感知选层会停在下层 → 人被埋进坡体（"卡地里"）。
    let gyOut = unburied ? (top as number) : gyAware;
    if (out.climbing) {
      // ★ 爬升态取**最高表面**（用户定 2026-09-26：直接贴着坡面/顶面走到高原顶）——
      //   y 感知取层在坡中/越顶时可能仍选下层 → 埋进坡体从另一端出头。
      const upTop = probe.topAt ? probe.topAt(gx, gz) : undefined;
      const up = (upTop !== undefined && Number.isFinite(upTop)) ? upTop : probe.heightAt(gx, gz, inp.y + 1.5);
      if (Number.isFinite(up) && up > gyOut) gyOut = up;
    }
    out.dx = dx;
    out.dz = dz;
    out.gy = gyOut;
    return out;
  }
}
