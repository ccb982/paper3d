// ============================================================
// squad/Anchor —— 队长目标/站位解析（重写 P2/P4 归位；算法沿用现有）
// ============================================================
// 队长的**执行层**：走廊前瞻（corridorAhead）/ 队令目标（goalOf）/ 当前应赴路点
// （currentTargetOf）/ 站位锚（resolveAnchor：保护护卫点 + 驻守绕掩体 + 巡逻游弋）。
// 算法一字不改（《蜂群重写计划.md》§3：寻路/掩体沿用现有）；本文件只做**归属归位**：
// 目标真源 = 新 store（`setLiveOrderSource` 注入；旧板只作走廊/滞回缓存）。
// ============================================================

import { guardPoint, UNIT_TACTICS, ensureCovered, standBehindCover, type TerrainCover } from '../UnitTactics';
import type { SquadType } from '../../../entity/SwarmUnit';
import type { SquadOrderState } from './State';

/** 活令（新 store 的单源视图；kind/G/P） */
export interface LiveOrder {
  kind: string;
  target: { x: number; z: number };
  anchor?: { x: number; z: number };
  threat?: { x: number; z: number };
}

let liveOrderOf: ((squadId: number) => LiveOrder | null) | null = null;

/** 注入活令查询（main.ts 接线：engine/OrderWriter 的 SquadOrderStore） */
export function setLiveOrderSource(fn: ((squadId: number) => LiveOrder | null) | null): void {
  liveOrderOf = fn;
}

/** ★ 队令目标（新 store 单源；缺省回退旧板） */
export function goalOf(state: SquadOrderState): { x: number; z: number } | null {
  return liveOrderOf?.(state.squadId)?.target ?? state.order.target ?? null;
}

/** ★ 走廊前瞻点（无状态；look 米）：最近点之后第一个 >look 的点；无 → 末点；无路 → null。
 *  消费：队长锚点 / 掉队成员"长寻路找队长"（沿同一走廊）。 */
export function corridorAhead(
  state: SquadOrderState | null | undefined, cx: number, cz: number, look: number,
): { x: number; z: number; climb?: boolean } | null {
  const path = state?.corridor ?? state?.order.path;
  if (!path || path.length === 0) return null;
  let near = 0, nd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d2 = (path[i].x - cx) * (path[i].x - cx) + (path[i].z - cz) * (path[i].z - cz);
    if (d2 < nd) { nd = d2; near = i; }
  }
  for (let i = near; i < path.length; i++) {
    const d2 = (path[i].x - cx) * (path[i].x - cx) + (path[i].z - cz) * (path[i].z - cz);
    if (d2 > look * look) return path[i];
  }
  return path[path.length - 1];
}

/** ★ 五轴「路径」：取当前应赴的路点（前方第一个 >8m 的点；都近 = 末点；带锚点滞回） */
export function currentTargetOf(state: SquadOrderState, cx: number, cz: number): { x: number; z: number; climb?: boolean } | null {
  const tgtPt = corridorAhead(state, cx, cz, 8);
  if (tgtPt) {
    // ★ 末程回落（用户定 2026-09-24）：**走廊终点 ≠ 队令目标**且目标已近（<15m）→ 以队令目标为准
    const ot0 = goalOf(state);
    if (ot0 && Math.hypot(ot0.x - cx, ot0.z - cz) < 15
      && Math.hypot(tgtPt.x - ot0.x, tgtPt.z - ot0.z) > 1.5) {
      state.anchorX = ot0.x; state.anchorZ = ot0.z;
      return { x: ot0.x, z: ot0.z };
    }
    // ★ 锚点滞回（用户定 2026-09-25）：新锚点与旧锚 <6m（抖动）→ 沿用旧锚，防振荡
    if (state.anchorX !== undefined && state.anchorZ !== undefined) {
      const ot = goalOf(state);
      const isGoal = !!ot && Math.hypot(tgtPt.x - ot.x, tgtPt.z - ot.z) < 1.5;
      const dd = Math.hypot(tgtPt.x - state.anchorX, tgtPt.z - state.anchorZ);
      if (!isGoal && dd < 6) return { x: state.anchorX, z: state.anchorZ, climb: state.anchorClimb };
    }
    state.anchorX = tgtPt.x; state.anchorZ = tgtPt.z; state.anchorClimb = tgtPt.climb;
    return tgtPt;
  }
  return goalOf(state);
}

/** ★ 命令锚（队长算具体站位）：
 *  防守（protect）= 护卫点 + 游弋 → ensureCovered 掩体复核；驻守（garrison）= 绕掩体站位；
 *  其余 = 路径/目标原样。目标/威胁/类型真源 = 新 store（旧板回退）。 */
export function resolveAnchor(
  state: SquadOrderState, cx: number, cz: number, type?: SquadType, now = 0,
  cover?: TerrainCover | null,
): { x: number; z: number; climb?: boolean } | null {
  const o = state.order;
  // ★ P4：活令（新 store）优先——kind/G/P 全从新 store 读；旧板只作走廊缓存
  const live = liveOrderOf?.(state.squadId) ?? null;
  const kind = live ? (live.kind === 'defend' ? 'garrison' : live.kind) : o.kind;
  //   保护令 G：新 store 在 anchor（target 只是调整点）；旧板语义 target = G
  const goal = live
    ? (live.kind === 'protect' ? (live.anchor ?? live.target) : live.target)
    : o.target;
  const tx = live ? live.threat?.x : o.threatX;
  const tz = live ? live.threat?.z : o.threatZ;
  if (kind === 'protect' && goal) {
    if (tx === undefined || tz === undefined) return goal;
    const p = type ? UNIT_TACTICS[type] : null;
    const g = guardPoint(goal.x, goal.z, tx, tz, p?.guardDist ?? 8);
    const dx = tx - goal.x, dz = tz - goal.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = -dz / dl, uz = dx / dl;
    const swing = Math.sin(now * 0.5 + state.squadId * 1.3) * (p?.patrolR ?? 4);
    const swung = { x: g.x + ux * swing, z: g.z + uz * swing };
    return ensureCovered(swung, tx, tz, cover);
  }
  if (kind === 'garrison' && goal) {
    if (tx === undefined || tz === undefined) return goal;
    return standBehindCover(goal.x, goal.z, tx, tz, cover);
  }
  return currentTargetOf(state, cx, cz);
}
