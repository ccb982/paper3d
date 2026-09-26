// ============================================================
// SquadNavigator —— 小队寻路 + L3 编队 steer（自 SwarmSystem 拆出，控行数）
// ============================================================
// 两块相邻职责：
//   ① ensurePath：命令目标不可直达 → SquadPath A* 求走廊 waypoint
//      （写入 order.path；实体 steer 与代理指令共用，一次求解全队复用）
//   ② steerEntities：编队槽位 → moveTarget → applySteer
//      （有有效命令才接管；命令结束/超时一律释放 → 实体回落 local）
// 依赖：SquadTable / 队长核执行态、SquadPath（算法）、RasterMap（地形）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import type { SwarmCarrier } from '../../entity/SwarmUnit';
import { formationOffset } from './squad/Formation';
import type { SquadOrderState } from './squad/State';
import { currentTargetOf } from './squad/Anchor';
import type { Squad, SquadTable } from './SquadTable';
import { shouldKite, kitePoint } from './RangedTactics';
import { FeasibilityPath } from './nav/LongPath';
import type { PassTable } from './nav/PassTable';
import { localStep, canSegment, type LocalGrid } from './nav/LocalStep';
import { edgeStepGreedy, axisStepToward, EDGE_LAYER_TOL } from './nav/EdgeFollow';

/** 远程兵近似射程（弩 50 / 术士 52~55；选位/边撤边打阈值用它即可） */
const NAV_RANGE = 50;

/** 寻路参数（集中可调） */
export const NAV = {
  /** 目标位移超此值 → 重算（米） */
  RETARGET_DIST: 24,
  /** 路径最长有效期（秒；兜底地形变化） */
  REFRESH_S: 12,
  /** 求解失败冷却（秒；防每拍重试） */
  FAIL_COOLDOWN_S: 3,
  /** ★ 净推进停滞阈值（秒；S3b：距目标 3s 未缩短 ≥2m → 重算；替代位移/TTL 轮询） */
  STALL_S: 3,
  /** ★ 长短寻路分界（米；用户定 2026-09-25）：> 此值=长行军→长寻路（FeasibilityPath 全走廊）；
   *  ≤ 此值=交战/巡逻/驻守/就近施工→短寻路（LocalStep 局部绕障） */
  LONG_PATH_DIST: 40,
} as const;

/** 单例小队不排阵型（Boss/高威胁：目标点即自身位） */
const _zeroSlot = { fx: 0, fz: 0 };

export class SquadNavigator {
  /** ★ 寻路代价倍率（注入 SwarmSystem；★ 重构 P1-3：带小队兵种 → L3 兵种亲和折扣） */
  pathMul: ((type: string, x: number, z: number) => number) | null = null;
  /** ★ P4 重规划计数（白名单探针：队路径重解次数/分钟口径） */
  readonly dbg = { solves: 0, fail: 0, feasOk: 0, feasBlocked: 0, seg: 0, localOk: 0, localNull: 0 };
  /** ★ N1 可行性寻路（恒权·有向；命令门/小队底座用） */
  readonly feas = new FeasibilityPath();
  /** ★ S1：短寻路网格（生产 = PassTable） */
  private table: PassTable | null = null;
  /** ★ S1：语义风险注入（上层给地形语义；null = 无安全偏好） */
  riskAt: ((x: number, z: number) => number) | null = null;

  /** ★ N1：接可行性表（表就绪后可行性寻路接管命令门） */
  setPathTable(t: PassTable | null): void {
    this.table = t;
    this.feas.setTable(t);
  }

  /** ★ 巡逻点查询（用户口径：查询**可行**的移动目标点 → 短寻路来回走）：
   *  以锚点为中心、半径 r 的圆周上采样候选；回首选**从当前位置可行（BFS 可达）**的点；
   *  `leg`（±1）决定以"侧向"为基准扫圈 → 来回走。无可行点 → null（原地待命）。 */
  patrolNext(x: number, z: number, ax: number, az: number, r: number, leg: number): { x: number; z: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    const TAU = Math.PI * 2;
    const base = Math.atan2(z - az, x - ax) + (leg >= 0 ? Math.PI / 2 : -Math.PI / 2);
    const out: { x: number; z: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const a = base + (k / 8) * TAU;
      const px = ax + Math.cos(a) * r, pz = az + Math.sin(a) * r;
      out.length = 0;
      if (this.feas.find(x, z, px, pz, out) !== 'ok') continue;   // ★ 可行性校验（同一条链：BFS 可达）
      return { x: px, z: pz };
    }
    return null;
  }

