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
import type { SquadOrderState } from './squad/State';
import { currentTargetOf } from './squad/Anchor';
import type { Squad, SquadTable } from './SquadTable';
import { FeasibilityPath } from './nav/LongPath';
import type { PassTable } from './nav/PassTable';
import { localStep, canSegment, type LocalGrid } from './nav/LocalStep';
import { viaClimbPoints } from './nav/ClimbVia';
import { edgeStepGreedy, axisStepToward } from './nav/EdgeFollow';

/** 远程兵近似射程（弩 50 / 术士 52~55；选位/边撤边打阈值用它即可） */
const NAV_RANGE = 50;
/** ★ 远程选位锁存（用户定 2026-09-27，命令非必要不频繁变更）：
 *  目标位移超此值 → 重选位（米） */
/** ★ 走不动连续调用数（≈2s @10Hz）→ 重选一次位（可能换可达点） */
/** ★ 风筝模式退出滞回（米）：<24 触发边撤，>32 才解除（防阈值上每拍翻向） */

/** 寻路参数（集中可调） */
/** ★ 路线覆盖门（用户定 2026-09-27）：路线=命令执行队列的一部分——未执行 ≥80% 不得覆盖
 *  （长短切换/换路型同理）；仅 目标大位移 / 强制救援 / 已执行≥80% 后的停滞 才允许换。 */
const ROUTE_REPLACE_PROGRESS = 0.8;

export const NAV = {
  /** 目标位移超此值 → 重算（米） */
  RETARGET_DIST: 24,
  /** 求解失败冷却（秒；防每拍重试） */
  FAIL_COOLDOWN_S: 3,
  /** ★ 净推进停滞阈值（秒；S3b：距目标 3s 未缩短 ≥2m → 重算；替代位移/TTL 轮询） */
  STALL_S: 3,
  /** ★ 卡滞位移兜底（用户定 2026-09-29）：非驻守状态，5s 未离开附近 = 卡 */
  STUCK_S: 5,
  /** 卡滞判定半径（米；5s 位移 < 此值 = 没离开附近） */
  STUCK_R: 2,
  /** 横向推离时长（秒；第二次仍卡 → 侧向推一段） */
  STUCK_PUSH_S: 1.0,
  /** ★ 长短寻路分界（米；用户定 2026-09-25）：> 此值=长行军→长寻路（FeasibilityPath 全走廊）；
   *  ≤ 此值=交战/巡逻/驻守/就近施工→短寻路（LocalStep 局部绕障） */
  LONG_PATH_DIST: 40,
} as const;

/** ★ 成员到队长长寻路：重算周期（秒）/ 队长位移超限（米）/ 到位半径（米；到位即停） */
const MEMBER_ROUTE_S = 2.5;
const MEMBER_ROUTE_MOVE = 8;
const MEMBER_ARRIVE_R = 1.5;

/** ★ 上坡凭证计数（路线侧） */
export const CLIMB_ROUTE_STATS = { issued: 0, cleared: 0, kept: 0 };

