// ============================================================
// data/CombatTargets —— 战斗编制计算（从 SwarmData 抽出；用户定 2026-09-26）
// ============================================================
// 供四管理器的创建接口消费（只读）：
//   · aliveInSector：物理扇区角归档的本兵种现役人数（免疫部署延迟）
//   · fillTargetOf：该区最缺编小队的**队长位置+缺口**（新兵并入 → 队长指挥）
//   · combatUnitTarget：占比（RosterController.combatShare）× 每区编制 + 缺口偏置
// 纪律：不依赖 SwarmData 内部（deps 注入）；不写任何表。
// ============================================================

import { squadTypeOf } from '../../../entity/SwarmUnit';
import { combatShare } from '../RosterController';
import type { MobRole } from '../engine/contracts';

export interface CombatDeps {
  squads: {
    all(): IterableIterator<{
      id: number; type: string; builders: boolean; leaderUid: number;
      members: Map<number, { x: number; z: number }>;
    }>;
  };
  /** 大队部署计划（-1 = 未部署） */
  sectorOf(id: number): number;
  shipX(): number;
  shipZ(): number;
}

const TAU = Math.PI * 2;
const SECTORS = 8;
const SQUAD_FULL = 12;
const BUILDER_FULL = 3;
/** 每防区编制基数（人数） */
const PER_SECTOR_UNITS = 12;

/** 物理扇区角归档（以舰为心） */
function sectorOfPoint(d: CombatDeps, x: number, z: number): number {
  let ang = Math.atan2(z - d.shipZ(), x - d.shipX());
  if (ang < 0) ang += TAU;
  return Math.floor((ang / TAU) * SECTORS) % SECTORS;
}

/** 该防区本兵种现役人数（未部署队按物理扇区角归档） */
export function aliveRoleInSector(d: CombatDeps, role: string, sec: number): number {
  const t = squadTypeOf(role as Parameters<typeof squadTypeOf>[0]);
  let n = 0;
  for (const s of d.squads.all()) {
    if (s.members.size <= 0 || s.type !== t) continue;
    if (s.builders !== (role === 'engineer')) continue;
    let sq = d.sectorOf(s.id);
    if (sq < 0) {
      const lead = s.members.get(s.leaderUid);
      if (!lead) continue;
      sq = sectorOfPoint(d, lead.x, lead.z);
    }
    if (sq === sec) n += s.members.size;
  }
  return n;
}

/** 该防区最缺编的本兵种小队 → 队长位置 + 缺口（新兵在队长身旁投放 → 并入该队） */
export function fillTargetOf(d: CombatDeps, role: string, sec: number): { x: number; z: number; gap: number } | null {
  const t = squadTypeOf(role as Parameters<typeof squadTypeOf>[0]);
  const FULL = role === 'engineer' ? BUILDER_FULL : SQUAD_FULL;
  let best: { x: number; z: number; gap: number } | null = null;
  for (const s of d.squads.all()) {
    if (s.members.size <= 0 || s.members.size >= FULL || s.type !== t) continue;
    if (s.builders !== (role === 'engineer')) continue;
    const lead = s.members.get(s.leaderUid);
    if (!lead) continue;
    let sq = d.sectorOf(s.id);
    if (sq < 0) sq = sectorOfPoint(d, lead.x, lead.z);
    if (sq !== sec) continue;
    const gap = FULL - s.members.size;
    if (!best || gap > best.gap) best = { x: lead.x, z: lead.z, gap };
  }
  return best;
}

/** 每防区目标人头：占比 × 基数；roster 缺口 → 临时 +2 偏置；**总攻 → 满编上限 12** */
export function combatUnitTarget(rosterGap: string, role: MobRole | string, assault = false): number {
  if (role !== 'melee' && role !== 'ranged' && role !== 'flyer') return 0;
  if (assault) return SQUAD_FULL;
  let n = Math.max(1, Math.round(combatShare(role) * PER_SECTOR_UNITS));
  if ((rosterGap === 'shield' || rosterGap === 'assault') && role === 'melee') n += 2;
  else if (rosterGap === 'ranged' && role === 'ranged') n += 2;
  return n;
}
