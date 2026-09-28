// ============================================================
// swarm/tiers/Flux —— 档间交接编排（用户定 2026-09-27）：L3↔L2↔L1 唯一转换口
// ============================================================
// 最新语义（用户定 2026-09-27；《移动执行重写.md》§7.4「实体与档位解耦」）：
//   · 实体（纹理/血条等对象）**不销毁**：L3→L2 = **隐藏**；L2→L3 = **显示复用**；
//   · L1 = **收纳**：成员实体进对象仓（对象保留），离开 L1 **取出复用**（无才物化）；
//   · 交接只认 `TierCarry`（队长=完整快照、成员=名册）；核（SquadCore）按队 id 持久；
//   · 幂等：已在目标状态的成员不重复搬；任一步失败 → false（调用方保持原档，不半途丢人）。
// 搬运原子口由接线层（main）注入；未注入 = 不做任何转换（安全默认）。
// ============================================================

import { spawnFromMember } from './carry';
import type { TierCarry, TierCarryMember, TierHandover, TierSpawnData } from './contracts';

/** 搬运原子口（main 注入；只搬载体/可见性，不做决策） */
export interface TierFluxPorts {
  /** L3：是否有该 uid 实体（幂等检查） */
  hasEntity(uid: number): boolean;
  /** L3→L2：**隐藏**实体（停渲染，不销毁不搬池） */
  hideEntity(uid: number): boolean;
  /** L2→L3：**显示**实体（复用既有对象，不重建） */
  showEntity(uid: number): boolean;
  /** L1：**收纳**实体进对象仓（纹理/血条保留）；返回血量供名册回填 */
  stashEntity(uid: number): { hp: number; maxHp: number } | null;
  /** 离开 L1：**取出复用**（对象仓优先）；false = 仓里没有（调用方物化） */
  unstashEntity(uid: number): boolean;
  /** 池：是否有该 uid（幂等检查；旧 L2 代理路径兼容用） */
  hasInPool(uid: number): boolean;
  /** 池：取走（返回快照；无 = 不在池） */
  takeFromPool(uid: number): import('../AgentPool').AgentSnapshot | null;
  /** 池：物化并**挂回既有队**（data.squadId/formSlot 决定归属） */
  putToPool(data: TierSpawnData): boolean;
}

export class Flux implements TierHandover {
  constructor(private readonly ports: TierFluxPorts) {}

  /** L3→L2：实体逐个**隐藏**（不销毁；未物化的成员无事可做） */
  demoteToL2(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      if (this.ports.hasEntity(m.uid)) {
        if (!this.ports.hideEntity(m.uid)) { ok = false; break; }
      }
    }
    return ok;
  }

  /** L2→L3：实体逐个**显示复用**（未物化的成员无事可做） */
  promoteToL3(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      if (this.ports.hasEntity(m.uid)) {
        if (!this.ports.showEntity(m.uid)) { ok = false; break; }
      }
    }
    return ok;
  }

  /** L2→L1：**收纳**为队长单点——名册先按实况回填（血），实体进对象仓（对象保留） */
  collapseToL1(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      if (this.ports.hasEntity(m.uid)) {
        const v = this.ports.stashEntity(m.uid);
        if (!v) { ok = false; break; }
        m.hp = v.hp; m.maxHp = v.maxHp;
      } else if (this.ports.hasInPool(m.uid)) {
        const snap = this.ports.takeFromPool(m.uid);
        if (!snap) { ok = false; break; }
        m.hp = snap.hp; m.maxHp = snap.maxHp;
      }
      // 未物化的成员：名册里的血已是真源，无需回填
    }
    return ok;
  }

  /** L1→L2：**取出复用**优先（对象仓 → 既有实体 → 池），无才按预留槽物化 */
  expandFromL1(c: TierCarry): boolean {
    let ok = true;
    for (const m of c.members) {
      if (m.uid > 0 && this.ports.hasEntity(m.uid)) {
        if (!this.ports.showEntity(m.uid)) { ok = false; break; }
        continue;
      }
      if (m.uid > 0 && this.ports.hasInPool(m.uid)) continue;   // 旧池路径：已在 L2
      if (m.uid > 0 && this.ports.unstashEntity(m.uid)) continue; // ★ 对象仓取出复用（不重建）
      if (!this.ports.putToPool(spawnFromMember(c, m))) { ok = false; break; }
    }
    return ok;
  }

  /** 名册回填：从当前载体取血（降档/收缩前调用，零丢失） */
  syncRoster(c: TierCarry, pick: (uid: number) => import('../AgentPool').AgentSnapshot | null): TierCarryMember[] {
    for (const m of c.members) {
      if (m.uid <= 0) continue;
      const snap = pick(m.uid);
      if (snap) { m.hp = snap.hp; m.maxHp = snap.maxHp; }
    }
    return c.members;
  }
}

let impl: TierHandover | null = null;

/** 接线层注入（main）；传 null = 关闭档间转换（安全默认：不动） */
export function setTierHandover(h: TierHandover | null): void {
  impl = h;
}

export function tierHandover(): TierHandover | null {
  return impl;
}

/** 创建分档（用户定 2026-09-27）：按到焦点（舰/玩家取近）距离自动选档——创建与转换同门。
 *  阈值单源 = `SWARM.L3_RADIUS`（近）/ `SWARM.L2_RADIUS`（远）；超出 = L1（队长单点+名册）。 */
export function tierForDistance(d: number): 'L1' | 'L2' | 'L3' {
  if (d <= SWARM.L3_RADIUS) return 'L3';
  if (d <= SWARM.L2_RADIUS) return 'L2';
  return 'L1';
}

/** 创建入口（唯一自动转换口）：按距离选档并落地——
 *  L3：升格实体；L2：物化代理（含队长）；L1：只登记携带（队长单点+名册，无需物化）。
 *  未注入实现 → 返回 null（不落地，安全默认）。返回实际落地档 / null = 失败。 */
export function createAt(carry: TierCarry, distance: number): 'L1' | 'L2' | 'L3' | null {
  const tier = tierForDistance(distance);
  if (!impl) return null;
  if (tier === 'L3') return impl.promoteToL3(carry) ? 'L3' : null;
  if (tier === 'L2') return impl.expandFromL1(carry) ? 'L2' : null;
  return 'L1';
}

import { SWARM } from '../SwarmConfig';