export class SquadNavigator {
  /** ★ 寻路代价倍率（注入 SwarmSystem；★ 重构 P1-3：带小队兵种 → L3 兵种亲和折扣） */
  /** ★ P4 重规划计数（白名单探针：队路径重解次数/分钟口径） */
  readonly dbg = { solves: 0, fail: 0, feasOk: 0, feasBlocked: 0, seg: 0, localOk: 0, localNull: 0 };
  /** ★ 失败取证（诊断用）：最近 ensurePath 失败的 起点/目标/结果 */
  readonly dbgFail: { sx: number; sz: number; tx: number; tz: number; res: string }[] = [];
  private noteFail(res: string, tx: number, tz: number): void {
    if (this.dbgFail.length >= 16) this.dbgFail.shift();
    this.dbgFail.push({ sx: this._from.x, sz: this._from.z, tx, tz, res });
  }
  /** ★ N1 可行性寻路（恒权·有向；命令门/小队底座用） */
  readonly feas = new FeasibilityPath();
  /** ★ S1：短寻路网格（生产 = PassTable） */
  private table: PassTable | null = null;
  /** ★ S1：统一评分注入（上层给 TerrainScoring.scoreAt；null = 无偏好）——贪心近寻路消费 */
  scoreFn: ((x: number, z: number) => number | null) | null = null;

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
  edgeFromCorridor(state: SquadOrderState | null, x: number, z: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    const c = this.routeCursor(state, x, z);
    if (!c) return null;
    const e = axisStepToward(g, x, z, c.x - x, c.z - z);
    if (e) return e;
    // ★★ 短寻路兜底（用户定 2026-09-29："用短寻路"）：两轴都被禁 ≠ 无路——
    //   长走廊是**疏路点**，贪心轴步会被局部挡边卡死（有 corridor 却不走 → 站桩 → 判官收）。
    //   改：对**当前路点**做 LocalStep（短寻路；canSegment 逐边校验）→ 取它的第一步。
    const step = localStep(g, x, z, c.x, c.z);
    if (!step) return null;
    return axisStepToward(g, x, z, step.next.x - x, step.next.z - z);
  }

