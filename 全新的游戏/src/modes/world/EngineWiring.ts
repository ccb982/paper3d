// ============================================================
// modes/world/EngineWiring —— 新蜂群引擎装配（本体侧；《移植清单》P2）
// ============================================================
// 把 rts 验证过的"引擎 + 队长核 + 战术侧"接进本体 WorldMode：
//   LiveView（引擎只读输入） → EngineBridge（唯一指挥链）→ SquadRegistry（队长核）
//   ＋ swarm 源注入（live order / fire gate / squad state / gone / tier 交接）
//   ＋ tactics（SectorBuilder/BattalionManager，0.5s 摊销）
// 不包含：调试覆盖层 / 命令面板（按用户口径不移植）。
// ============================================================

import type * as THREE from 'three';
import type { EntityManager } from '../../entity/EntityManager';
import type { EnemyBase } from '../../entity/EnemyBase';
import type { RasterMap } from '../../services/map/RasterMap';
import type { ChunkManager } from '../../services/map/ChunkManager';
import type { MobDef, WorldSpawner } from '../../systems/spawn/WorldSpawner';
import type { SwarmSystem } from '../../systems/swarm/SwarmSystem';
import { AUTONOMY, SWARM } from '../../systems/swarm/SwarmConfig';
import { simNow } from '../../services/SimClock';
import { AGENT_TARGET_SHIP } from '../../systems/swarm/AgentPool';
import { EngineBridge, type LiveSquad } from '../../systems/swarm/engine/EngineBridge';
import { SquadRegistry } from '../../systems/swarm/squad/SquadRegistry';
import { setLiveOrderSource, currentTargetOf } from '../../systems/swarm/squad/Anchor';
import { setTierHandover, Flux } from '../../systems/swarm/tiers/Flux';
import { SectorBuilder } from '../../systems/swarm/tactics/SectorBuilder';
import { BattalionManager } from '../../systems/swarm/tactics/BattalionManager';

export interface EngineWiringHost {
  swarm: SwarmSystem;
  spawner: WorldSpawner;
  raster: RasterMap;
  scene: THREE.Scene;
  entities: EntityManager;
  chunks: ChunkManager | null;
  enemies: () => EnemyBase[];
  mobDefs: () => MobDef[];
  player(): { x: number; z: number };
  ship(): { x: number; z: number };
  surfaceAt(x: number, z: number): number;
  /** 主攻随机种子（可复现） */
  seed?: number;
}

export interface EngineWiring {
  bridge: EngineBridge;
  tick(dt: number): void;
  dispose(): void;
}

/** 巡逻位移记录（判官豁免用）：近 30s 位移最大差值 >4m = 真在巡 */
function makePatrolMoved(): (uid: number, x: number, z: number, now: number) => boolean {
  const track = new Map<number, { t: number[]; x: number[]; z: number[] }>();
  return (uid, x, z, now) => {
    let tr = track.get(uid);
    if (!tr) { tr = { t: [], x: [], z: [] }; track.set(uid, tr); }
    tr.t.push(now); tr.x.push(x); tr.z.push(z);
    while (tr.t.length > 0 && now - (tr.t[0] as number) > 30) { tr.t.shift(); tr.x.shift(); tr.z.shift(); }
    if (track.size > 1024) track.clear();
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (let i = 0; i < tr.x.length; i++) {
      const vx = tr.x[i] as number, vz = tr.z[i] as number;
      if (vx < mnX) mnX = vx; if (vx > mxX) mxX = vx;
      if (vz < mnZ) mnZ = vz; if (vz > mxZ) mxZ = vz;
    }
    return Math.max(mxX - mnX, mxZ - mnZ) > 4;
  };
}

