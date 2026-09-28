// ============================================================
// swarm/tiers/L2 —— L2 档：队长 + 代理（只在地图数据上走；用户定 2026-09-27）
// ============================================================
// 归属（《移动执行重写.md》§7.5）：
//   · 拥有：队长 + 代理（沿用 SoA 存储，但**行为只在本模块**）；执行队令。
//   · 移动口径（用户定 2026-09-27）：**L2/L1 只走长寻路**——跟随队长核 ensurePath 产出的
//     可行性表**长走廊**路点（绕水/绕崖不直撞）；走廊走完/无走廊才退回指令直行。
//   · 不做：段进-巡逻/停滞救援（**兜底唯一归属 = L3**）；掩体/攻击槽（L3 的事）。
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
  pool: AgentPool, i: number, px: number, pz: number, now: number,
  squadId: number, st: SquadOrderState | null,
): boolean {
  // ★ 长寻路（用户定 2026-09-27：L2/L1 只走长寻路）：队长核 ensurePath 的长走廊
  const corr = st?.corridor;
  if (corr && corr.length > 1) {
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
      pool.homeX[i] = w.x; pool.homeZ[i] = w.z;   // 家随路点（走完围绕终点驻守）
      pool.curSpeed[i] = pool.speed[i] * (pool.directiveSpeedMul[i] > 0 ? pool.directiveSpeedMul[i] : 1);
      pool.dirX[i] = gdx / gd;
      pool.dirZ[i] = gdz / gd;
      return true;
    }
    return false;   // 走廊走完 → 交回游走/下一条令
  }

  // 无走廊 → 原口径：活跃指令 + 距目标 > 到位半径 → 直行（短程/紧急用）
  if (pool.directiveKind[i] === 0) return false;
  if (pool.directiveUntil[i] !== 0 && now >= pool.directiveUntil[i]) return false;
  const dtx = pool.directiveTargetX[i], dtz = pool.directiveTargetZ[i];
  const gdx = dtx - px, gdz = dtz - pz;
  const gd = Math.hypot(gdx, gdz);
  if (gd <= SWARM.L2_EXEC_ARRIVE_R) return false;
  pool.homeX[i] = dtx; pool.homeZ[i] = dtz;
  pool.curSpeed[i] = pool.speed[i] * (pool.directiveSpeedMul[i] > 0 ? pool.directiveSpeedMul[i] : 1);
  pool.dirX[i] = gdx / gd;
  pool.dirZ[i] = gdz / gd;
  return true;
}