  /** ★ 路线游标（用户定 2026-09-26；2026-09-27 **去掉同层机制**）：沿走廊**单调锁存**推进的当前路点——
   *  到达判定 = 点距 ≤ arriveR（爬坡点 0.9m）。寻路只认 2D 格；高度由实体自己决定
   *  （脚底贴合/爬坡/碰撞内核处理），不做 y↔格高判等（水底/陡坡上会误冻路点）。 */
  routeCursor(
    state: SquadOrderState | null, x: number, z: number, arriveR = 1.8,
  ): { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } } | null {
    const g = this.localGrid();
    const path = state?.corridor ?? state?.order.path;
    if (!g || !path || path.length === 0) return null;
    if (!state) return null;
    let i = Math.max(0, Math.min(state.followIdx ?? 0, path.length - 1));
    const reached = (p: { x: number; z: number; climb?: boolean }): boolean => {
      // ★ 爬坡路点用**紧到位**（0.9m）：爬令保持到真的跨越（防提前翻掉→坡面中断）
      const r = p.climb === true ? Math.min(arriveR, 0.9) : arriveR;
      return Math.hypot(p.x - x, p.z - z) <= r;
    };
    while (i < path.length - 1 && reached(path[i] as { x: number; z: number })) i++;
    state.followIdx = i;
    return path[i] as { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } };
  }

  /** ★ 方案 A：贪心格边步（成员跟队长 / 无路线；同格 → null 交软跟随） */
  edgeGreedy(x: number, z: number, tx: number, tz: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    return edgeStepGreedy(g, x, z, tx, tz);
  }

  /** ★ 路线修正方向（单位向量）：朝当前锁存路点（无走廊/零距 → null；绝不朝最终目标） */
  /** ★ 新走廊的游标起点 = 离单位最近的路点索引（防“回走到起点”拖抽） */
  private nearestIdx(path: readonly { x: number; z: number }[], x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot((path[i] as { x: number }).x - x, (path[i] as { z: number }).z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return Math.min(best, path.length - 1);
  }

  /** ★★ 短寻路命令提交（用户定 2026-09-27）：**一次发放**，沿此走到点（≤1m）/
   *  发放超时（0.8s）/换路 才重算——防每帧重选轴向（格边步跨斜线时轴向每帧翻 → 拖抽）。 */
  stepCommit(
    state: SquadOrderState | null, x: number, z: number, now: number,
    compute: (goal: { x: number; z: number }) => { dx: number; dz: number } | null,
  ): { dx: number; dz: number } | null {
    if (state && state.mvAt !== undefined && now - state.mvAt < 0.8
      && Math.hypot(x - (state.mvGx ?? x), z - (state.mvGz ?? z)) > 1.0
      && ((state.mvDx ?? 0) !== 0 || (state.mvDz ?? 0) !== 0)) {
      return { dx: state.mvDx ?? 0, dz: state.mvDz ?? 0 };
    }
    const goal = { x, z };
    const step = compute(goal);
    if (state) {
      if (step) { state.mvDx = step.dx; state.mvDz = step.dz; state.mvGx = goal.x; state.mvGz = goal.z; state.mvAt = now; }
      else { state.mvAt = undefined; }
    }
    return step;
  }

  /** ★ 成员路线缓存（用户定 2026-09-26）：**定时（或队长位移超限）对队长位置做一次长寻路**；
   *  路只在缓存里，供"沿路走格边步"用（全部移动来自长短寻路）。 */
  private readonly memberRoutes = new Map<number, { path: { x: number; z: number; climb?: boolean }[]; at: number; gx: number; gz: number; idx?: number; cidx?: number }>();
  /** ★ 强制重寻路一次（用户定 2026-09-26：爬完坡后强制到原目标重寻路，防“爬完又掉下去”） */
  private readonly repath = new Set<number>();
  forceRepath(squadId: number): void { this.repath.add(squadId); }
  /** ★ 卡滞探测/推离（每队一条；被动位移兜底，用户定 2026-09-29） */
  private readonly stuck = new Map<number, { x: number; z: number; at: number; n: number }>();
  private readonly nudge = new Map<number, { dx: number; dz: number; until: number }>();
  /** 成员路线失效（下一次对队长重新长寻路；代理同口） */
  dropMemberRoute(uid: number): void { this.memberRoutes.delete(uid); }
  /** ★ 销毁前快照用：成员路线点数（-1 = 无缓存） */
  memberRouteInfo(uid: number): number {
    const m = this.memberRoutes.get(uid);
    return m ? m.path.length : -1;
  }

  /** 成员沿"自己的到队长路线"走一步（L2/L3 共用）：返回 {dx,dz,climb,done}；无解 → null（停） */
  memberStep(
    uid: number, x: number, z: number, lx: number, lz: number, now: number,
    state?: SquadOrderState | null,
  ): { dx: number; dz: number; done: boolean; direct?: boolean; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } } | null {
    if (Math.hypot(lx - x, lz - z) < MEMBER_ARRIVE_R) return { dx: 0, dz: 0, done: true };
    let memo = this.memberRoutes.get(uid);
    const stale = !memo || now - memo.at >= MEMBER_ROUTE_S || Math.hypot(lx - memo.gx, lz - memo.gz) > MEMBER_ROUTE_MOVE;
    if (stale) {
      const out: { x: number; z: number; climb?: boolean }[] = [];
      const res = this.feas.readyFor() ? this.feas.find(x, z, lx, lz, out) : 'outside';
      memo = { path: res === 'ok' ? out : [], at: now, gx: lx, gz: lz, idx: 0, cidx: 0 };
      this.memberRoutes.set(uid, memo);
    }
    // ★★ M3 路径单消费（用户定 2026-09-27）：成员路线改**单调游标**（只前进不回头）——
    //   旧 routeNextPath 是"最近点搜索"，绕行/折返时会回跳 → 到点前后方向来回（抖）。
    let rp: { x: number; z: number; climb?: boolean } | null = null;
    if (memo && memo.path.length) {
      let i = Math.max(0, Math.min(memo.idx ?? 0, memo.path.length - 1));
      while (i < memo.path.length - 1
        && Math.hypot((memo.path[i] as { x: number }).x - x, (memo.path[i] as { z: number }).z - z) <= 1.5) i++;
      memo.idx = i;
      rp = memo.path[i] as { x: number; z: number; climb?: boolean };
    }
    // 失败/表外 → 回退小队走廊（同一条长寻路；同样单调游标，成员各持一份进度）
    if (!rp && state) {
      const cpath = state.corridor ?? state.order.path;
      if (cpath && cpath.length) {
        let i = Math.max(0, Math.min(memo!.cidx ?? 0, cpath.length - 1));
        while (i < cpath.length - 1
          && Math.hypot((cpath[i] as { x: number }).x - x, (cpath[i] as { z: number }).z - z) <= 1.5) i++;
        memo!.cidx = i;
        rp = cpath[i] as { x: number; z: number; climb?: boolean };
      }
    }
    const stepE = rp ? this.edgeGreedy(x, z, rp.x, rp.z) : null;
    if (stepE) {
      // ★ 成员自己路线的凭证（用户定 2026-09-26）：**代理寻路追队长时也可得到凭证**——
      //   路径含跨坡点 ∧ 在低侧(sOff≤-0.5) ∧ 距≤10m（仅近点生效，防远处直线强拉）；
      //   与小队凭证并存（两条来源，取先到者）。
      const c = this.credOf(memo && memo.path.length ? memo.path : undefined);
      if (c) {
        const sOff = (x - c.x) * c.ux + (z - c.z) * c.uz;
        const d = Math.hypot(x - c.x, z - c.z);
        if (sOff <= -0.5 && d <= 10) return { dx: stepE.dx, dz: stepE.dz, done: false, climb: true, climbPt: c };
      }
      return { dx: stepE.dx, dz: stepE.dz, done: false };
    }
    // ★★ 兜底（用户定 2026-09-27，治"莫名其妙静止"）：自路线/小队走廊都取不到步 或 步不出 →
    //   ① 先朝**队长**走一格（同一格边链）；② 仍不行 → 直接给朝队长的方向（direct=true，
    //   上层跳过复算，交给内核处理水/岸/墙——否则成员在浅水/离轨处会永久站死）。
    {
      const el = this.edgeGreedy(x, z, lx, lz);
      if (el) return { dx: el.dx, dz: el.dz, done: false };
      const ax = lx - x, az = lz - z;
      const al = Math.hypot(ax, az);
      if (al > 1e-3) return { dx: ax / al, dz: az / al, done: false, direct: true };
      return null;
    }
  }

  /** ★ 从路线取凭证（第一条爬坡路点的凭证点；无 → 回收） */
  private credOf(path: readonly { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } }[] | undefined): { x: number; z: number; ux: number; uz: number; rise?: number; lx?: number; lz?: number; w?: number } | undefined {
    if (!path) return undefined;
    for (const wp of path) {
      if (wp.climb !== true) continue;
      if (wp.climbPt) return wp.climbPt;
      const run = this.table ? this.table.climbRunAt(wp.x, wp.z, 0, -1) : null;
      return run ? { x: run.x, z: run.z, ux: run.ux, uz: run.uz, rise: run.rise, lx: run.lx, lz: run.lz, w: run.width } : undefined;
    }
    return undefined;
  }

  /** ★ S1：短寻路网格端口（PassTable 只读 + 语义风险） */
  private localGrid(): LocalGrid | null {
    const t = this.table;
    if (!t || !t.ready) return null;
    const sc = this.scoreFn;
    return {
      canStep: (x, z, dx, dz) => t.canStep(x, z, dx, dz),
      climbAt: (x, z, dx, dz) => t.climbAt(x, z, dx, dz),
      dropAt: (x, z, dx, dz) => t.dropAt(x, z, dx, dz),
      waterAt: (x, z) => t.waterAt(x, z),
      heightAt: (x, z) => t.heightAt(x, z),
      scoreAt: sc ? (x, z) => sc(x, z) : undefined,
      climbRunAt: (x, z, dx, dz) => t.climbRunAt(x, z, dx, dz),
    };
  }

  /** ★ 阶段二：偏好重算（掩体代次变化触发一次；由 commander 注入） */
  stampFn: (() => number) | null = null;
  /** ★ 走廊生成（2026-09-23 定稿）：**LOS 10m 短路 + 贪心校验**——
   *  每次从当前位置取 ~10m 内 LOS 可走的候选，按"推进+安全"贪心选一点（一次一跳，滚动重算）；
   *  自然就是可行路，不需要后向 LOS/BFS 优先。贪心全无推进才回落表图 BFS。 */
  weighted = true;
  private readonly unitsBySquad = new Map<number, SwarmCarrier[]>();
  /** ★ 远程选位锁存（用户定 2026-09-27）：一次选位沿它走/到位就站住打——
   *  只有目标位移/风筝模式（带滞回）/走不动 才重选。防 10Hz 重算 → 目标翻转 → 原地来回。 */
  private readonly _from = { x: 0, z: 0 };

  /** ① 命令目标 → 路线（全队共用；**用命令=按距离选寻路**：>40m 长=可行性表 S2 / ≤40m 短=LocalStep S1）。
   *  ★ 执行侧最小契约（用户定 2026-09-25 /《寻路重写方案.md》§4.4）：
   *    距离选路 → 沿路点走 → 到达即止；失败冷却重试；**不发不可保证的路**（无直线兜底）。
   *  ★ 不打断保障（S3b）：重算仅 4 事件（目标变/停滞3s/表代次/到达）；其余保持路线不动。
   *  ★ 不做（已回滚）：逐格择向 / climb 强制下发 / 原子单源——执行侧不堆机制。 */
  /** ★ 凭证生命周期（用户定 2026-09-26）：**全小队持有**；新路有坡点 → 换票；
   *  无坡点 → 保留（队长过坡/成员在后换路时不得丢票）；只有"到达目标、接上下一条寻路"才回收。 */
  private applyCred(state: SquadOrderState, path: { x: number; z: number; climb?: boolean }[] | undefined, arrived: boolean): void {
    const c = this.credOf(path);
    if (c) {
      state.climbCred = c;
      CLIMB_ROUTE_STATS.issued++;
      return;
    }
    if (arrived) {
      if (state.climbCred) CLIMB_ROUTE_STATS.cleared++;
      state.climbCred = undefined;
      return;
    }
    if (state.climbCred) CLIMB_ROUTE_STATS.kept++;
  }

  ensurePath(_squads: SquadTable, squad: Squad, state: SquadOrderState, now: number, leaderAir = false): void {
    // ★ 飞行直航单源（用户定 2026-09-27 /《移动执行重写.md》§0 例外）：**空中队长**（含飞行队）不进地面寻路——
    //   不建走廊（移动由 driveAgent/steerEntities 的空中直航承担）；isAir 是唯一空中判据（队型只影响编成）。
    if (leaderAir) {
      state.corridor = undefined; state.climbCred = undefined;
      state.followIdx = undefined; state.tgtIdx = undefined;
      return;
    }
    const tgt = state.order.target;
    if (!tgt) return;
    // ★ 到达判定（用于凭证回收）：上一次路线的目标点已被走到
    const arrivedNow = state.pathGoalX !== undefined && state.pathGoalZ !== undefined
      && Math.hypot(this._from.x - state.pathGoalX, this._from.z - state.pathGoalZ) <= 2.0;
    const forced = this.repath.delete(squad.id);   // ★ 强制重寻路（消费一次）
    const cur = forced ? undefined : (state.corridor ?? state.order.path);
    const hasPath = !!cur && cur.length > 0;
    const raster = RasterMap.current;
    const lead = squad.members.get(squad.leaderUid);   // ★ 无质心（用户定 2026-09-24）：路从队长算
    if (!raster || !lead) return;
    // ★ 寻路只认 2D 格（用户定 2026-09-27：**删掉同层格机制**）——起点 = 单位 (x,z) 所在格；
    //   高度/层由实体自己决定（脚底贴合、爬坡、硬墙都由移动内核处理），寻路不做 y 判等。
    this._from.x = lead.x; this._from.z = lead.z;
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
    // ★ 路线覆盖门（用户定 2026-09-27）：**路线=命令执行队列的一部分，不能贸然覆盖**——
    //   现有路线已执行（游标消耗）≥ ROUTE_REPLACE_PROGRESS 才允许换；仅三类例外：
    //   ① 强制救援（forced）② 目标大位移（moved > RETARGET_DIST）③ 已执行≥80% 后的停滞。
    //   否则保持当前路线/路型（长/短不再随阈值横跳 → 不原地打转）。
    const routeProg = hasPath
      ? Math.min(1, (state.followIdx ?? 0) / Math.max(1, (cur?.length ?? 1) - 1))
      : 1;
    const canReplace = forced || moved > NAV.RETARGET_DIST
      || (stalled && routeProg >= ROUTE_REPLACE_PROGRESS);
    if (hasPath && !canReplace) return;
    if (!forced && state.pathFailedAt > 0 && now - state.pathFailedAt < NAV.FAIL_COOLDOWN_S) return;   // ★ forced 绕过冷却
    // ★ 长短归属（用户定 2026-09-25）：**按距离**（>40m 长 / ≤40m 短）；长寻路非引擎专属——
    //   队长派件也可走长寻路（如工兵被派到防区）。
    // ★ 长短寻路分工（用户定 2026-09-25）：长行军（>LONG_PATH_DIST）→ **长寻路**（BFS 全走廊）；
    //   短程（交战/巡逻/驻守/就近施工）→ 短跳（LOS 10m 贪心）
    const dTgt0 = Math.hypot(tgt.x - this._from.x, tgt.z - this._from.z);
    // ★ 长短归属**带滞回**（用户定 2026-09-27，治"有命令却不执行"）：固定 40m 阈值在目标距离 34~46m
    //   来回时会让路型每拍/每次重算横跳（短跳 2 点 ↔ BFS 长走廊）→ 方向翻转 → 原地打转。
    //   依据**现有路型**带 ±8m 死区：长则更晚才回落，短则更晚才升长。
    const wasLong = (state.corridor?.length ?? 0) > 4;
    const longHaul = wasLong
      ? dTgt0 > NAV.LONG_PATH_DIST - 8
      : dTgt0 > NAV.LONG_PATH_DIST + 8;
    if (this.weighted && this.feas.readyFor() && !longHaul) {
      // ★ S1：短寻路 = localStep（两阶段：语义安全引导 → 可行性校验；终点精确；无解 null）
      //   用户口径：路径无需最短；目标点不许走偏；上坡显式（climb 标注）
      const g = this.localGrid();
      if (g) {
        const step = localStep(g, this._from.x, this._from.z, tgt.x, tgt.z);
        if (step) {
          const tail = canSegment(g, step.next.x, step.next.z, tgt.x, tgt.z);
          // ★ 短寻路同样经**可行性表预处理的上坡点**（细采样跨坡 → 中间上坡点 → 跨坡★）
          const seg: { x: number; z: number; climb?: boolean }[] = [
            { x: step.next.x, z: step.next.z, climb: step.climb },
            { x: tgt.x, z: tgt.z, climb: tail.ok ? tail.climb : false },   // 末段爬坡标注
          ];
          state.corridor = (this.table && this.table.ready)
            ? viaClimbPoints(this.table, this._from.x, this._from.z, seg)
            : seg;
          // ★ 用户定 2026-09-27：**凭证属于路线**——新路线必须先清旧票（新路有坡点再由 applyCred 换发）。
          //   否则旧 climbCred 滞留 → 队长 `needClimb=true` 等爬、整队原地站死（残余被收根因之一）。
          state.climbCred = undefined;
          this.applyCred(state, state.corridor, arrivedNow);   // ★ 凭证生命周期（新路有坡点 → 换票）
          state.followIdx = this.nearestIdx(state.corridor, this._from.x, this._from.z); state.tgtIdx = state.followIdx;   // ★ 从最近点起步（不回路径起点）
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
      state.climbCred = undefined;   // ★ 新路线必清旧票（同上；凭证属于路线，不跨路线继承）
      this.applyCred(state, feasOut, arrivedNow);   // ★ 凭证生命周期（新路有坡点 → 换票）
      state.followIdx = 0; state.tgtIdx = 0;   // ★ 新走廊 → 路线游标归零
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
      this.noteFail('blocked', tgt.x, tgt.z);
      state.pathFailedAt = now;
      state.corridor = undefined;
      if (state.climbCred) CLIMB_ROUTE_STATS.cleared++;
      state.climbCred = undefined;
      state.followIdx = undefined; state.tgtIdx = undefined;
      return;
    }
    // ★ S2（用户定 2026-09-25）：**长寻路只用可行性表**——表外/未就绪 → 不发不可保证的路。
    //   HPA*/加权有向 A*/coarse 软参考/直线兜底**全部退出主链**（S4 清理；宁停不猜，抵达优先）。
    this.dbg.solves++;
    this.dbg.fail++;
    state.pathFailedAt = now;
    this.noteFail('outside/notReady', tgt.x, tgt.z);
    state.corridor = undefined;
    state.climbCred = undefined;
    state.followIdx = undefined; state.tgtIdx = undefined;
  }

  /** ★ 飞行直航单源（用户定 2026-09-27 /《移动执行重写.md》§0 例外）：空中单位一律直航——
   *  队长朝活动目标/选位点、成员朝队长；不经地面走廊/格边步（层判等对空中 y 永不成立 → 卡水/抖）。 */
  private flyStraight(u: SwarmCarrier, fx: number, fz: number, speed: number): void {
    const up = u.position;
    const dx = fx - up.x, dz = fz - up.z;
    const l = Math.hypot(dx, dz) || 1;
    const mt = u.moveTarget;
    if (mt) { mt.x = fx; mt.y = 0; mt.z = fz; mt.climb = false; }
    else u.moveTarget = { x: fx, y: 0, z: fz, climb: false };
    u.controlSource = 'swarm';
    u.applySteer({
      dirX: dx / l, dirZ: dz / l, speed,
      source: 'formation', targetX: fx, targetY: 0, targetZ: fz,
    });
  }

  /** ② L3 实体编队 steer（10Hz 调用）：命令目标（或走廊路点）+ 阵型槽位 → moveTarget。 */
  steerEntities(
    units: readonly SwarmCarrier[] | undefined,
    squads: SquadTable,
    stateOf: (sid: number) => SquadOrderState | null,
    now: number,
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
      // ★★ 卡滞位移兜底（用户定 2026-09-29）：**非驻守**状态，5s 未离开附近（<STUCK_R）= 卡 →
      //    ① 强制重寻路；② 再卡 5s → 横向推离（纯位移修正，不改选向/不换目标）。
      //    豁免：驻守（自身状态就是找掩体/驻留）；工兵在施工点工作（mission=build 且已到点）。
      const working = state.order.mission === 'build'
        && Math.hypot(tgt.x - lead.x, tgt.z - lead.z) <= 3.5;
      if (state.execState !== 'hold' && state.order.kind !== 'protect' && !working) {
        let sk = this.stuck.get(sid);
        if (!sk) { sk = { x: lead.x, z: lead.z, at: now, n: 0 }; this.stuck.set(sid, sk); }
        if (Math.hypot(lead.x - sk.x, lead.z - sk.z) > NAV.STUCK_R) {
          sk.x = lead.x; sk.z = lead.z; sk.at = now; sk.n = 0;
          this.nudge.delete(sid);
        } else if (now - sk.at >= NAV.STUCK_S) {
          if (sk.n === 0) {
            this.repath.add(sid);          // ① 强制重寻路（绕过路线覆盖门/冷却）
            sk.n = 1; sk.at = now;
          } else {
            // ② 仍卡 → 横向推离（确定性奇偶选侧；只修位移）
            const dx = tgt.x - lead.x, dz = tgt.z - lead.z;
            const d = Math.hypot(dx, dz) || 1;
            const side = (sid & 1) === 0 ? 1 : -1;
            this.nudge.set(sid, { dx: (-dz / d) * side, dz: (dx / d) * side, until: now + NAV.STUCK_PUSH_S });
            sk.n = 2; sk.at = now;
          }
        }
      } else {
        this.stuck.delete(sid);
        this.nudge.delete(sid);
      }
      const nd = this.nudge.get(sid);
      if (nd && now > nd.until) this.nudge.delete(sid);
      const cred = state.climbCred;
      for (const u of members) {
        // ★ 远程：**统一形式（用户定 2026-09-25）**——选位/风筝只**产出一个目标点**，
        //   移动走同一条链（`edgeGreedy` 格边步 + 可行性）；不可达/未到位 → 站住打。禁止旁路直推。
        // ★ 架构底线（用户定 2026-09-26）：**代理与队长的所有移动都来自长短寻路**——
        //   成员沿**同一走廊**：无状态 routeNext 求"己身的下一路点"（不追队长位置；无走廊 → 停）。
        let rank = 0;
        for (const uid of squad.members.keys()) if (uid < u.swarmUid) rank++;
        const isLead = u.swarmUid === squad.leaderUid;
        const upos0 = u.position;
        let sx = tgt.x, sz = tgt.z;
        // ★ 凭证口径（用户定 2026-09-26）：**队长需凭证；成员/代理无条件上送（无需凭证）**。
        let needClimb = isLead ? (state?.climbCred !== undefined) : true;
        let needClimbPt = state?.climbCred;
        // ★ 飞行直航单源（空中层，用户定 2026-09-27）：空中单位不走地面 corridor/memberStep——
        //   队长飞命令目标、成员飞队长；否则地面层判等/格边步会导致路点不推进（卡水/抖）。
        if (u.isAir) {
          this.flyStraight(u, isLead ? tgt.x : lead.x, isLead ? tgt.z : lead.z,
            u.moveSpeed > 0 ? u.moveSpeed : 2.5);
          continue;
        }
        if (!isLead) {
          const ms = this.memberStep(u.swarmUid, upos0.x, upos0.z, lead.x, lead.z, now, state);
          if (ms) { sx = upos0.x + ms.dx * 4; sz = upos0.z + ms.dz * 4; }
          else { sx = upos0.x; sz = upos0.z; }
          if (ms?.climbPt) needClimbPt = ms.climbPt;   // 成员路线带坡点则用其点位（凭证本身不需要）
        }
        u.formSlot = rank;
        // ★ 同链格边步（队长沿走廊游标 / 成员沿"自己的到队长路线"）；无步 → 站住
        let sdx = 0, sdz = 0;
        if (isLead) {
          const nd2 = this.nudge.get(sid);
          if (nd2) {
            // ★ 卡滞推离（位移兜底）：本段直接侧向推离
            sdx = nd2.dx; sdz = nd2.dz;
          } else {
          // ★ 短寻路一次发放（stepCommit）：沿已发放的格边步走到点才重选
          const stc = this.stepCommit(state, upos0.x, upos0.z, now, (goal) => {
            const c = this.routeCursor(state, upos0.x, upos0.z);
            if (!c) return null;
            const g = this.localGrid();
            const e = g ? axisStepToward(g, upos0.x, upos0.z, c.x - upos0.x, c.z - upos0.z) : null;
            if (!e) return null;
            goal.x = c.x; goal.z = c.z;
            return e;
          });
          if (stc) { sdx = stc.dx; sdz = stc.dz; }
          else {
            const e3 = this.edgeFromCorridor(state, upos0.x, upos0.z);
            if (e3) { sdx = e3.dx; sdz = e3.dz; }
          }
          }
        } else {
          const e3 = this.edgeGreedy(upos0.x, upos0.z, sx, sz);
          if (e3) { sdx = e3.dx; sdz = e3.dz; }
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
          climbPt: needClimbPt,
        });
      }
    }
  }

  clear(): void {
    this.unitsBySquad.clear();
    this.stuck.clear();
    this.nudge.clear();
  }
}