export function installEngineWiring(host: EngineWiringHost): EngineWiring {
  const { swarm, spawner, raster } = host;
  let nowS = 0;
  const patrolMoved = makePatrolMoved();

  // ---------- 队长核（唯一执行层） ----------
  const roleOf = (id: number): 'engineer' | 'flyer' | 'ranged' | 'melee' => {
    const sq = swarm.squads.get(id);
    const def = sq ? host.mobDefs()[sq.mobKind] as { role?: string; isAir?: boolean } | undefined : undefined;
    return sq?.builders ? 'engineer' : def?.isAir ? 'flyer' : def?.role === 'ranged' ? 'ranged' : 'melee';
  };
  let bridge: EngineBridge | null = null;
  setLiveOrderSource((id: number) => {
    const cur = bridge?.writer.store.get(id);
    return cur
      ? { kind: cur.order.kind, target: cur.order.target, anchor: cur.order.anchor, threat: cur.order.threat }
      : null;
  });
  swarm.setFireGate((uid: number) => bridge?.timers.canFire(uid) ?? true);
  const cores = new SquadRegistry(
    roleOf,
    (r, now) => bridge?.squads.report(r, now),
    (id: number) => {
      const sq = swarm.squads.get(id);
      return sq ? Math.max(0, sq.members.size - sq.casualties) : 0;
    },
    {
      squadOf: (id: number) => swarm.squads.get(id) ?? null,
      ensurePath: (state, squad, now) => swarm.ensurePathFor(state, squad, now),
      patrolNext: (id, x, z, _ax, _az, r, leg) => {
        const sq = swarm.squads.get(id);
        let air = false;
        if (sq) {
          const p = swarm.pool;
          for (let i = 0; i < p.count; i++) if (p.swarmUid[i] === sq.leaderUid) { air = p.isAir[i] === 1; break; }
          if (!air) for (const e of host.enemies()) if (e.swarmUid === sq.leaderUid) { air = e.isAir; break; }
        }
        const ring = swarm.data.ring;
        let ox = x - ring.cx, oz = z - ring.cz;
        const od = Math.hypot(ox, oz);
        if (od < 1e-3) { ox = 1; oz = 0; } else { ox /= od; oz /= od; }
        const tx2 = -oz, tz2 = ox;
        const R = Math.max(24, r);
        const drift = R * 0.25;
        const s0 = leg >= 0 ? 1 : -1;
        const cands: [number, number][] = [];
        for (const rr of [R, R * 0.6, R * 0.3]) {
          cands.push([x + tx2 * s0 * rr + ox * drift, z + tz2 * s0 * rr + oz * drift]);
          cands.push([x - tx2 * s0 * rr + ox * drift, z - tz2 * s0 * rr + oz * drift]);
        }
        cands.push([x + ox * drift, z + oz * drift]);
        for (const [gx, gz] of cands) {
          if (air) return swarm.data.clampToRing(gx, gz);
          if (swarm.reachFrom(id, gx, gz)) return { x: gx, z: gz };
        }
        return null;
      },
      leaderTarget: (state, _squad, lx, lz) => currentTargetOf(state, lx, lz),
      shipPoint: () => host.ship(),
      playerPoint: () => host.player(),
      coversNear: (x, z, r) => {
        const out: { x: number; z: number }[] = [];
        for (const c of swarm.data.fortify.builtList()) {
          if (c.kind === 'cover' && Math.hypot(c.x - x, c.z - z) <= r) out.push({ x: c.x, z: c.z });
        }
        return out;
      },
      protectNext: (x, z, ax, az, r, leg) => swarm.patrolNext(x, z, ax, az, r, leg),
      coverFrom: (tx, tz, x, z) => swarm.data.debugHasCover(tx, tz, x, z),
      clampRing: (x, z) => swarm.data.clampToRing(x, z),
      fireAllowed: (uid) => bridge?.timers.canFire(uid) ?? true,
      applyDirective: (uid, order, dir, until, ax, az) => swarm.applyDirectivePort(uid, order, dir, until, ax, az),
      mobTactics: (mi) => host.mobDefs()[mi]?.tactics ?? null,
    },
  );
  swarm.setSquadStateSource((id: number) => cores.stateOf(id) ?? null);
  swarm.setSquadGone((id: number) => {
    cores.drop(id);
    bridge?.writer.release(id);
    bridge?.squads.remove(id);
  });
  setTierHandover(new Flux({
    hasEntity: (uid) => (spawner.entityByUid(uid) ?? null) !== null,
    hideEntity: (uid) => spawner.hideByUid(uid),
    showEntity: (uid) => spawner.showByUid(uid),
    stashEntity: (uid) => spawner.stashByUid(uid),
    unstashEntity: (uid) => spawner.unstashByUid(uid),
    hasInPool: (uid) => { const pl = swarm.pool; for (let i = 0; i < pl.count; i++) if (pl.swarmUid[i] === uid) return true; return false; },
    takeFromPool: (uid) => swarm.takeAgent(uid),
    putToPool: (data) => swarm.spawn(data as never, false) >= 0,
  }));

  // ---------- LiveView → EngineBridge ----------
  bridge = new EngineBridge({
    player: () => host.player(),
    ship: () => host.ship(),
    squads: () => {
      const out: LiveSquad[] = [];
      for (const sq of swarm.squads.all()) {
        const def = host.mobDefs()[sq.mobKind] as { role?: string; isAir?: boolean } | undefined;
        const role = sq.builders ? 'engineer' : def?.isAir ? 'flyer' : def?.role === 'ranged' ? 'ranged' : 'melee';
        const lead = sq.members.get(sq.leaderUid);
        let lx = 0, lz = 0;
        if (lead) { lx = lead.x; lz = lead.z; }
        else { const c = { x: 0, z: 0 }; swarm.squads.centroidOf(sq.id, c); lx = c.x; lz = c.z; }
        let sh = 0, sm = 0;
        for (const m of sq.members.values()) { sh += m.hp; sm += m.maxHp; }
        const cv = cores.viewOf(sq.id);
        out.push({
          id: sq.id, leaderUid: sq.leaderUid, role, x: lx, z: lz,
          alive: Math.max(0, sq.members.size - sq.casualties), full: sq.members.size,
          hpRatio: sm > 0 ? sh / sm : 1,
          phase: cv?.phase, atom: cv?.atom, progress: cv?.progress, stillS: cv?.stillS,
        });
      }
      return out;
    },
    enemies: () => {
      const out: { uid: number; x: number; z: number }[] = [];
      for (const e of host.enemies()) out.push({ uid: e.swarmUid, x: e.position.x, z: e.position.z });
      const pool = swarm.pool;
      for (let i = 0; i < pool.count; i++) out.push({ uid: pool.swarmUid[i], x: pool.x[i], z: pool.z[i] });
      return out;
    },
    attackables: () => {
      const eng = new Set<number>();
      for (const sq of swarm.squads.all()) if (sq.builders) for (const uid of sq.members.keys()) eng.add(uid);
      const out: { uid: number; x: number; z: number; range?: number }[] = [];
      const rCache = new Map<number, number>();
      const rangeOf = (mi: number): number => {
        let r = rCache.get(mi);
        if (r === undefined) { const def = host.mobDefs()[mi]; r = def ? spawner.mobAgentStats(def).range : 25; rCache.set(mi, r); }
        return r;
      };
      for (const e of host.enemies()) {
        if (e.dead || e.hp <= 0 || e.lifeState !== 'active') continue;
        if (eng.has(e.swarmUid)) continue;
        const sq = swarm.squads.squadOf(e.swarmUid);
        const mi = sq?.mobKind ?? -1;
        const ranged = mi >= 0 && host.mobDefs()[mi]?.role === 'ranged';
        out.push({ uid: e.swarmUid, x: e.position.x, z: e.position.z, range: ranged ? rangeOf(mi) : undefined });
      }
      const pool = swarm.pool;
      for (let i = 0; i < pool.count; i++) {
        if (eng.has(pool.swarmUid[i])) continue;
        out.push({ uid: pool.swarmUid[i], x: pool.x[i], z: pool.z[i], range: pool.ranged[i] === 1 ? pool.meleeRange[i] : undefined });
      }
      return out;
    },
    engineer: () => swarm.data.engineerPort(),
    creation: () => swarm.data.combatCreationPort(),
    posture: () => swarm.data.postureP,
    assault: () => swarm.data.battlePosture === 'assault',
    underAttack: (id: number) => {
      const t = swarm.recentHits.get(id);
      return t !== undefined && nowS - t <= AUTONOMY.SQUAD_ALERT_S;
    },
    clampRing: (x, z) => swarm.data.clampToRing(x, z),
    sectorLock: (id, x, z) => swarm.data.sectorLockTarget(id, x, z),
    flyerSpot: (id, x, z) => swarm.data.flyerSupportPoint(id, x, z),
    blockedAt: (x, z) => raster.tileDefAt(x, z).genRole === 'pit',
    canReach: (id, x, z) => swarm.reachFrom(id, x, z),
    coversNear: (x, z, r) => {
      const out: { x: number; z: number }[] = [];
      for (const c of swarm.data.fortify.builtList()) if (c.kind === 'cover' && Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
      return out;
    },
    garrisonSpot: (id, x, z) => swarm.data.rangedGarrison(id, x, z),
    stuckR: (uid: number) => {
      const sq = swarm.squads.squadOf(uid);
      if (!sq) return undefined;
      const ost = bridge?.writer.store.get(sq.id)?.order;
      if (ost?.state === 'protect') {
        const m = sq.members.get(sq.leaderUid);
        if (m && Math.hypot(m.x - ost.target.x, m.z - ost.target.z) <= 14) return 1.5;
      }
      return undefined;
    },
    agents: () => {
      const p = swarm.pool; const out: { uid: number; x: number; z: number }[] = [];
      for (let i = 0; i < p.count; i++) out.push({ uid: p.swarmUid[i], x: p.x[i], z: p.z[i] });
      return out;
    },
    t01: () => swarm.data.lastT01,
    ledgerTotal: () => swarm.ledger.total,
    setReleaseCap: (cap: number) => { swarm.ledger.releaseCap = cap; },
    exemptOf: (uid: number) => {
      const sq = swarm.squads.squadOf(uid);
      if (!sq) return null;
      if (swarm.orderKindOf(sq.id) === 'garrison') return 'garrison';
      {
        const ost = bridge?.writer.store.get(sq.id)?.order;
        if (ost?.mission === 'patrol') {
          const m = sq.members.get(uid);
          if (m && patrolMoved(uid, m.x, m.z, nowS)) return 'patrol';
        }
      }
      if (sq.type === 'ranged' && bridge?.hasFirePermit(uid) === true) return 'fire';
      const hitAt = swarm.recentHits.get(sq.id);
      if (hitAt !== undefined && nowS - hitAt <= AUTONOMY.SQUAD_ALERT_S) return 'hit';
      const p = swarm.pool;
      for (let i = 0; i < p.count; i++) {
        if (p.swarmUid[i] === uid && p.noDemoteUntil[i] > nowS) return 'combat';
      }
      return null;
    },
    retire: (uid: number, why: string) => {
      if (why === 'stuck') {
        const sq = swarm.squads.squadOf(uid);
        const def = sq ? host.mobDefs()[sq.mobKind] as { elite?: boolean; squadMode?: string } | undefined : undefined;
        const special = !!def && (def.elite === true || def.squadMode === 'singleton');
        if (special) {
          const respawn = (x: number, y: number, z: number, mhp: number): boolean => {
            for (let k = 0; k < 6; k++) {
              const a2 = (k / 6) * Math.PI * 2;
              const r = k === 0 ? 0 : 2 + (k % 3) * 2;
              const qx = x + Math.cos(a2) * r, qz = z + Math.sin(a2) * r;
              const qy = raster.surfaceHeightAt(qx, qz);
              if (spawner.spawnSingle(def as never, qx, qy, qz, -1, false, mhp)) return true;
            }
            const c = swarm.data.clampToRing(x, z);
            if (Math.hypot(c.x - x, c.z - z) > 1 && spawner.spawnSingle(def as never, c.x, raster.surfaceHeightAt(c.x, c.z), c.z, -1, false, mhp)) return true;
            return spawner.spawnSingle(def as never, c.x, raster.surfaceHeightAt(c.x, c.z), c.z, -1, true, mhp);
          };
          for (const e of host.enemies()) {
            if (e.swarmUid !== uid) continue;
            const x = e.position.x, z = e.position.z, y = e.position.y;
            const mhp = (e as { maxHp?: number }).maxHp ?? 0;
            e.retire('recycled');
            respawn(x, y, z, mhp);
            return true;
          }
          const p = swarm.pool;
          for (let i = 0; i < p.count; i++) {
            if (p.swarmUid[i] !== uid) continue;
            const x = p.x[i], y = p.y[i], z = p.z[i], mhp = p.maxHp[i];
            swarm.recycleByUid(uid, why);
            respawn(x, y, z, mhp);
            return true;
          }
        }
      }
      for (const e of host.enemies()) {
        if (e.swarmUid !== uid) continue;
        e.retire(why === 'stuck' ? 'stuck' : 'despawned');
        return true;
      }
      spawner.dropStashByUid(uid);
      return swarm.recycleByUid(uid, why);
    },
    emit: (squadId, order, now) => { cores.accept(squadId, order, now); },
  });

  // ---------- 战术侧（扇区/大队；0.5s 摊销；只读计划，不发令） ----------
  const sectors = new SectorBuilder();
  const battalions = new BattalionManager();
  const mainSectors: number[] = [0];
  let acc = 0, roll = 0;
  const seed = host.seed ?? 4242;
  const tacticalTick = (): void => {
    const swd = swarm.data;
    const ship = host.ship();
    const shipY = raster.surfaceHeightAt(ship.x, ship.z);
    const band = swd.fortifyBand;
    sectors.buildOne(ship.x, ship.z, shipY, band.rLo, band.rHi,
      (x, z) => raster.surfaceHeightAt(x, z), (x, z) => swd.blockedAt(x, z));
    const recs: { id: number; role: 'engineer' | 'melee' | 'ranged' | 'flyer'; alive: number; x: number; z: number; atom?: string; phase?: string; progress?: number; stillS?: number }[] = [];
    for (const r of bridge!.squads.all()) recs.push({ id: r.id, role: r.role, alive: r.alive, x: r.x, z: r.z, atom: r.atom, phase: r.phase, progress: r.progress, stillS: r.stillS });
    battalions.refresh(recs);
    battalions.regroup();
    battalions.deploy(mainSectors, ship.x, ship.z);
    battalions.gaps(mainSectors);
    {
      const p01 = swarm.data.postureP;
      const k = p01 < 0.4 ? 1 : p01 < 0.75 ? 2 : 3;
      if (mainSectors.length !== k) {
        roll++;
        const sel = sectors.selectMain(k, (seed * 2654435761 + roll * 7919) >>> 0);
        if (sel.length > 0) mainSectors.length = 0, mainSectors.push(...sel);
        else if (mainSectors.length === 0) mainSectors.push(0);
      }
    }
    swarm.data.mainSectors = [...mainSectors];
    swarm.data.squadSectorOf = (id) => battalions.deployPlan.get(id) ?? -1;
    const anchorCache = new Map<number, { stamp: number; a: { x: number; z: number } | null }>();
    swarm.data.sectorAnchorOf = (sec) => {
      const stamp = swarm.data.pathStamp;
      const hit = anchorCache.get(sec);
      if (hit && hit.stamp === stamp) return hit.a;
      const pts = sectors.sectors[sec]?.points;
      if (!pts || pts.length === 0) { anchorCache.set(sec, { stamp, a: null }); return null; }
      const near = [...pts].sort((a, b) => a.d - b.d).slice(0, 8);
      let bestReach: { x: number; z: number } | null = null;
      let bestReachD = Infinity;
      for (const p of near) {
        if (p.d < bestReachD && swarm.reachable(ship.x, ship.z, p.x, p.z)) { bestReachD = p.d; bestReach = { x: p.x, z: p.z }; }
      }
      const a = bestReach ?? { x: near[0]!.x, z: near[0]!.z };
      anchorCache.set(sec, { stamp, a });
      return a;
    };
  };

  // ★ 运行时诊断口（用户控制台：__wire.diag()）
  (globalThis as unknown as { __wire?: unknown }).__wire = {
    diag: () => ({
      plan: !!swarm.data.defensePlan,
      tableReady: swarm.data.passTable.ready,
      sectors: sectors.sectors.length,
      squads: [...bridge!.squads.all()].length,
      orders: bridge!.writer.recent(8).length,
      enemies: host.enemies().length,
      enemyPos: host.enemies().slice(0, 12).map((e) => [Math.round(e.position.x), Math.round(e.position.z)]),
      squadStates: [...bridge!.squads.all()].slice(0, 8).map((x) => `${x.id}:${x.phase ?? ''}`),
      units: host.enemies().slice(0, 6).map((e) => {
        const cs = cores.stateOf(e.squadId ?? -1);
        return `${e.swarmUid}@sq${e.squadId ?? '-'} act=${e.activation ?? '?'} car=${e.carrier ?? '?'} ctrl=${e.controlSource ?? '-'} mt=${e.moveTarget ? 'Y' : 'N'} st=${cs?.execState ?? '-'} tgt=${cs?.order?.target ? `${Math.round(cs.order.target.x)},${Math.round(cs.order.target.z)}` : '-'}`;
      }),
      phase: swarm.data.stage,
      p: +swarm.data.postureP.toFixed(2),
      t01: +swarm.data.lastT01.toFixed(2),
      sch: +swarm.data.postureSchedule.toFixed(2),
      prov: +swarm.data.postureProvocation.toFixed(2),
      postureNow: swarm.data.battlePosture,
      posture: swarm.data.battlePosture,
    }),
    swarm, bridge, cores,
  };
  let disposed = false;
  return {
    bridge,
    tick(dt: number): void {
      if (disposed) return;
      nowS = simNow();
      bridge!.tick(dt, nowS);
      cores.tick(dt, nowS, (id) => {
        const sq = swarm.squads.get(id);
        const lead = sq?.members.get(sq.leaderUid);
        return lead ? { x: lead.x, z: lead.z } : null;
      });
      acc += dt;
      if (acc >= 0.5) { acc = 0; tacticalTick(); }
      void SWARM; void AGENT_TARGET_SHIP;   // 保留引用（配置单源；供后续接线）
    },
    dispose(): void {
      disposed = true;
      setLiveOrderSource(null);
      swarm.setFireGate(() => true);
      swarm.setSquadStateSource(null);
      setTierHandover(null);
    },
  };
}
