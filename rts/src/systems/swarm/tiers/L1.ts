// ============================================================
// swarm/tiers/L1 —— L1 档：队长单点 + 预留阵型槽位（用户定 2026-09-27）
// ============================================================
// 归属（《移动执行重写.md》§7.4/§7.5）：
//   · 拥有：每队**一个队长逻辑点**（地图数据）+ 成员**名册**（计数+血+槽位）；
//     移动只过 `PassTable` 格级可行性（1~2Hz 路点），不建代理/实体。
//   · 不做：追击/开火/兜底（兜底唯一归属 = L3）；成员物化由 Flux（L1→L2）负责。
// 本文件目前提供名册/槽位工具（P-L1 接线移动与生成）。
// ============================================================

import type { TierCarry, TierCarryMember } from './contracts';

/** 预留槽位 rank 列表（rank 0 = 队长；物化数量依据） */
export function reserveSlotRanks(alive: number): number[] {
  const n = Math.max(1, Math.floor(alive));
  const out: number[] = [];
  for (let r = 0; r < n; r++) out.push(r);
  return out;
}

/** 新 L1 队名册：同兵种满血（hp/maxHp 由接线层按兵种给）；uid=0 = 未分配（物化时分配） */
export function rosterFresh(alive: number, hp: number, maxHp: number): TierCarryMember[] {
  return reserveSlotRanks(alive).map((slotRank) => ({ uid: 0, hp, maxHp, slotRank }));
}

/** L1 队长点移动端口（P-L1 实现；只过 PassTable 格级可行性，不走走廊/掩体） */
export interface L1MovePort {
  /** 单步可行推进：返回新位置（不可行 → 原地） */
  stepFeasible(c: TierCarry, tx: number, tz: number, dt: number): { x: number; z: number };
}