  /** ★ 方案 A（移动消费格边图）：从执行态走廊取**格边步**（轴对齐 + canStep）；无走廊/到末尾 → null */
  edgeFromCorridor(state: SquadOrderState | null, x: number, z: number, y: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    const c = this.routeCursor(state, x, z, y);
    if (!c) return null;
    const st = axisStepToward(g, x, z, c.x - x, c.z - z);
    if (!st) return null;   // 步不出：调用方做"路线修正"（朝当前路点软走），**不得朝最终目标直线**
    return { dx: st.dx, dz: st.dz, climb: c.climb === true || g.climbAt(x, z, st.dx, st.dz) } as { dx: number; dz: number };
  }

  /** ★ 路线游标（用户定 2026-09-26）：沿走廊**单调锁存**推进的当前路点——
   *  到达判定 = 点距 ≤ arriveR **且同层**（H2 高精度：层高差 ≤ EDGE_LAYER_TOL）；
   *  已越过的路点永不回头（治"格边界最近格翻转"）；无走廊 → null。 */
  routeCursor(
    state: SquadOrderState | null, x: number, z: number, y: number, arriveR = 1.8,
  ): { x: number; z: number; climb?: boolean } | null {
    const g = this.localGrid();
    const path = state?.corridor ?? state?.order.path;
    if (!g || !path || path.length === 0) return null;
    if (!state) return null;
    let i = Math.max(0, Math.min(state.followIdx ?? 0, path.length - 1));
    const reached = (p: { x: number; z: number }): boolean => {
      if (Math.hypot(p.x - x, p.z - z) > arriveR) return false;
      return Math.abs(g.heightAt(p.x, p.z) - y) <= EDGE_LAYER_TOL;   // ★ H2：同格不同层 ≠ 到达
    };
    while (i < path.length - 1 && reached(path[i] as { x: number; z: number })) i++;
    state.followIdx = i;
    return path[i] as { x: number; z: number; climb?: boolean };
  }

  /** ★ 方案 A：贪心格边步（成员跟队长 / 无路线；同格 → null 交软跟随） */
  edgeGreedy(x: number, z: number, y: number, tx: number, tz: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    return edgeStepGreedy(g, x, z, y, tx, tz);
  }

  /** ★ 路线修正方向（单位向量）：朝当前锁存路点（无走廊/零距 → null；绝不朝最终目标） */
  routeDir(state: SquadOrderState | null, x: number, z: number, y: number): { x: number; z: number } | null {
    const rp = this.routeCursor(state, x, z, y);
    if (!rp) return null;
    const rx = rp.x - x, rz = rp.z - z;
    const rl = Math.hypot(rx, rz);
    return rl > 1e-3 ? { x: rx / rl, z: rz / rl } : null;
  }

  /** ★ S1：短寻路网格端口（PassTable 只读 + 语义风险） */
  private localGrid(): LocalGrid | null {
    const t = this.table;
    if (!t || !t.ready) return null;
    const risk = this.riskAt;
    return {
      canStep: (x, z, dx, dz) => t.canStep(x, z, dx, dz),
      climbAt: (x, z, dx, dz) => t.climbAt(x, z, dx, dz),
      dropAt: (x, z, dx, dz) => t.dropAt(x, z, dx, dz),
      waterAt: (x, z) => t.waterAt(x, z),
      heightAt: (x, z) => t.heightAt(x, z),
      riskAt: risk ? (x, z) => risk(x, z) : () => 0,
    };
  }

  /** ★ 阶段二：偏好重算（掩体代次变化触发一次；由 commander 注入） */
  stampFn: (() => number) | null = null;
  /** ★ 走廊生成（2026-09-23 定稿）：**LOS 10m 短路 + 贪心校验**——
   *  每次从当前位置取 ~10m 内 LOS 可走的候选，按"推进+安全"贪心选一点（一次一跳，滚动重算）；
   *  自然就是可行路，不需要后向 LOS/BFS 优先。贪心全无推进才回落表图 BFS。 */
  weighted = true;
  private readonly unitsBySquad = new Map<number, SwarmCarrier[]>();
  private readonly _from = { x: 0, z: 0 };

