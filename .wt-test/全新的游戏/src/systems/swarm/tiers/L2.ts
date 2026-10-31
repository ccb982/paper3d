// ============================================================
// swarm/tiers/L2 —— L2 档：队长 + 代理（只在地图数据上走；用户定 2026-09-27）
// ============================================================
// ★★ 移动设计（用户定 2026-09-27，单源口径；与 L1/L3 同）：
//   · 移动只有两种原语：**长寻路**（可行性长走廊）与**短寻路**（短跳）；
//   · **驻守** = 停在目标点；**巡逻** = 状态，**不停调用长/短寻路走向下一腿**；
//   · **空中不消费 directive**（抑制/选位/风筝非本设计）：移动只认**队令目标**
//     （`orderTarget`，队长核写；巡逻腿也在其中），到点停；
//   · 不做：段进-巡逻/停滞救援（兜底唯一归属 = L3）；掩体/攻击槽（L3 的事）。
// ============================================================

import type { AgentPool } from '../AgentPool';
import type { SquadOrderState } from '../squad/State';
import { SWARM } from '../SwarmConfig';

/** L2 走廊跟随游标（按队；stamp = 目标+长度，走廊变了就重置） */
const follow = new Map<number, { idx: number; stamp: string }>();

/** 到路点判定半径 / 路末停步半径（米） */
const WAYPOINT_R = 2.5;
const STOP_R = 1.2;

/**
 * L2 令执行：**长寻路优先**（走廊路点）→ 无走廊退回指令直行。
 * @returns true = 本拍已接管移动（调用方跳过游走）；false = 无令/已到位 → 交回游走。
 */
export function l2ExecuteDirective(
  pool: AgentPool, i: number, px: number, pz: number, _now: number,
  squadId: number, st: SquadOrderState | null,
): boolean {
  // ★ 运动单源（用户定 2026-09-27）：只认**队令目标**——地面优先**长/短寻路走廊**（队长核产出），
  //   无走廊直行；空中直航。**不消费 directive**（抑制/选位/风筝不属于本设计；开火独立）。
  if (pool.orderKind[i] === 0) return false;   // 无令 → 停（驻守/巡逻由队长核换目标）
  const corr = pool.isAir[i] === 1 ? undefined : (st && st.corridor && st.corridor.length > 1 ? st.corridor : undefined);
  if (st && corr) {
    const stamp = `${Math.round(st.pathGoalX ?? 0)},${Math.round(st.pathGoalZ ?? 0)}:${corr.length}`;
    let f = follow.get(squadId);
    if (!f || f.stamp !== stamp) {
      f = { idx: Math.max(0, st.followIdx ?? 0), stamp };
      follow.set(squadId, f);
    }
    while (f.idx + 1 < corr.length) {
      const w = corr[f.idx]!;
      if (Math.hypot(w.x - px, w.z - pz) <= WAYPOINT_R) f.idx++;
      else break;
    }
    if (follow.size > 4096) follow.clear();   // 防漏（同旧口径）
    const w = corr[Math.min(f.idx, corr.length - 1)]!;
    const gdx = w.x - px, gdz = w.z - pz;
    const gd = Math.hypot(gdx, gdz);
    if (gd > STOP_R) {
      pool.homeX[i] = w.x; pool.homeZ[i] = w.z;
      pool.curSpeed[i] = pool.speed[i];
      pool.dirX[i] = gdx / gd;
      pool.dirZ[i] = gdz / gd;
      return true;
    }
    return false;
  }
  const ox = pool.orderTargetX[i], oz = pool.orderTargetZ[i];
  const gdx = ox - px, gdz = oz - pz;
  const gd = Math.hypot(gdx, gdz);
  if (gd > SWARM.L2_EXEC_ARRIVE_R) {
    pool.homeX[i] = ox; pool.homeZ[i] = oz;
    pool.curSpeed[i] = pool.speed[i];
    pool.dirX[i] = gdx / gd;
    pool.dirZ[i] = gdz / gd;
    return true;
  }
  return false;   // 到点停
}
