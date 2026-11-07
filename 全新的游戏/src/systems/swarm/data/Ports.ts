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
  /** ★★ 仅工事表标脏（造掩体用；不挖地形 → 不做深度场窗扫） */
  markBuiltOnly(x: number, z: number): void;
  readonly buildCover: ((x: number, z: number, variant: 'cover' | 'wall', face?: { x: number; z: number }) => void) | null;
  readonly digTrench: ((x: number, z: number) => void) | null;
  /** ★★ 批量挖战壕端口（2026-11-08；缺省 = 逐点 dig，语义相同只是慢） */
  readonly digTrenchBatch: ((points: { x: number; z: number }[]) => void) | null;
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
    // ★ 单点挖掘：digTrench 内部已触发 onTerrainDig → noteTerrainDig（深度场窗扫 +
    //   采样失效 + 工事表分片重建）⇒ 此处**只补工事表扇区标脏**（极轻量），
    //   不再调 markDirty（那会把窗扫做两遍 —— 旧实现的浪费）。
    dig: (x, z) => {
      h.fortify.recordBuilt(x, z, 'trench');
      h.digTrench?.(x, z);
      const ship = h.ship();
      if (Number.isFinite(ship.x) && Number.isFinite(ship.z)) h.fortify.markDirty(x, z, ship.x, ship.z);
      else h.fortify.dirty.fill(true);
    },
    // ★★ 批量挖掘（2026-11-08）：一次 tick 的多遍挖掘合并成一批
    //   → 深度场窗扫（r+12 米窗口 ≈ 50×50 格 × 包络场求值）只做 1 次而非 N 次。
    //   ★ 语义等价：窗扫/落库/重建都幂等（挖完扫一次 == 逐遍扫）。
    //   ★★ 关键：**不再重复调 markDirty**——digTrenchBatch 内部的落地已触发
    //     onTerrainDig → noteTerrainDig（窗扫 + 采样失效 + 工事表标脏），
    //     再调 markDirty 会把窗扫做两遍（这是旧实现最大的浪费）。
    //     此处只补【工事表标脏】（fortify.markDirty：标扇区，极轻量）。
    digBatch: (points) => {
      if (points.length === 0) return;
      for (const p of points) h.fortify.recordBuilt(p.x, p.z, 'trench');
      if (h.digTrenchBatch) {
        h.digTrenchBatch(points);
      } else {
        for (const p of points) h.digTrench?.(p.x, p.z);
      }
      // ★ 工事表标脏（挖战壕改变了工事布局 → 相关扇区需重算评分）
      const ship = h.ship();
      if (Number.isFinite(ship.x) && Number.isFinite(ship.z)) {
        for (const p of points) h.fortify.markDirty(p.x, p.z, ship.x, ship.z);
      } else {
        h.fortify.dirty.fill(true);
      }
    },
    markDirty: (x, z, r) => h.markTerrainDirty(x, z, r),
    // ★★ 仅工事表标脏（造掩体用；不挖地形 → 不做深度场窗扫）
    markBuiltOnly: (x, z) => h.markBuiltOnly(x, z),
  };
}
