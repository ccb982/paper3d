// ============================================================
// swarm/tiers/Flux —— 档间交接编排（用户定 2026-09-27）：L3↔L2↔L1 唯一转换口
// ============================================================
// 设计（《移动执行重写.md》§7.5）：
//   · Flux 只做**编排**（谁进谁出、按名册/槽位对齐），搬运的原子能力由接线层（main）注入；
//   · 交接只认 `TierCarry`（队长=完整快照、成员=名册）；核（SquadCore）按队 id 持久；
//   · 幂等：已在目标档的成员不重复搬运；任一步失败 → 返回 false（调用方保持原档，不半途丢人）。
// 实现分期：L3↔L2 现在可由 main 注入真实现（WorldSpawner.demote/promoteAgent 同源）；
//   collapse/expand（L2↔L1）在 P-L1 注入。未注入 = 不做任何转换（安全默认）。
// ============================================================

import type { AgentSnapshot } from '../AgentPool';
import { SWARM } from '../SwarmConfig';
import { spawnFromMember } from './carry';
import type { TierCarry, TierCarryMember, TierHandover, TierId, TierSpawnData } from './contracts';

/** 搬运原子口（main 注入；只搬载体，不做决策） */
export interface TierFluxPorts {
  /** 池：是否有该 uid（幂等检查） */
  hasInPool(uid: number): boolean;
  /** 池：取走（返回快照；无 = 不在池） */
  takeFromPool(uid: number): AgentSnapshot | null;
  /** 池：物化并**挂回既有队**（data.squadId/formSlot 决定归属） */
  putToPool(data: TierSpawnData | AgentSnapshot): boolean;
  /** L3：是否有该 uid 实体（幂等检查） */
  hasEntity(uid: number): boolean;
  /** L3：按 uid 取快照并退役实体（无 = 不是实体） */
  retireEntity(uid: number): AgentSnapshot | null;
  /** L3：按快照创建实体；返回 uid（0 = 失败） */
  spawnEntity(data: TierSpawnData | AgentSnapshot): number;
}

export class Flux implements TierHandover {
  constructor(private readonly ports: TierFluxPorts) {}

  /** L3→L2：实体逐个回收成代理（已在池的跳过；失败不半途） */
  demoteToL2(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0 || this.ports.hasInPool(m.uid)) continue;
      const snap = this.ports.retireEntity(m.uid);
      if (!snap || !this.ports.putToPool(snap)) { ok = false; break; }
    }
    return ok;
  }

  /** L2→L3：代理逐个升格成实体（已是实体的跳过；失败不半途） */
  promoteToL3(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0 || this.ports.hasEntity(m.uid)) continue;
      const snap = this.ports.takeFromPool(m.uid);
      if (!snap || this.ports.spawnEntity(snap) <= 0) { ok = false; break; }
    }
    return ok;
  }

  /** L2→L1：收缩为队长单点——名册先按载体实况回填（血），再逐个卸载体 */
  collapseToL1(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      const snap = this.ports.takeFromPool(m.uid) ?? this.ports.retireEntity(m.uid);
      if (!snap) { ok = false; break; }
      m.hp = snap.hp;
      m.maxHp = snap.maxHp;
    }
    return ok;
  }

  /** L1→L2：按预留槽位物化成员（已在池/实体的跳过；队长项也不重复物化） */
  expandFromL1(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid > 0 && (this.ports.hasInPool(m.uid) || this.ports.hasEntity(m.uid))) continue;
      if (!this.ports.putToPool(spawnFromMember(c, m))) { ok = false; break; }
    }
    return ok;
  }

  /** 名册回填：从当前载体取血（收缩/降档前调用，零丢失） */
  syncRoster(c: TierCarry, pick: (uid: number) => AgentSnapshot | null): TierCarryMember[] {
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      const snap = pick(m.uid);
      if (snap) { m.hp = snap.hp; m.maxHp = snap.maxHp; }
    }
    return c.members;
  }
}

/** 创建分档（用户定 2026-09-27）：按到焦点（舰/玩家取近）距离自动选档——创建与转换同门。
 *  阈值单源 = `SWARM.L3_RADIUS`（近）/ `SWARM.L2_RADIUS`（远）；超出 = L1（队长单点+名册）。 */
export function tierForDistance(d: number): TierId {
  if (d <= SWARM.L3_RADIUS) return 'L3';
  if (d <= SWARM.L2_RADIUS) return 'L2';
  return 'L1';
}

/** 创建入口（唯一自动转换口）：按距离选档并落地——
 *  L3：升格实体；L2：物化代理（含队长）；L1：只登记携带（队长单点+名册，无需物化）。
 *  未注入实现 → 返回 null（不落地，安全默认）。返回实际落地档 / null = 失败。 */
export function createAt(carry: TierCarry, distance: number): TierId | null {
  const tier = tierForDistance(distance);
  if (!impl) return null;
  if (tier === 'L3') return impl.promoteToL3(carry) ? 'L3' : null;
  if (tier === 'L2') return impl.expandFromL1(carry) ? 'L2' : null;
  return 'L1';
}

let impl: TierHandover | null = null;

/** 接线层注入（main）；传 null = 关闭档间转换（安全默认：不动） */
export function setTierHandover(h: TierHandover | null): void {
  impl = h;
}

export function tierHandover(): TierHandover | null {
  return impl;
}

/** L3→L2：实体降格成代理（成功 = 已是 L2） */
export function demoteToL2(c: TierCarry): boolean {
  return impl?.demoteToL2(c) ?? false;
}

/** L2→L3：代理升格成实体（成功 = 已是 L3） */
export function promoteToL3(c: TierCarry): boolean {
  return impl?.promoteToL3(c) ?? false;
}

/** L2→L1：收缩为队长单点（成员转名册） */
export function collapseToL1(c: TierCarry): boolean {
  return impl?.collapseToL1(c) ?? false;
}

/** L1→L2：按预留槽位物化成员代理 */
export function expandFromL1(c: TierCarry): boolean {
  return impl?.expandFromL1(c) ?? false;
}
