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
import { SquadPathFinder } from './nav/Corridor';
import { HpaPath } from './HpaPath';
import type { SquadOrderState } from './squad/State';
import { currentTargetOf } from './squad/Anchor';
import type { Squad, SquadTable } from './SquadTable';
import { shouldKite, kitePoint } from './RangedTactics';
import { DANGER } from './SwarmDanger';
import { FeasibilityPath } from './nav/LongPath';
import type { PassTable } from './nav/PassTable';
import { localStep, canSegment, type LocalGrid } from './nav/LocalStep';
import { edgeStepRoute, edgeStepGreedy, cellsOfRoute } from './nav/EdgeFollow';

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
  private readonly pathFinder = new SquadPathFinder();
  /** ★ 寻路代价倍率（注入 SwarmSystem；★ 重构 P1-3：带小队兵种 → L3 兵种亲和折扣） */
  pathMul: ((type: string, x: number, z: number) => number) | null = null;
  /** ★ HPA* 全局寻路（长距优先；失败回落有界 A* / 直线） */
  private readonly hpa = new HpaPath();
  /** ★ P4 重规划计数（白名单探针：队路径重解次数/分钟口径） */
  readonly dbg = { solves: 0, hpa: 0, astar: 0, coarse: 0, fail: 0, feasOk: 0, feasBlocked: 0, seg: 0, localOk: 0, localNull: 0 };
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
    this.pathFinder.setTable(t);   // ★ 阶段二：加权 A* 边判定也读表（可行性+权重同底座）
  }

  /** ★ 方案 A（移动消费格边图）：从执行态走廊取**格边步**（轴对齐 + canStep）；无走廊/到末尾 → null */
  edgeFromCorridor(state: SquadOrderState | null, x: number, z: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    const path = state?.corridor ?? state?.order.path;
    if (!g || !path || path.length === 0) return null;
    return edgeStepRoute(g, x, z, cellsOfRoute(path));
  }

  /** ★ 方案 A：贪心格边步（成员跟队长 / 无路线；同格 → null 交软跟随） */
  edgeGreedy(x: number, z: number, tx: number, tz: number): { dx: number; dz: number } | null {
    const g = this.localGrid();
    if (!g) return null;
    return edgeStepGreedy(g, x, z, tx, tz);
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
  ensurePath(squads: SquadTable, squad: Squad, state: SquadOrderState, now: number): void {
    if (squad.type === 'flyer') return;          // 飞行兵走直线（独立空中层）
    const tgt = state.order.target;
    if (!tgt) return;
    const cur = state.corridor ?? state.order.path;
    const hasPath = !!cur && cur.length > 0;
    const raster = RasterMap.current;
    const lead = squad.members.get(squad.leaderUid);   // ★ 无质心（用户定 2026-09-24）：路从队长算
    if (!raster || !lead) return;
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
      return;
    }
    // ★ S2（用户定 2026-09-25）：**长寻路只用可行性表**——表外/未就绪 → 不发不可保证的路。
    //   HPA*/加权有向 A*/coarse 软参考/直线兜底**全部退出主链**（S4 清理；宁停不猜，抵达优先）。
    this.dbg.solves++;
    this.dbg.fail++;
    state.pathFailedAt = now;
    state.corridor = undefined;
  }

  /** ★ P2 初级寻路核验入口（大队发令前调用；与 ensurePath 共用 HPA 簇缓存）。
   *  直线走廊粗判（≤64m 零建簇）→ 否则簇级 find；区分 blocked/unknown 防冷启动误杀。 */
  coarseCheck(
    sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): 'ok' | 'blocked' | 'unknown' {
    const raster = RasterMap.current;
    out.length = 0;
    if (!raster) return 'unknown';
    const dist = Math.hypot(gx - sx, gz - sz);
    if (dist < 2) return 'ok';
    // ★ N1 阶段一：可行性寻路优先（读表 · 代价恒 1 · 有向边）；表外/未就绪 → 'outside' 回落旧口径
    const feas = this.feas.find(sx, sz, gx, gz, out);
    if (feas === 'ok') return 'ok';
    if (feas === 'blocked') return 'blocked';
    // 直线走廊粗判（4m 采样：仅拦 pit/水域——升向不在此判，避免误杀正常起伏）
    if (dist <= 64) {
      const n = Math.ceil(dist / 4);
      let clear = true;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = sx + (gx - sx) * t, z = sz + (gz - sz) * t;
        const h = raster.surfaceHeightAt(x, z);
        const role = raster.tileDefAt(x, z).genRole;
        if (role === 'pit' || h < DANGER.PIT_H) { clear = false; break; }
      }
      if (clear) return 'ok';
    }
    return this.hpa.coarseReachable(raster, sx, sz, gx, gz, out);
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
        // ★ 远程：不追打——玩家逼近 → 边撤边打；否则优先占制高/掩体后（覆盖编队槽位）
        if (rangedPost && u.attackType === 'ranged') {
          const up = u.position;
          const dT = Math.hypot(tgt.x - up.x, tgt.z - up.z);
          const speed = u.moveSpeed > 0 ? u.moveSpeed : 2.5;
          if (shouldKite(dT, NAV_RANGE)) {
            // ★ 边撤边打 = 优先换到"更远 + 有掩体/高地"的位置；没有才沿径向后撤
            const kp = rangedPost(up.x, up.z, NAV_RANGE, dT + 4) ?? kitePoint(tgt.x, tgt.z, up.x, up.z, NAV_RANGE);
            const kx = kp.x - up.x, kz = kp.z - up.z;
            const kl = Math.hypot(kx, kz) || 1;
            u.controlSource = 'swarm';
            u.applySteer({
              dirX: kx / kl, dirZ: kz / kl, speed,
              source: 'formation', targetX: kp.x, targetY: 0, targetZ: kp.z,
            });
            continue;
          }
          const post = rangedPost(up.x, up.z, NAV_RANGE);
          if (post) {
            const dx = post.x - up.x, dz = post.z - up.z;
            const dl = Math.hypot(dx, dz) || 1;
            const mt = u.moveTarget;
            if (mt) { mt.x = post.x; mt.y = 0; mt.z = post.z; }
            else u.moveTarget = { x: post.x, y: 0, z: post.z };
            u.controlSource = 'swarm';
            u.applySteer({
              dirX: dx / dl, dirZ: dz / dl, speed,
              source: 'formation', targetX: post.x, targetY: 0, targetZ: post.z,
            });
            continue;
          }
          // ★ 已在理想射程位：站住打（不追、不随编队前压）
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
        const e3 = isLead ? this.edgeFromCorridor(state, upos0.x, upos0.z) : this.edgeGreedy(upos0.x, upos0.z, sx, sz);
        if (e3) { sdx = e3.dx; sdz = e3.dz; }
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

  /** ★ 每帧预热 HPA 簇（开销摊到多帧；长路径查询时已基本命中缓存） */
  warm(raster: RasterMap, x: number, z: number): void {
    this.hpa.warmup(raster, x, z, 2);
  }

  clear(): void {
    this.unitsBySquad.clear();
    this.hpa.clear();
  }
}