  /** ① 命令目标 → 路线（全队共用；**用命令=按距离选寻路**：>40m 长=可行性表 S2 / ≤40m 短=LocalStep S1）。
   *  ★ 执行侧最小契约（用户定 2026-09-25 /《寻路重写方案.md》§4.4）：
   *    距离选路 → 沿路点走 → 到达即止；失败冷却重试；**不发不可保证的路**（无直线兜底）。
   *  ★ 不打断保障（S3b）：重算仅 4 事件（目标变/停滞3s/表代次/到达）；其余保持路线不动。
   *  ★ 不做（已回滚）：逐格择向 / climb 强制下发 / 原子单源——执行侧不堆机制。 */
  ensurePath(squads: SquadTable, squad: Squad, state: SquadOrderState, now: number, leaderY = 0): void {
    if (squad.type === 'flyer') return;          // 飞行兵走直线（独立空中层）
    const tgt = state.order.target;
    if (!tgt) return;
    const cur = state.corridor ?? state.order.path;
    const hasPath = !!cur && cur.length > 0;
    const raster = RasterMap.current;
    const lead = squad.members.get(squad.leaderUid);   // ★ 无质心（用户定 2026-09-24）：路从队长算
    if (!raster || !lead) return;
    this._from.x = lead.x; this._from.z = lead.z;
    // ★ H2（用户定 2026-09-25）：起点按**层**取格——单位 y 与所在格高不符（崖底被算在崖顶格）时，
    //   改从 5×5 邻域内"同层格"起步（否则 find 会判"同格/已在目标层"→ 路线失真、单位顶着崖壁）。
    if (this.table) {
      const h0 = this.table.heightAt(this._from.x, this._from.z);
      if (Number.isFinite(h0) && h0 - leaderY > 0.6) {
        const baseX = Math.floor(this._from.x / 4), baseZ = Math.floor(this._from.z / 4);
        let best: { x: number; z: number } | null = null;
        let bd = Infinity;
        for (let dz2 = -2; dz2 <= 2; dz2++) {
          for (let dx2 = -2; dx2 <= 2; dx2++) {
            const cx = (baseX + dx2) * 4 + 2, cz = (baseZ + dz2) * 4 + 2;
            const h = this.table.heightAt(cx, cz);
            if (!Number.isFinite(h) || Math.abs(h - leaderY) > 0.6) continue;
            const d2 = Math.hypot(cx - this._from.x, cz - this._from.z);
            if (d2 < bd) { bd = d2; best = { x: cx, z: cz }; }
          }
        }
        if (best) { this._from.x = best.x; this._from.z = best.z; }
      }
    }
    // ★ S3b 使用契约（《寻路重写方案.md》§4.4）：**重规划仅 4 事件**，其余保持路线不动
    //   ① 目标位移 > RETARGET_DIST  ② 净推进停滞 > STALL_S（距目标 3s 未缩短 ≥2m）
    //   ③ 表代次变化（掩体/地形）   ④ 到达（上层判定，无需路径）
    const dNow = Math.hypot(tgt.x - this._from.x, tgt.z - this._from.z);
    const moved = Math.hypot(tgt.x - state.pathGoalX, tgt.z - state.pathGoalZ);
    const stamp = this.stampFn?.() ?? 0;
    const stampChanged = state.costStamp !== stamp;
    if (state.stallAt === undefined || dNow < (state.stallD ?? Infinity) - 2) {
      state.stallAt = now;
      state.stallD = dNow;
    }
    const stalled = hasPath && now - (state.stallAt ?? now) > NAV.STALL_S;
    if (hasPath && moved <= NAV.RETARGET_DIST && !stampChanged && !stalled) return;
    if (state.pathFailedAt > 0 && now - state.pathFailedAt < NAV.FAIL_COOLDOWN_S) return;
    // ★ 长短归属（用户定 2026-09-25）：**按距离**（>40m 长 / ≤40m 短）；长寻路非引擎专属——
    //   队长派件也可走长寻路（如工兵被派到防区）。
    // ★ 长短寻路分工（用户定 2026-09-25）：长行军（>LONG_PATH_DIST）→ **长寻路**（BFS 全走廊）；
    //   短程（交战/巡逻/驻守/就近施工）→ 短跳（LOS 10m 贪心）
    const dTgt0 = Math.hypot(tgt.x - this._from.x, tgt.z - this._from.z);
    const longHaul = dTgt0 > NAV.LONG_PATH_DIST;
    if (this.weighted && this.feas.readyFor() && !longHaul) {
      // ★ S1：短寻路 = localStep（两阶段：语义安全引导 → 可行性校验；终点精确；无解 null）
      //   用户口径：路径无需最短；目标点不许走偏；上坡显式（climb 标注）
      const g = this.localGrid();
      if (g) {
        const step = localStep(g, this._from.x, this._from.z, tgt.x, tgt.z);
        if (step) {
          const tail = canSegment(g, step.next.x, step.next.z, tgt.x, tgt.z);
          state.corridor = [
            { x: step.next.x, z: step.next.z, climb: step.climb },
            { x: tgt.x, z: tgt.z, climb: tail.ok ? tail.climb : false },   // 末段爬坡标注
          ];
          state.followIdx = 0;   // ★ 新走廊 → 路线游标归零
          state.pathGoalX = tgt.x;
          state.pathGoalZ = tgt.z;
          state.pathFromX = this._from.x;
          state.pathFromZ = this._from.z;
          state.costStamp = stamp;
          state.pathAt = now;
          state.pathFailedAt = 0;
          state.stallAt = now; state.stallD = dNow;
          this.dbg.seg++;
          this.dbg.localOk++;
          return;
        }
        this.dbg.localNull++;   // 无解：不原地打转 → 回落可行性 BFS（长寻路兜底）/ 冷却
      }
    }
    // ★ N1 阶段一：可行性寻路出走廊（恒权 · 有向；WeightedPath 暂时旁路）
    const feasOut: { x: number; z: number }[] = [];
    const feas = this.feas.find(this._from.x, this._from.z, tgt.x, tgt.z, feasOut);
    if (feas === 'ok') {
      this.dbg.feasOk++;
      // 表图 BFS 可行路线（S2：加密 ≤10m + 逐段 climb；覆盖式，命令对象只读）
      state.corridor = feasOut;
      state.followIdx = 0;   // ★ 新走廊 → 路线游标归零
      state.pathGoalX = tgt.x;
      state.pathGoalZ = tgt.z;
      state.pathFromX = this._from.x;
      state.pathFromZ = this._from.z;
      state.pathAt = now;
      state.pathFailedAt = 0;
      state.costStamp = stamp;                 // ★ S3b：代次记账（否则每拍都判"代次变"）
      state.stallAt = now; state.stallD = dNow;
      return;
    }
    if (feas === 'blocked') {
      // 可行性判死：绝不发不可走的路（清路径 + 冷却；命令门/队长会改派或等 TTL）
      this.dbg.feasBlocked++;
      state.pathFailedAt = now;
      state.corridor = undefined;
      state.followIdx = undefined;
      return;
    }
    // ★ S2（用户定 2026-09-25）：**长寻路只用可行性表**——表外/未就绪 → 不发不可保证的路。
    //   HPA*/加权有向 A*/coarse 软参考/直线兜底**全部退出主链**（S4 清理；宁停不猜，抵达优先）。
    this.dbg.solves++;
    this.dbg.fail++;
    state.pathFailedAt = now;
    state.corridor = undefined;
    state.followIdx = undefined;
  }

