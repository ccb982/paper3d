// ============================================================
// swarm/tiers/carry —— 交接数据换算（零丢失映射；L1/L2/L3 共用一份）
// ============================================================
// 口径：
//   · 前向/落位与队长核 `SquadCore.drive` 完全同一公式（forward=(sin,cos)；side=(-fz,fx)）；
//   · 名册项 → 池物化数据：统计字段继承队长快照（同 mobIndex/def），只覆盖身份/位置/血；
//   · 名册项 ← 载体：uid/hp/maxHp/slotRank。
// ============================================================

import type { AgentSnapshot } from '../AgentPool';
import { formationOffset } from '../squad/Formation';
import type { TierCarry, TierCarryMember, TierSpawnData } from './contracts';

/** 队长前向单位向量（yaw 同源：forward=(sin,cos)——与 L3 朝向/分离同口径） */
export function carryForward(c: TierCarry): { fx: number; fz: number } {
  const y = c.leader.yaw ?? 0;
  return { fx: Math.sin(y), fz: Math.cos(y) };
}

/** 槽位世界坐标（与 `SquadCore.drive` 落位公式同一份：forward*off.fx + side*off.fz）。
 *  rank 0 = 队长位（= 锚点本身，**不套阵型偏移**——与 drive 里队长直接走 ax/az 同口径）。 */
export function slotPosition(c: TierCarry, rank: number): { x: number; z: number } {
  if (rank <= 0) return { x: c.leader.x, z: c.leader.z };
  const f = carryForward(c);
  const off = formationOffset(c.squadType, rank);
  return {
    x: c.leader.x + f.fx * off.fx - f.fz * off.fz,
    z: c.leader.z + f.fz * off.fx + f.fx * off.fz,
  };
}

/** 名册项 → 池物化数据（统计字段继承队长快照；只覆盖身份/位置/血——零丢失） */
export function spawnFromMember(c: TierCarry, m: TierCarryMember): TierSpawnData {
  const p = m.slotRank === 0
    ? { x: c.leader.x, z: c.leader.z }
    : slotPosition(c, m.slotRank);
  // 队长快照里的载体私有字段（yaw 等）不带进池数据
  const { yaw: _yaw, ...base } = c.leader;
  void _yaw;
  return {
    ...base,
    uid: m.uid > 0 ? m.uid : undefined,
    x: p.x,
    z: p.z,
    hp: m.hp,
    maxHp: m.maxHp,
    formSlot: m.slotRank,
    isLeader: m.slotRank === 0,
    // 池出生必填项：快照可选项补默认（与降格/出生口径一致）
    aggro: base.aggro ?? 8,
    wanderSpeed: base.wanderSpeed ?? 2,
    tier: base.tier ?? 1,
  };
}

/** 快照 → 携带（调用方给队级信息与名册；队长项固定 rank 0） */
export function carryFrom(
  squadId: number, leader: AgentSnapshot, members: TierCarryMember[], role: TierCarry['role'], squadType: TierCarry['squadType'],
): TierCarry {
  return { squadId, role, squadType, mobIndex: leader.mobIndex, alive: members.length, leader, members };
}
