// ============================================================
// SquadNavigator —— 小队寻路 + L3 编队 steer（自 SwarmSystem 拆出，控行数）
// ============================================================
// 两块相邻职责：
//   ① ensurePath：命令目标不可直达 → SquadPath A* 求走廊 waypoint
//      （写入 order.path；实体 steer 与代理指令共用，一次求解全队复用）
//   ② steerEntities：编队槽位 → moveTarget → applySteer
//      （有有效命令才接管；命令结束/超时一律释放 → 实体回落 local）
// 依赖：SquadTable / SquadTactics（数据面）、SquadPath（算法）、RasterMap（地形）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import type { SwarmCarrier } from '../../entity/SwarmUnit';
import { formationOffset } from './Formation';
import { SquadPathFinder } from './SquadPath';
import { HpaPath } from './HpaPath';
import { SquadTactics, type SquadOrderState } from './SquadTactics';
import type { Squad, SquadTable } from './SquadTable';
import { shouldKite, kitePoint } from './RangedTactics';
import { DANGER } from './SwarmDanger';
import { FeasibilityPath } from './FeasibilityPath';
import type { PassTable } from './PassTable';

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
  readonly dbg = { solves: 0, hpa: 0, astar: 0, coarse: 0, fail: 0, feasOk: 0, feasBlocked: 0, seg: 0 };
  /** ★ N1 可行性寻路（恒权·有向；命令门/小队底座用） */
  readonly feas = new FeasibilityPath();

  /** ★ N1：接可行性表（表就绪后可行性寻路接管命令门） */
  setPathTable(t: PassTable | null): void {
    this.feas.setTable(t);
    this.pathFinder.setTable(t);   // ★ 阶段二：加权 A* 边判定也读表（可行性+权重同底座）
  }

  /** ★ 阶段二：偏好重算（掩体代次变化触发一次；由 commander 注入） */
  stampFn: (() => number) | null = null;
  /** ★ 走廊生成（2026-09-23 定稿）：**LOS 10m 短路 + 贪心校验**——
   *  每次从当前位置取 ~10m 内 LOS 可走的候选，按"推进+安全"贪心选一点（一次一跳，滚动重算）；
   *  自然就是可行路，不需要后向 LOS/BFS 优先。贪心全无推进才回落表图 BFS。 */
  weighted = true;
  private readonly unitsBySquad = new Map<number, SwarmCarrier[]>();
  private readonly _centroid = { x: 0, z: 0 };

  /** ① 命令目标不可直达 → 求走廊 waypoint（全队共用）。
   *  重算触发：无路径 / 目标位移 > RETARGET_DIST / 超时；失败有冷却并回落直线。 */
  ensurePath(squads: SquadTable, squad: Squad, state: SquadOrderState, now: number): void {
    if (squad.type === 'flyer') return;          // 飞行兵走直线（独立空中层）
    const tgt = state.order.target;
    if (!tgt) return;
    const cur = state.corridor ?? state.order.path;
    const hasPath = !!cur && cur.length > 0;
    const raster = RasterMap.current;
    if (!raster || !squads.centroidOf(squad.id, this._centroid)) return;
    // ★ 大修②：目标不变、路径常新——质心离上次求解位 >12m 或超时 → 从当前位置重算（覆盖）
    const movedFrom = Math.hypot(
      this._centroid.x - (state.pathFromX ?? 0), this._centroid.z - (state.pathFromZ ?? 0),
    );
    const moved = Math.hypot(tgt.x - state.pathGoalX, tgt.z - state.pathGoalZ);
    const stamp = this.stampFn?.() ?? 0;
    // ★ 掩体构建**不强制**重规划：下一次自然重算（位移>12m / TTL）自动用改动后的掩体/战壕表
    if (hasPath && moved <= NAV.RETARGET_DIST && movedFrom <= 6 && now - state.pathAt <= NAV.REFRESH_S) return;
    if (state.pathFailedAt > 0 && now - state.pathFailedAt < NAV.FAIL_COOLDOWN_S) return;
    // ★ 队长走廊：LOS 10m 短路 + 贪心校验（一次一跳、滚动重算；不求最优）——队长侧
    if (this.weighted && this.feas.readyFor()) {
      const best = this.greedyStep(squad.type, this._centroid.x, this._centroid.z, tgt.x, tgt.z);
      if (best) {
        state.corridor = [best, { x: tgt.x, z: tgt.z }];   // 覆盖式：段点 + 终目标
        state.pathGoalX = tgt.x;
        state.pathGoalZ = tgt.z;
        state.pathFromX = this._centroid.x;
        state.pathFromZ = this._centroid.z;
        state.costStamp = stamp;
        state.pathAt = now;
        state.pathFailedAt = 0;
        this.dbg.seg++;
        return;
      }
      // 贪心无推进（全半径无解）→ 本拍不发新路，回落可行性 BFS 兜底
    }
    // ★ N1 阶段一：可行性寻路出走廊（恒权 · 有向；WeightedPath 暂时旁路）
    const feasOut: { x: number; z: number }[] = [];
    const feas = this.feas.find(this._centroid.x, this._centroid.z, tgt.x, tgt.z, feasOut);
    if (feas === 'ok') {
      this.dbg.feasOk++;
      // 贪心无推进时回落：表图 BFS 可行走廊（覆盖式；命令对象只读）
      state.corridor = feasOut;
      state.pathGoalX = tgt.x;
      state.pathGoalZ = tgt.z;
      state.pathFromX = this._centroid.x;
      state.pathFromZ = this._centroid.z;
      state.pathAt = now;
      state.pathFailedAt = 0;
      return;
    }
    if (feas === 'blocked') {
      // 可行性判死：绝不发不可走的路（清路径 + 冷却；命令门/队长会改派或等 TTL）
      this.dbg.feasBlocked++;
      state.pathFailedAt = now;
      state.corridor = undefined;
      return;
    }
    // 'outside'（表外/未就绪）→ 回落旧口径（HPA/有界 A*）
    this.dbg.solves++;   // ★ P4：白名单探针（真正进入求解；早退不计）
    const path: { x: number; z: number }[] = [];
    // ★ 长距离优先 HPA*（全局、绕大障碍）；失败 → 有界 A*（SquadPath）→ 直线
    const dist = Math.hypot(tgt.x - this._centroid.x, tgt.z - this._centroid.z);
    const isFlyer = (squad.type as string) === 'flyer';
    // ★ 飞行不走地面折扣；地面 = 掩体折扣 × 该队兵种亲和（P1-3）
    const mul = (!isFlyer && this.pathMul)
      ? (x: number, z: number) => this.pathMul!(squad.type, x, z)
      : undefined;
    this.hpa.pathMul = mul ?? null;
    // 一次求解必落一路（hpa/astar/coarse/fail；计数闭合 可断言）
    let src: 'hpa' | 'astar' | 'coarse' | 'fail' = 'fail';
    if (dist > 70 && this.hpa.find(raster, this._centroid.x, this._centroid.z, tgt.x, tgt.z, path)) src = 'hpa';
    else if (this.pathFinder.find(raster, this._centroid.x, this._centroid.z, tgt.x, tgt.z, path, mul)) src = 'astar';
    const warming = dist > 70 && this.hpa.warming;
    if (src === 'hpa' || src === 'astar') {
      this.dbg[src]++;
      state.corridor = path;   // ★ 寻路轨覆盖（命令对象只读）
      state.pathGoalX = tgt.x;
      state.pathGoalZ = tgt.z;
      state.pathFromX = this._centroid.x;
      state.pathFromZ = this._centroid.z;
      // ★ HPA 簇预热中：下一拍立刻重试（先用有界 A* 的路径顶上，绝不停摆）
      state.pathAt = warming ? 0 : now;
      state.pathFailedAt = 0;
    } else if (state.order.coarse && state.order.coarse.length > 0) {
      // ★ P2 coarse 软参考兜底：细解（HPA/有界A*）失败 → 沿随令 coarse 走廊走（仍优于直线）
      this.dbg.coarse++;
      state.corridor = state.order.coarse.slice();
      state.pathGoalX = tgt.x;
      state.pathGoalZ = tgt.z;
      state.pathFromX = this._centroid.x;
      state.pathFromZ = this._centroid.z;
      state.pathAt = now;
      state.pathFailedAt = 0;
    } else {
      // ★ 无解 → 清路径走直线（绝不停摆；冷却后再试）
      this.dbg.fail++;
      state.pathFailedAt = now;
      state.corridor = undefined;
    }
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
    tactics: SquadTactics,
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
      const state = tactics.board.get(sid);
      if (!state || (state.until > 0 && now > state.until) || !tactics.board.isActive(state, now)) {
        for (const u of members) u.applySteer(null);
        continue;
      }
      if (!squads.centroidOf(sid, this._centroid)) continue;
      // ★ P4 寻路轨优先：队长步令在身 → 编队锚点 = 当前步（过期/无步回退命令锚）
      const stepState = tactics.board.getPath(sid);
      const stepTgt = stepState && now < stepState.until ? stepState.order.target : null;
      const tgt = stepTgt ?? SquadTactics.currentTargetOf(state, this._centroid.x, this._centroid.z);
      if (!tgt) continue;
      const squad = squads.get(sid);
      if (!squad) {
        for (const u of members) u.applySteer(null);
        continue;
      }
      const dx = tgt.x - this._centroid.x;
      const dz = tgt.z - this._centroid.z;
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
        const sx = tgt.x + fx * off.fx - fz * off.fz;
        const sz = tgt.z + fz * off.fx + fx * off.fz;
        u.formSlot = rank;
        const mt = u.moveTarget;
        if (mt) { mt.x = sx; mt.y = 0; mt.z = sz; }
        else u.moveTarget = { x: sx, y: 0, z: sz };
        u.controlSource = 'swarm';
        u.applySteer({
          dirX: fx, dirZ: fz,
          speed: u.moveSpeed > 0 ? u.moveSpeed : 2.5,
          source: 'formation',
          targetX: sx, targetY: 0, targetZ: sz,
        });
      }
    }
  }

  /** ★ LOS 10m 短路 + 贪心校验：先小后大（10→6）；候选 = LOS 可走 + 更近（推进>0.5m）+ 更安全（掩体/战壕折扣） */
  private greedyStep(
    type: string, cx: number, cz: number, tx: number, tz: number,
  ): { x: number; z: number } | null {
    const dNow = Math.hypot(tx - cx, tz - cz);
    if (dNow < 2.5) return null;   // 已到：不需要段
    const W_ADV = 1, W_SAFE = 4;
    for (const r of [10, 6]) {   // ★ LOS 10m 短路（主）/ 6m（窄地形回落）
      let best: { x: number; z: number } | null = null;
      let bestS = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (!this.feas.walkableLine(cx, cz, x, z)) continue;
        const adv = dNow - Math.hypot(tx - x, tz - z);
        if (adv <= 0.5) continue;   // 必须更近
        const mul = this.pathMul?.(type, x, z) ?? 1;   // 0.6~1.5；越小=掩体/战壕越足
        const s = W_ADV * adv + W_SAFE * (1 - mul);
        if (s > bestS) { bestS = s; best = { x, z }; }
      }
      if (best) return best;   // 10m 有解 → 不放 6m
    }
    return null;
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