  /** ② L3 实体编队 steer（10Hz 调用）：命令目标（或走廊路点）+ 阵型槽位 → moveTarget。 */
  steerEntities(
    units: readonly SwarmCarrier[] | undefined,
    squads: SquadTable,
    stateOf: (sid: number) => SquadOrderState | null,
    now: number,
    /** ★ 远程有利位置提供者（制高/掩体后；由指挥器实现；minDist = 边撤边打要求更远） */
    rangedPost?: (x: number, z: number, range: number, minDist?: number) => { x: number; z: number } | null,
  ): void {
    if (!units || units.length === 0) return;
    const bySquad = this.unitsBySquad;
    bySquad.clear();
    for (const u of units) {
      if (u.carrier !== 'entity' || u.activation !== 'active') continue;
      let arr = bySquad.get(u.squadId);
      if (!arr) { arr = []; bySquad.set(u.squadId, arr); }
      arr.push(u);
    }
    for (const [sid, members] of bySquad) {
      const state = stateOf(sid);
      const active = !!state && (state.until <= 0 || now <= state.until) && now >= state.notBefore;
      if (!active || !state) {
        for (const u of members) u.applySteer(null);
        continue;
      }
      const squad = squads.get(sid);
      if (!squad) {
        for (const u of members) u.applySteer(null);
        continue;
      }
      const lead = squad.members.get(squad.leaderUid);   // ★ 无质心：一切按队长
      if (!lead) continue;
      const tgt = currentTargetOf(state, lead.x, lead.z);
      if (!tgt) continue;
      const dx = tgt.x - lead.x;
      const dz = tgt.z - lead.z;
      const len = Math.hypot(dx, dz);
      const fx = len > 1e-3 ? dx / len : 1;
      const fz = len > 1e-3 ? dz / len : 0;
      const type = squad.type;
      const singleton = squad.singleton;
      for (const u of members) {
        // ★ 远程：**统一形式（用户定 2026-09-25）**——选位/风筝只**产出一个目标点**，
        //   移动走同一条链（`edgeGreedy` 格边步 + 可行性）；不可达/未到位 → 站住打。禁止旁路直推。
        if (rangedPost && u.attackType === 'ranged') {
          const up = u.position;
          const dT = Math.hypot(tgt.x - up.x, tgt.z - up.z);
          const speed = u.moveSpeed > 0 ? u.moveSpeed : 2.5;
          const kp = shouldKite(dT, NAV_RANGE)
            ? (rangedPost(up.x, up.z, NAV_RANGE, dT + 4) ?? kitePoint(tgt.x, tgt.z, up.x, up.z, NAV_RANGE))
            : rangedPost(up.x, up.z, NAV_RANGE);
          if (kp) {
            const e = this.edgeGreedy(up.x, up.z, up.y, kp.x, kp.z);
            if (e) {
              const mt = u.moveTarget;
              if (mt) { mt.x = kp.x; mt.y = 0; mt.z = kp.z; }
              else u.moveTarget = { x: kp.x, y: 0, z: kp.z };
              u.controlSource = 'swarm';
              u.applySteer({
                dirX: e.dx, dirZ: e.dz, speed,
                source: 'formation', targetX: kp.x, targetY: 0, targetZ: kp.z,
              });
              continue;
            }
          }
          // ★ 已在理想射程位（或目标点不可达/同格同层）：站住打（不追、不随编队前压）
          {
            const mt = u.moveTarget;
            if (mt) { mt.x = up.x; mt.y = 0; mt.z = up.z; }
            u.controlSource = 'swarm';
            u.applySteer({ dirX: 0, dirZ: 0, speed: 0, source: 'formation', targetX: up.x, targetY: 0, targetZ: up.z });
            continue;
          }
        }
        // ★ 槽位 rank = 全员 uid（与 applyOrders 同口径：L3 + 代理跨 LOD 不换位）
        let rank = 0;
        for (const uid of squad.members.keys()) if (uid < u.swarmUid) rank++;
        const off = singleton ? _zeroSlot : formationOffset(type, rank);
        const isLead = u.swarmUid === squad.leaderUid;
        const bx = isLead ? tgt.x : lead.x;   // ★ 队长走锚点；成员围队长（"只要跟随队长"）
        const bz = isLead ? tgt.z : lead.z;
        const sx = bx + fx * off.fx - fz * off.fz;
        const sz = bz + fz * off.fx + fx * off.fz;
        u.formSlot = rank;
        const needClimb = (tgt as { climb?: boolean }).climb === true;   // ★ 寻路明确标注的爬坡位（用户定 2026-09-24）
        // ★ 方案 A：L3 同款格边步（队长沿走廊 / 成员贪心跟队长）
        let sdx = fx, sdz = fz;
        const upos0 = u.position;
        const e3 = isLead ? this.edgeFromCorridor(state, upos0.x, upos0.z, upos0.y) : this.edgeGreedy(upos0.x, upos0.z, upos0.y, sx, sz);
        if (e3) { sdx = e3.dx; sdz = e3.dz; }
        else if (isLead) {
          const rd = this.routeDir(state, upos0.x, upos0.z, upos0.y);   // ★ 路线修正（同 L2）
          if (rd) { sdx = rd.x; sdz = rd.z; }
        }
        const mt = u.moveTarget;
        if (mt) { mt.x = sx; mt.y = 0; mt.z = sz; mt.climb = needClimb; }
        else u.moveTarget = { x: sx, y: 0, z: sz, climb: needClimb };
        u.controlSource = 'swarm';
        u.applySteer({
          dirX: sdx, dirZ: sdz,
          speed: u.moveSpeed > 0 ? u.moveSpeed : 2.5,
          source: 'formation',
          targetX: sx, targetY: 0, targetZ: sz,
          climb: needClimb,
        });
      }
    }
  }

  clear(): void {
    this.unitsBySquad.clear();
  }
}
