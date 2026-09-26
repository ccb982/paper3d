// ============================================================
// squad/Anchor —— 队长目标/站位解析（重写 P2/P4 归位；算法沿用现有）
// ============================================================
// 队长的**执行层**：走廊推进（routeNext，S3a）/ 队令目标（goalOf）/ 当前应赴路点
// （currentTargetOf；简化 2026-09-25：**去哪就去哪**——无锚点/无锁存/无掩体绕行）。
// 算法一字不改（《蜂群重写计划.md》§3：寻路/掩体沿用现有）；本文件只做**归属归位**：
// 目标真源 = 新 store（`setLiveOrderSource` 注入；旧板只作走廊/滞回缓存）。
// ============================================================

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

/** ★ 沿路由推进（S3a）：**下一个未到达的路点**——**目标锁存（S3b 已实装）**：选定后锁定到
 *  "到达/段失效"才推进，禁止每拍在两点间翻转（《寻路重写方案.md》§4.4）。
 *  ——从最近路点向后找第一个距离 >adv 的点；
 *  都 ≤adv → 末点（终点=目标）。**绝不跳过中间绕行点**（原 look 前瞻会把绕行点吃掉 → 直线撞崖）。 */
/** ★ 沿**任意路点序列**的下一个未到达路点（纯函数；成员自路线缓存也用） */
export function routeNextPath(
  path: readonly { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number } }[] | null | undefined,
  cx: number, cz: number, adv: number,
): { x: number; z: number; climb?: boolean; climbPt?: { x: number; z: number; ux: number; uz: number; rise?: number } } | null {
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

export function routeNext(
  state: SquadOrderState | null | undefined, cx: number, cz: number, adv: number,
): { x: number; z: number; climb?: boolean } | null {
  return routeNextPath(state?.corridor ?? state?.order.path, cx, cz, adv);
}

/** ★ 队长目标（唯一口径，简化 2026-09-25：**去哪就去哪**，无锚点/无锁存）：
 *  有路线 → **下一路点**（routeNext）；无路线 → **队令目标**。 */
const LATCH_ADV = 2;   // 路点推进阈值（米）
export function currentTargetOf(state: SquadOrderState, cx: number, cz: number): { x: number; z: number; climb?: boolean } | null {
  const nxt = routeNext(state, cx, cz, LATCH_ADV);
  return nxt ?? goalOf(state);
}
