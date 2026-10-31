// ============================================================
// data/Ports —— 引擎端口工厂（工兵端口 / 创建端口）
// ============================================================
// 从 SwarmData 抽出（2026-09-30 架构收口）：端口是"数据面 → 引擎"的只读桥，
// 工厂只依赖 PortHost 接口（SwarmData 实现），不再把 God Object 撑大。
// ============================================================

import { RasterMap } from '../../../services/map/RasterMap';
import { sectorMid } from '../Sectors';
import { NEED_DONE } from '../FortifyPlanner';
import { SECTOR_COUNT } from '../Sectors';
import type { FortifyPlanner } from '../FortifyPlanner';
import type { TerrainSemantics } from '../TerrainSemantics';
import type { RosterController } from '../RosterController';
import type { BattlePosture } from '../Posture';
import type { SwarmSystem } from '../SwarmSystem';
import type { EngineerPort } from '../engine/EngineerManager';
import type { CreationPort } from '../engine/SquadCreation';
import { aliveRoleInSector as aliveRoleInSectorFn, fillTargetOf as fillTargetOfFn, combatUnitTarget as combatUnitTargetFn } from './CombatTargets';
import type { MobRole } from '../engine/contracts';

/** ★ 坑底硬阈值（低于此高度不可走 → 禁止再挖；与 EngineerManager 端口同口径） */
const FLOOR_MIN = -1.2;

/** 端口宿主（SwarmData 实现；只暴露端口真正需要的东西） */
export interface PortHost {
  readonly system: SwarmSystem;
  readonly fortify: FortifyPlanner;
  readonly semantics: TerrainSemantics;
  readonly roster: RosterController;
  mainSectors: number[];
  squadSectorOf: ((id: number) => number) | null;
  sectorAnchorOf: ((sec: number) => { x: number; z: number } | null) | null;
  battlePosture: BattlePosture;
  postureP: number;
  dayRaw(): number;
  band(): { rLo: number; rHi: number };
  outerRing(): number;
  ship(): { x: number; z: number };
  spawnRole(role: MobRole, x: number, z: number): boolean;
  spawnBuilderAt(x: number, z: number): boolean;
  onShipPlateau(x: number, z: number): boolean;
  fortifyNeed(x: number, z: number): number | null;
  markTerrainDirty(x: number, z: number, r: number): void;
  readonly buildCover: ((x: number, z: number, variant: 'cover' | 'wall', face?: { x: number; z: number }) => void) | null;
  readonly digTrench: ((x: number, z: number) => void) | null;
}

/** ★ 创建端口（四兵种管理器共用） */
export function makeCombatCreationPort(h: PortHost): CreationPort {
  const deps = {
    squads: h.system.squads,
    sectorOf: (id: number) => h.squadSectorOf?.(id) ?? -1,
    shipX: () => h.ship().x,
    shipZ: () => h.ship().z,
  };
  return {
    mainSectors: () => h.mainSectors,
    /** ★ §0.3：创建优先级次序（主攻在前，其余防区在后） */
    sectorOrder: () => {
      const m = h.mainSectors, rest: number[] = [];
      for (let i = 0; i < SECTOR_COUNT; i++) if (!m.includes(i)) rest.push(i);
      return [...m, ...rest];
    },
    /** ★ §0.3 溢出：防区满足后随机放置；★ 不变量（用户定 2026-09-30）：**所有敌人都必须在事态
     *  环带 [minD, maxD] 之内**——溢出点改带内随机（旧"环带外+无约束"作废）；工兵不在溢出名单 */
    overflowAnchor: () => {
      const a = Math.random() * Math.PI * 2;
      const b = h.band();
      const lo = Math.max(0, b.rLo + 4);
      const hi = Math.max(lo + 8, b.rHi - 4);
      const r = lo + Math.random() * (hi - lo);
      const s = h.ship();
      return { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r };
    },
    aliveInSector: (role, sec) => aliveRoleInSectorFn(deps, role, sec),
    unitTarget: (role) => combatUnitTargetFn(h.roster.dbg.gap, role, h.battlePosture === 'assault'),
    fillTarget: (role, sec) => fillTargetOfFn(deps, role, sec),
    posture: () => h.postureP,
    assault: () => h.battlePosture === 'assault',
    assaultAnchor: (sec) => {
      const mid = sectorMid(sec);
      const s = h.ship();
      return { x: s.x + Math.cos(mid) * 50, z: s.z + Math.sin(mid) * 50 };   // ★ 距舰 50m
    },
    anchorOf: (sec) => h.sectorAnchorOf?.(sec) ?? null,
    spawn: (role, x, z) => h.spawnRole(role, x, z),
  };
}

/** ★ 工兵端口（EngineerManager 消费；数据 = 分区/需求/环带/可达 + 施工落地） */
export function makeEngineerPort(h: PortHost): EngineerPort {
  const needAt = (x: number, z: number): number | null => (h.onShipPlateau(x, z) ? null : h.fortifyNeed(x, z));
  return {
    band: () => { const b = h.band(); return { rLo: b.rLo, rHi: b.rHi }; },
    ship: () => h.ship(),
    /** ★ D5 工兵战术：事实表读取口（山顶岗哨/缝道封口） */
    facts: () => h.semantics,
    needAt,
    // ★ 取件门=可行性表 BFS（用户定 2026-09-29：不用 LOS）
    canReach: (id, x, z) => h.system.reachFrom(id, x, z),
    assault: () => h.battlePosture === 'assault',
    noNewBuild: () => h.dayRaw() >= 0.45,
    aliveOfSquad: (id) => h.system.squads.get(id)?.members.size ?? 0,
    refreshSector: (cx, cz, rLo, rHi) => h.fortify.refreshOne(cx, cz, rLo, rHi, needAt),
    pickSpot: (sec, rLo, rHi, canReach, exclude, from) => {
      const s = h.ship();
      h.fortify.ensureFresh(sec, s.x, s.z, rLo, rHi, needAt, h.postureP);   // ★ 查询前保新
      return h.fortify.targetOf(s.x, s.z, sec, rLo, rHi, NEED_DONE, canReach, exclude, from);
    },
    canDig: (x, z) => {
      const raster = RasterMap.current;
      return !raster || raster.surfaceHeightAt(x, z) - 0.2 >= FLOOR_MIN;
    },
    coversNear: (x, z, r) => h.fortify.countNear(x, z, r),
    cover: (x, z, v, face) => { h.fortify.recordBuilt(x, z, 'cover'); h.buildCover?.(x, z, v, face); },
    requestSpawn: (role, x, z) => role === 'builder' && h.spawnBuilderAt(x, z),
    posture: () => h.postureP,
    mainSectors: () => h.mainSectors,
    sectorsScanned: () => h.fortify.scanned.every(Boolean),
    dig: (x, z) => { h.fortify.recordBuilt(x, z, 'trench'); h.digTrench?.(x, z); },
    markDirty: (x, z, r) => h.markTerrainDirty(x, z, r),
  };
}
