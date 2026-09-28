// ============================================================
// swarm/tiers/policy —— 公共分档口径（用户定 2026-09-27）
// ============================================================
// 口径：**同时检查 舰心 / 玩家 / 相机 三个参照，取半径内等级最大者**（最近参照胜出）。
//   · 任一参照 ≤ `L2_RADIUS` → **L2 起步**（舰心半径内最低 L2 地板同源）；
//   · 三者都超出 `L2_RADIUS` → L1（队长单点+预留名册）；
//   · **L3 不在此判定**：由升格路径（视锥/近距 + 上限/预算）负责。
// 生成（spawn 时刻）与逐帧重算（SwarmSystem）共用本函数 —— 单源。
// ============================================================

import { AGENT_TIER_FAR, AGENT_TIER_MID } from '../AgentPool';
import { SWARM } from '../SwarmConfig';

/** 参照点（舰心/玩家/相机；缺省项由调用方裁剪） */
export interface TierRef {
  x: number;
  z: number;
}

/** 分档：同时检查全部参照，取半径内等级最大（→ 最近参照决定；都不在 → L1） */
export function agentTierAt(x: number, z: number, refs: readonly (TierRef | null | undefined)[]): number {
  const r2 = SWARM.L2_RADIUS * SWARM.L2_RADIUS;
  for (const ref of refs) {
    if (!ref) continue;
    const dx = x - ref.x, dz = z - ref.z;
    if (dx * dx + dz * dz <= r2) return AGENT_TIER_MID;
  }
  return AGENT_TIER_FAR;
}
