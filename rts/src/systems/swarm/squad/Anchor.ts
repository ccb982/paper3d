// ============================================================
// squad/Anchor —— 队长目标/站位解析（重写 P2/P4 归位；算法沿用现有）
// ============================================================
// 队长的**执行层**：走廊推进（routeNext，S3a）/ 队令目标（goalOf）/ 当前应赴路点
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

/** ★ 沿路由推进（S3a）：**下一个未到达的路点**——**目标锁存（S3b 已实装）**：选定后锁定到
 *  "到达/段失效"才推进，禁止每拍在两点间翻转（《寻路重写方案.md》§4.4）。
 *  ——从最近路点向后找第一个距离 >adv 的点；
 *  都 ≤adv → 末点（终点=目标）。**绝不跳过中间绕行点**（原 look 前瞻会把绕行点吃掉 → 直线撞崖）。 */
export function routeNext(
  state: SquadOrderState | null | undefined, cx: number, cz: number, adv: number,
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
    if (d2 > adv * adv) return path[i];
  }
  return path[path.length - 1];
}

/** ★ 五轴「路径」：取当前应赴的路点 = **沿路由的下一个路点**（S3a）+ **目标锁存**（S3b）。
 *  锁存规则：选定路点后，直到"到达（≤ADV）"或"路线重算（pathAt 代次变）"才推进/换点——
 *  位置/求解每拍变化不再造成两点间翻转（对 4 事件重规划 + 非必要不打断）。 */
const LATCH_ADV = 2;   // 路点推进阈值（米）
export function currentTargetOf(state: SquadOrderState, cx: number, cz: number): { x: number; z: number; climb?: boolean } | null {
  const gen = state.pathAt;
  if (state.latchAt === gen && state.anchorX !== undefined && state.anchorZ !== undefined) {
    if (Math.hypot(state.anchorX - cx, state.anchorZ - cz) > LATCH_ADV) {
      return { x: state.anchorX, z: state.anchorZ, climb: state.anchorClimb };   // ★ 锁存：不换点
    }
  }
  const nxt = routeNext(state, cx, cz, LATCH_ADV);
  if (nxt) {
    state.anchorX = nxt.x; state.anchorZ = nxt.z; state.anchorClimb = nxt.climb;
    state.latchAt = gen;
    return nxt;
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
