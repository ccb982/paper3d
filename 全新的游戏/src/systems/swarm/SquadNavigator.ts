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
  private readonly unitsBySquad = new Map<number, SwarmCarrier[]>();
  private readonly _centroid = { x: 0, z: 0 };

  /** ① 命令目标不可直达 → 求走廊 waypoint（全队共用）。
   *  重算触发：无路径 / 目标位移 > RETARGET_DIST / 超时；失败有冷却并回落直线。 */
  ensurePath(squads: SquadTable, squad: Squad, state: SquadOrderState, now: number): void {
    if (squad.type === 'flyer') return;          // 飞行兵走直线（独立空中层）
    const tgt = state.order.target;
    if (!tgt) return;
    const hasPath = !!state.order.path && state.order.path.length > 0;
    const moved = Math.hypot(tgt.x - state.pathGoalX, tgt.z - state.pathGoalZ);
    if (hasPath && moved <= NAV.RETARGET_DIST && now - state.pathAt <= NAV.REFRESH_S) return;
    if (state.pathFailedAt > 0 && now - state.pathFailedAt < NAV.FAIL_COOLDOWN_S) return;
    const raster = RasterMap.current;
    if (!raster || !squads.centroidOf(squad.id, this._centroid)) return;
    const path: { x: number; z: number }[] = [];
    // ★ 长距离优先 HPA*（全局、绕大障碍）；失败 → 有界 A*（SquadPath）→ 直线
    const dist = Math.hypot(tgt.x - this._centroid.x, tgt.z - this._centroid.z);
    let ok = false;
    const isFlyer = (squad.type as string) === 'flyer';
    // ★ 飞行不走地面折扣；地面 = 掩体折扣 × 该队兵种亲和（P1-3）
    const mul = (!isFlyer && this.pathMul)
      ? (x: number, z: number) => this.pathMul!(squad.type, x, z)
      : undefined;
    this.hpa.pathMul = mul ?? null;
    if (dist > 70) ok = this.hpa.find(raster, this._centroid.x, this._centroid.z, tgt.x, tgt.z, path);
    const warming = dist > 70 && this.hpa.warming;
    if (!ok) ok = this.pathFinder.find(raster, this._centroid.x, this._centroid.z, tgt.x, tgt.z, path, mul);
    if (ok) {
      state.order.path = path;
      state.pathGoalX = tgt.x;
      state.pathGoalZ = tgt.z;
      // ★ HPA 簇预热中：下一拍立刻重试（先用有界 A* 的路径顶上，绝不停摆）
      state.pathAt = warming ? 0 : now;
      state.pathFailedAt = 0;
    } else {
      // ★ 无解 → 清路径走直线（绝不停摆；冷却后再试）
      state.pathFailedAt = now;
      state.order.path = undefined;
    }
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
      const tgt = SquadTactics.currentTargetOf(state, this._centroid.x, this._centroid.z);
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

  /** ★ 每帧预热 HPA 簇（开销摊到多帧；长路径查询时已基本命中缓存） */
  warm(raster: RasterMap, x: number, z: number): void {
    this.hpa.warmup(raster, x, z, 2);
  }

  clear(): void {
    this.unitsBySquad.clear();
    this.hpa.clear();
  }
}
