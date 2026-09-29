// ============================================================
// RTS 主入口：严格两阶段
//   A 选点：只读 RasterMap 数据 → SpawnSelect 小地图（不建 3D/不建 ChunkManager）
//   B 世界：确认出生点后才建 ChunkManager 并一次性加载（只建不删）
// URL：?seed=4242&x=&z=（带 x/z = 跳过选点直进，探针用）
// ============================================================
import * as THREE from 'three';
import { RasterMap } from './services/map/RasterMap';
import { ChunkManager } from './services/map/ChunkManager';
import type { ChunkGroundHost } from './services/map/decor/MapEntityDecorBase';
import { SunCycle } from './services/render/SunCycle';
import { updateTerrainLighting, updateWallMaterialsLighting } from './services/map/TerrainMaterial';
import { updateApronLighting } from './services/map/decor/PlatformApron';
import { SpawnSelect } from './ui/SpawnSelect';
import { SwarmSystem, SWARM } from './systems/swarm/SwarmSystem';
import { CoverLazy } from './modes/world/CoverLazy';   // ★ 工事懒更新（用户定 2026-09-27）
import { Flux, setTierHandover } from './systems/swarm/tiers/Flux';   // ★ P-Flux：档间交接唯一口（用户定 2026-09-27）
import { PhysicsWorld, ensureRapierReady } from './services/physics/PhysicsWorld';
import { EntityManager } from './entity/EntityManager';
import { addStaticObstacle, removeStaticObstacle } from './services/physics/StaticObstacleRegistry';
import { CHUNK_SIZE } from './services/map/ChunkGenerator';
import { ENEMY_ROSTER, enemyAssetUrl, type EnemyAssetEntry } from './config/enemyRoster';
import { FtxAsset } from './vendor/player/FtxAsset';
import { buildProceduralShip, SHIP_LENGTH } from './entity/ship/proceduralShip';
import { EnemyBase } from './entity/EnemyBase';
import { CLIMB_STATS, CLIMB_TRACE, canShift } from './entity/base/CharacterCore';
import { goneLog } from './systems/swarm/data/GoneLog';
import { climbBook } from './entity/base/ClimbBook';
import { SectorBuilder } from './systems/swarm/tactics/SectorBuilder';
import { BattalionManager } from './systems/swarm/tactics/BattalionManager';
import { CLIMB_ROUTE_STATS } from './systems/swarm/SquadNavigator';
import { ENEMY_BY_ID } from './config/enemyRoster';
import type { SwarmHooks } from './systems/swarm/SwarmSystem';
import { AGENT_TARGET_SHIP } from './systems/swarm/AgentPool';
import { aiSystem } from './systems/ai/AISystem';
import type { BehaviorContext } from './systems/ai/behaviors';
import { ExplosionFx } from './services/fx/ExplosionFx';
import { BulletManager } from './services/combat/BulletManager';
import { CombatSystem } from './systems/combat/CombatSystem';
import { executeAttack } from './services/combat/Attack';
import { createSolidBulletAsset, createArrowAsset, createFireballAsset } from './services/fx/SolidBulletAsset';
import { AGENT_SOURCE } from './systems/spawn/WorldSpawner';
import { scatterDir } from './services/combat/Scatter';
import { Asset, type HitEffectShapeExport } from './vendor/player';
import { CharacterFxManager } from './services/fx/CharacterFxManager';
import { WorldSpawner, type SpawnDeps, type MobDef } from './systems/spawn/WorldSpawner';
import { wireCommanderPorts } from './modes/world/CommanderWiring';
import { mountSectorZoneView } from './ui/SectorZoneView';
import { createRasterProbe } from './entity/base/RasterProbe';
import { SHORE_CLIMB_MAX } from './entity/TerrainAssist';
import { EDGE_CLIFF_BAND } from './services/map/Refinements';
import { separationPushes, type SepBody } from './systems/swarm/EntitySeparation';
import { buildEnemyCover } from './modes/world/EnemyCoverBuild';
import { footSinkRatioOf } from './services/fx/FootAnchor';
import { CharacterClamp } from './systems/world/CharacterClamp';
import { EnemyManager } from './ui/EnemyManager';
import { EnemyListPanel } from './ui/EnemyListPanel';
import { NavDebugMap } from './ui/NavDebugMap';
import { AiTrace } from './debug/AiTrace';
import { simNow, setSimNow } from './services/SimClock';
import { FastLane } from './rts/FastLane';
import { Timeline } from './ui/Timeline';
import { CopyInfoPanel } from './ui/CopyInfoPanel';
import { AUTONOMY } from './systems/swarm/SwarmConfig';
import { EngineBridge, type LiveSquad } from './systems/swarm/engine/EngineBridge';
import { squadViews, type SquadViewPort } from './systems/swarm/engine/SquadView';
import { SquadRegistry } from './systems/swarm/squad/SquadRegistry';
import { setLiveOrderSource, currentTargetOf } from './systems/swarm/squad/Anchor';
import { setSwarmDebugView } from './services/ui/SwarmDebugOverlay';
import { setSwarmTraceView } from './services/ui/SwarmTrace';
import { CommandPanel, type PanelSquad } from './ui/CommandPanel';
import type { SquadOrder, SquadReport } from './systems/swarm/engine/contracts';

const q = new URLSearchParams(location.search);
const SEED = Number(q.get('seed') ?? 4242);
const UX = q.get('x');
const UZ = q.get('z');
/** ★ 直控模式（?direct=1）：关引擎发令，只走玩家指令 */
const DIRECT = q.get('direct') === '1';
/** ★ 固定世界（±4 chunk ×60m = 480m 见方；地形一次性加载） */
const WORLD_R = 4 * 60 - 20;
const R = globalThis as unknown as Record<string, unknown>;

// ---- 阶段 A 起点：只建数据层（无 3D）----
let raster = new RasterMap(SEED);
R.__rts = { raster, phase: 'select' };

// ★★ 防区调试视图（用户定 2026-09-27）：**选点阶段就显示**、默认标准位、无 URL 参数；
//   单击面板 = 该点当虚拟舰位重算（同一 SectorBuilder 逻辑）；Z 开关；R 复位舰位；S 标准位。
//   预世界口径与生产一致：blockedAt = 坑（SwarmData 同式），带 [24,90] 与 [rLo=max(24,frontMinD+8), rHi=max(90,rLo+30)] 的初值一致。
const zoneShip = { x: -17, z: -267 };
// ★ 敌军兵力 HUD（用户定 2026-09-27 写清楚并绘制到 UI）：**在场 / 上限（随事态）/ 总配额**
const enemyStatsEl = document.createElement('div');
enemyStatsEl.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:10060;pointer-events:none;font:12px Consolas,monospace;color:#ffcf9a;text-shadow:0 1px 2px #000;text-align:center;white-space:nowrap';
enemyStatsEl.textContent = '敌军：—';
document.body.appendChild(enemyStatsEl);

mountSectorZoneView({
  surfaceAt: (x, z) => raster.surfaceHeightAt(x, z),
  tileAt: (x, z) => raster.tileDefAt(x, z),
  blockedAt: (x, z) => raster.tileDefAt(x, z).genRole === 'pit',
  ship: () => zoneShip,
  band: () => {
    const sw = (R.__rts as { swarm?: { data: { fortifyBand: { rLo: number; rHi: number } } } }).swarm;
    if (sw) { const b = sw.data.fortifyBand; return { rLo: b.rLo, rHi: b.rHi }; }
    return { rLo: 24, rHi: 90 };
  },
  mainSectors: () => ((R.__rts as { tactics?: { mainSectors: number[] } }).tactics?.mainSectors ?? []),
});

function startWorld(spawnX: number, spawnZ: number, mobAssets: EnemyAssetEntry[], hitEffects: HitEffectShapeExport[]): void {
  const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
  const spawn = { x: spawnX, z: spawnZ };
  zoneShip.x = spawnX; zoneShip.z = spawnZ;   // ★ 防区视图跟随出生点（未点选时）

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe3ee, 300, 1100);
  CharacterFxManager.init(scene, renderer);   // ★ L3 实体 FTX 渲染管理器（EnemyBase 等）
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 8000);

  const cam = { tx: spawn.x, tz: spawn.z, dist: 150, yaw: Math.PI * 0.25, pitch: 0.95 };
  const clampArea = (): void => {
    cam.tx = clamp(cam.tx, spawn.x - WORLD_R, spawn.x + WORLD_R);   // ★ 固定世界以**出生点**为圆心
    cam.tz = clamp(cam.tz, spawn.z - WORLD_R, spawn.z + WORLD_R);
  };
  const applyCam = (): void => {
    const ch = Math.cos(cam.pitch) * cam.dist;
    camera.position.set(cam.tx + Math.sin(cam.yaw) * ch, Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * ch);
    camera.lookAt(cam.tx, 0, cam.tz);
  };

  // ---- ★ 实体管线（完整移植）：rapier 物理 + EntityManager + 真实 ChunkGroundHost ----
  const physics = new PhysicsWorld();
  const entities = new EntityManager(physics, raster);
  const host: ChunkGroundHost = {
    createGround: (cx, cz, vertices, indices) => entities.create({
      kind: 'ground', x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
      physics: { type: 'fixed', options: { shape: { type: 'trimesh', vertices, indices } } },
    }).id,
    destroyGround: (id) => { removeStaticObstacle(id); entities.destroy(id); },
    createGroundCells: (cx, cz, cells) => {
      if (cells.length === 0) return null;
      const first = cells[0];
      const e = entities.create({
        kind: 'ground', x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
        physics: { type: 'fixed', options: { shape: { type: 'trimesh', vertices: first.vertices, indices: first.indices }, tileSlot: first.slot } },
      });
      const rb = e.rigidBody;
      if (rb) for (let i = 1; i < cells.length; i++) physics.setTileCollider(rb.handle, cells[i].slot, cells[i].vertices, cells[i].indices);
      return e.id;
    },
    updateGroundCell: (id, slot, vertices, indices) => {
      const rb = entities.get(id)?.rigidBody;
      if (rb) physics.setTileCollider(rb.handle, slot, vertices, indices);
    },
    setBodyEnabled: (id, enabled) => physics.setBodyEnabled(id, enabled),
    createPropBody: (x, y, z, r, h) => {
      const id = entities.create({
        kind: 'decoration', x, y, z,
        physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: r, hy: h / 2, hz: r } } },
      }).id;
      addStaticObstacle(id, x, y, z, r, h / 2);
      return id;
    },
  };  const chunks = new ChunkManager(scene, raster, host);
  chunks.setWorldCenter(spawn.x, spawn.z);   // ★ 生成区域中心 = 出生点
  chunks.setCoarseMode(false);   // ★ 探索期：近处细块 + 远景粗块 LOD（coarseOnly=false 才投细化）
  chunks.setWaterVisible(true);
  chunks.bootstrap(spawn.x, spawn.z);

  // ---- ★ 舰船（RTS：位置基准 + 第二目标；精细程序化模型 + 实体船体碰撞）----
  const shipY = raster.surfaceHeightAtFor(spawn.x, spawn.z, 0);
  const proc = buildProceduralShip();
  proc.group.position.set(spawn.x, shipY, spawn.z);
  scene.add(proc.group);
  // ★ 舰船位置常显标记：大蓝圈（+脉冲），任何时刻一眼可见
  const shipRingMat = new THREE.MeshBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const shipRing = new THREE.Mesh(new THREE.RingGeometry(7.0, 8.4, 48), shipRingMat);
  shipRing.rotation.x = -Math.PI / 2;
  shipRing.position.set(spawn.x, shipY + 0.12, spawn.z);
  shipRing.renderOrder = 21;
  const shipRing2 = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.0, 40), shipRingMat.clone());
  shipRing2.rotation.x = -Math.PI / 2;
  shipRing2.position.set(spawn.x, shipY + 0.12, spawn.z);
  shipRing2.renderOrder = 21;
  scene.add(shipRing, shipRing2);
  // ★ 舰船位置单源（用户定 2026-09-27）：**就用这个实体接口**（地图/小地图同源扫描 kind==='ship'）
  const shipEntity = entities.create({
    kind: 'ship', x: spawn.x, y: shipY + 0.8, z: spawn.z,
    physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: SHIP_LENGTH / 2, hy: 0.8, hz: 1.2 } } },
  });

  // ---- ★ 名册 → MobDef（buildBatch/刷怪器共用；必须在 buildBatch 之前）----
  const mobDefs: MobDef[] = mobAssets.map(({ id, asset }) => {
    const spec = ENEMY_BY_ID.get(id) ?? ENEMY_ROSTER[0]!;
    return {
      id: spec.id, name: spec.name, asset,
      ai: spec.ai, hp: spec.hp, defense: spec.defense, attackPower: spec.attackPower,
      scale: spec.scale, collisionScale: spec.collisionScale,
      pack: spec.pack, weight: spec.weight, drops: spec.drops,
      groundSink: footSinkRatioOf(asset) * spec.scale + (spec.groundSink ?? 0),
      isAir: spec.isAir === true,
      airAltitude: spec.airAltitude ?? 2,
      billboard: spec.billboard,
      role: spec.role, attackType: spec.attackType,
      suicide: spec.suicide, squadMode: spec.squadMode, noDemote: spec.noDemote,
      elite: spec.elite, canBuild: spec.canBuild, tactics: spec.tactics,
    } as MobDef;
  });

  // ---- ★ 敌人（R1c 最小接线）：SwarmSystem 指挥链 + 自渲染胶囊（无物理/无战斗） ----
  const swarm = new SwarmSystem();
  // ★ FTX 精细贴图批量渲染（每兵种图集 + InstancedMesh；替代胶囊）
  let batchOn = false;
  if (mobAssets.length > 0) {
    try {
      swarm.buildBatch(scene, mobAssets.map((m) => m.asset), mobDefs.map((d) => d.groundSink));
      batchOn = true;
    } catch (e) {
      console.warn('[rts] buildBatch 失败，回退胶囊', e);
    }
  }
  const hooks: SwarmHooks = {
    playerX: spawn.x, playerZ: spawn.z, shipX: spawn.x, shipZ: spawn.z,
    camForwardX: 0, camForwardZ: 1,
    entityCount: 0,
    melee: () => {},
  };
  // ---- ★ L3 实体敌人：走**官方 spawner 通道**（掉落/enemyDefs/animMap 全登记）----
  const enemies: EnemyBase[] = [];   // 存活 L3 实体（spawner 创建时 push）

  // ---- ★ 世界刷怪器（原游戏 WorldSpawner）：指挥器端口的实现载体 ----
  const spawner = new WorldSpawner({
    enemies,   // ★ 活数组：spawner 创建实体时 push（hooks/贴地共用）
    enemyDefs: new WeakMap(),
    mobDefs,
    bossEntity: null, bossRun: false, threat: { setThreat: () => {} }, scalingInputs: null,
    enemyScale: { hp: 1, atk: 1, def: 0 },
    player: { position: { x: spawn.x, y: 0, z: spawn.z }, hitAnchorY: () => 1.5 },
    ship: null, entities, swarm, swarmDirector: { setThreat: () => {} },
    chunks, raster,
    session: { player: { maxHp: 100, attackPower: 10, defense: 2 }, meta: { day: 1 }, gacha: { totalPulls: 0 } },
    scene, camera,
    drones: [], worldUIManager: { setThreatLabel: () => {} },
    testChunk: false, shipDestroyed: false, bossAsset: null,
    showFloatingAt: () => {}, syncSceneBgm: () => {}, returnToBase: () => {},
  } as unknown as SpawnDeps);
  spawner.refreshEnemyScale();   // ★ 敌强口径（按会话/天数；此处桩会话）
  // ★ 指挥器端口接线（**创建只走四兵种管理器**；原子生成口由 attachSpawnPorts 装配）
  wireCommanderPorts({
    data: swarm.data, spawner, raster, mobDefs, entities, scene, chunks,
    surfaceAt: (x, z) => raster.surfaceHeightAtFor(x, z, 0),
    playerPos: () => (hooks.shipX !== 0 || hooks.shipZ !== 0 ? { x: hooks.shipX, z: hooks.shipZ } : { x: spawn.x, z: spawn.z }),   // ★ 生成环参照 = **舰心**（用户定 2026-09-27）
  });
  // ★ 掩体朝向修正（用户定 2026-09-25）：正面朝**舰船**（威胁来源），而非登陆点地形来向
  // ★ 懒更新（用户定 2026-09-27）：远处只记数据；玩家/相机走近（≤L3_RADIUS）再物化实体
  const coverLazy = new CoverLazy((x, z, v) =>
    buildEnemyCover(entities, scene, x, raster.surfaceHeightAtFor(x, z, 0), z, v, swarm.data.defensePlan, { x: spawn.x, z: spawn.z }));
  swarm.data.buildCover = (x, z, v) => coverLazy.queueOrBuild(x, z, v, spawn.x, spawn.z, cam.tx, cam.tz, SWARM.L3_RADIUS);
  // ★ 事态环形夹取：**引擎令 + 队长令同门**——新引擎 OrderValidator ① + 队长核 clampRing 端口
  //   （旧 `tactics.ringClamp` 写口已删；环是单源：commander.clampToRing）

  // ★ 官方升降格/命令/队长镜像（WorldSpawner 实现 SwarmTierPort）
  EnemyBase.climbLandedHook = (sid, uid) => swarm.forceRepathClimb(sid, uid);   // ★ 爬坪到落点 → 强制重寻路
  hooks.tierPort = spawner;
  hooks.activeUnits = () => enemies;
  hooks.onDirective = (uid, order, directive, until) =>
    spawner.applyOrderToEntity(uid, order, directive, until);
  hooks.onLeaderChanged = (uid, isLeader) => spawner.setLeaderFlag(uid, isLeader);
  // ★ 碰撞斥力修正（用户定 2026-09-27）：体积重叠对互推（H2 闸门）
  let sepHintY = 0;
  const sepProbe = createRasterProbe(() => sepHintY);
  // ★ 近战伤害（代理侧钩子）：目标=舰船（1）扣舰船血量；玩家（0）暂无实体
  let shipHp = 1000;
  hooks.melee = (targetKind, dmg, x, z) => {
    if (targetKind !== AGENT_TARGET_SHIP) return;
    if (Math.hypot(x - spawn.x, z - spawn.z) <= SHIP_LENGTH / 2 + 2) shipHp = Math.max(0, shipHp - dmg);
  };
  // ★ 新引擎接线（重写 P4）：**唯一指挥链**——旧链已删，无回退开关
  // ★ 巡逻位移记录（用户定 2026-09-27）：近 30s 的位移最大差值（bbox）；>4m = 真在巡（豁免判官）
  const patrolTrack = new Map<number, { t: number[]; x: number[]; z: number[] }>();
  const patrolMoved = (uid: number, x: number, z: number, now: number): boolean => {
    let tr = patrolTrack.get(uid);
    if (!tr) { tr = { t: [], x: [], z: [] }; patrolTrack.set(uid, tr); }
    tr.t.push(now); tr.x.push(x); tr.z.push(z);
    while (tr.t.length > 0 && now - (tr.t[0] as number) > 30) { tr.t.shift(); tr.x.shift(); tr.z.shift(); }
    if (patrolTrack.size > 1024) patrolTrack.clear();
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (let i = 0; i < tr.x.length; i++) {
      const vx = tr.x[i] as number, vz = tr.z[i] as number;
      if (vx < mnX) mnX = vx; if (vx > mxX) mxX = vx;
      if (vz < mnZ) mnZ = vz; if (vz > mxZ) mxZ = vz;
    }
    return Math.max(mxX - mnX, mxZ - mnZ) > 4;
  };

  let shadowBridge: EngineBridge | null = null;
  let engineView: SquadViewPort | null = null;
  let tactics: { sectors: SectorBuilder; battalions: BattalionManager; mainSectors: number[]; acc: number; tick(h: number): void } | null = null;
  let squadCores: SquadRegistry | null = null;
  {
    shadowBridge = new EngineBridge({
      player: () => ({ x: hooks.playerX, z: hooks.playerZ }),
      ship: () => ({ x: hooks.shipX, z: hooks.shipZ }),
      squads: () => {
        const out: LiveSquad[] = [];
        for (const sq of swarm.squads.all()) {
          const def = mobDefs[sq.mobKind] as { role?: string; isAir?: boolean } | undefined;
          const role = sq.builders ? 'engineer' : def?.isAir ? 'flyer' : def?.role === 'ranged' ? 'ranged' : 'melee';
          // ★ 铁律：无质心——引擎取**队长位置**（队长没了才回退质心）
          const lead = sq.members.get(sq.leaderUid);
          let lx = 0, lz = 0;
          if (lead) { lx = lead.x; lz = lead.z; }
          else { const c = { x: 0, z: 0 }; swarm.squads.centroidOf(sq.id, c); lx = c.x; lz = c.z; }
          let sh = 0, sm = 0;
          for (const m of sq.members.values()) { sh += m.hp; sm += m.maxHp; }
          const cv = squadCores?.viewOf(sq.id);
          out.push({ id: sq.id, leaderUid: sq.leaderUid, role, x: lx, z: lz, alive: Math.max(0, sq.members.size - sq.casualties),
            full: sq.members.size,   // ★ §3.G：满编（存活占比判据）
            hpRatio: sm > 0 ? sh / sm : 1,
            phase: cv?.phase, atom: cv?.atom, progress: cv?.progress, stillS: cv?.stillS });
        }
        return out;
      },
      enemies: () => {
        const out: { uid: number; x: number; z: number }[] = [];
        for (const e of enemies) out.push({ uid: e.swarmUid, x: e.position.x, z: e.position.z });
        const pool = swarm.pool;
        for (let i = 0; i < pool.count; i++) out.push({ uid: pool.swarmUid[i], x: pool.x[i], z: pool.z[i] });
        return out;
      },
      /** ★ 工兵不入攻击队列（用户定 2026-09-25）：只筛掉工兵编制的单位；统一计时仍看全体 */
      attackables: () => {
        const eng = new Set<number>();
        for (const sq of swarm.squads.all()) if (sq.builders) for (const uid of sq.members.keys()) eng.add(uid);
        const out: { uid: number; x: number; z: number; range?: number }[] = [];
        // ★ 远程许可射程 = 单位自身射程（用户定 2026-09-27）：名册射程缓存（按 mobIndex）
        const rCache = new Map<number, number>();
        const rangeOf = (mi: number): number => {
          let r = rCache.get(mi);
          if (r === undefined) { const def = mobDefs[mi]; r = def ? spawner.mobAgentStats(def).range : 25; rCache.set(mi, r); }
          return r;
        };
        for (const e of enemies) {
          // ★ 回收/死亡的不再入队（用户定 2026-09-26：队列不得保留已回收者）——
          //   实体退役是延后扫描，队列会认为“还在”
          if (e.dead || e.hp <= 0 || e.lifeState !== 'active') continue;
          if (eng.has(e.swarmUid)) continue;
          const sq = swarm.squads.squadOf(e.swarmUid);
          const mi = sq?.mobKind ?? -1;
          const ranged = mi >= 0 && mobDefs[mi]?.role === 'ranged';
          out.push({ uid: e.swarmUid, x: e.position.x, z: e.position.z, range: ranged ? rangeOf(mi) : undefined });
        }
        const pool = swarm.pool;
        for (let i = 0; i < pool.count; i++) {
          if (eng.has(pool.swarmUid[i])) continue;
          out.push({ uid: pool.swarmUid[i], x: pool.x[i], z: pool.z[i], range: pool.ranged[i] === 1 ? pool.meleeRange[i] : undefined });
        }
        return out;
      },
      /** ★ 工兵端口（新引擎全权）：建造位置查询（危险点/扇区弧链随机可达点）+ 施工落地 */
      engineer: () => swarm.data.engineerPort(),
      /** ★ 创建端口（四兵种管理器；只建本兵种 ∧ 只在对应防区） */
      creation: () => swarm.data.combatCreationPort(),
      posture: () => swarm.data.postureP,
      assault: () => swarm.data.battlePosture === 'assault',   // ★ 总攻：强制全体到舰
      // ★ §3.G：被击检测（命中窗 = squad alert 窗；与判官豁免同源 recentHits）
      underAttack: (id: number) => {
        const t = swarm.recentHits.get(id);
        return t !== undefined && simNow() - t <= AUTONOMY.SQUAD_ALERT_S;
      },
      // ★ §3.G：后撤点夹环（单源 SwarmData.clampToRing）
      clampRing: (x: number, z: number) => swarm.data.clampToRing(x, z),
      blockedAt: (x, z) => swarm.data.blockedAt(x, z),   // 总攻目标吸附用
      agents: () => {   // ★ 池代理位置（卡死判官在册用）
        const p = swarm.pool; const out: { uid: number; x: number; z: number }[] = [];
        for (let i = 0; i < p.count; i++) out.push({ uid: p.swarmUid[i], x: p.x[i], z: p.z[i] });
        return out;
      },
      /** ★ 第一波已发（波次决策源：抵舰驻留；真源 = 引擎） */
      /** ★ 波次/放行数据面（引擎决策读；账本仍是闸门真源） */
      t01: () => swarm.data.lastT01,
      ledgerTotal: () => swarm.ledger.total,
      setReleaseCap: (cap: number) => { swarm.ledger.releaseCap = cap; },
      /** ★ 卡死豁免（新引擎 TimerManager 口径）：驻守命令 / 交火中（被击 8s / noDemote）→ 免判。
       *  ★★ 收回机制铁律（《RTS架构.md》§0.1）：豁免名单**只减不增**；被收回 = 出了问题（修行为，不修判官）★★ */
      exemptOf: (uid: number) => {
        const sq = swarm.squads.squadOf(uid);
        if (!sq) return null;
        // ★ 驻守直接豁免（用户定 2026-09-27）；巡逻看"近 30s 位移最大差值"——>4m = 真在巡 → 豁免
        //   ★ 口径（用户定 2026-09-27）：**只有"明确是驻守"（garrison 令）才豁免**；
        //   到岗不动 = 没下一步命令 / 兜底循环没兜住 → 修兜底，**不许豁免**。
        if (swarm.orderKindOf(sq.id) === 'garrison') return 'garrison';
        {
          const ost = shadowBridge?.writer.store.get(sq.id)?.order;
          if (ost?.mission === 'patrol') {
            const m = sq.members.get(uid);
            if (m && patrolMoved(uid, m.x, m.z, simNow())) return 'patrol';
          }
        }
        // ★ 拿到开火许可的远程（用户定 2026-09-27）：站桩射击不是发呆 → 不被回收
        if (sq.type === 'ranged' && shadowBridge?.hasFirePermit(uid) === true) return 'fire';
        const nowS = simNow();
        const hitAt = swarm.recentHits.get(sq.id);
        if (hitAt !== undefined && nowS - hitAt <= AUTONOMY.SQUAD_ALERT_S) return 'hit';
        const p = swarm.pool;
        for (let i = 0; i < p.count; i++) {
          if (p.swarmUid[i] === uid && p.noDemoteUntil[i] > nowS) return 'combat';
        }
        return null;
      },
      /** ★ 计时销毁/卡死判决落地（用户定）：L3 实体 retire / L2 代理回收（归还编制） */
      retire: (uid: number, why: string) => {
        // ★ 特殊兵种卡死 → **原血量原地再放一个**（用户定 2026-09-27）：
        //   精英 / singleton（小 boss）被卡死判官回收时，不清失——按名册满血在同一位置重放（编制中性：
        //   回收归还额度 → 新放消耗额度）。非特殊兵种维持原回收逻辑。
        if (why === 'stuck') {
          const sq = swarm.squads.squadOf(uid);
          const def = sq ? mobDefs[sq.mobKind] as { elite?: boolean; squadMode?: string } | undefined : undefined;
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
              // ★ 回退一（用户定 2026-09-27）：卡死点不可放 → **环内同方位点**再试
              const c = swarm.data.clampToRing(x, z);
              if (Math.hypot(c.x - x, c.z - z) > 1 && spawner.spawnSingle(def as never, c.x, raster.surfaceHeightAt(c.x, c.z), c.z, -1, false, mhp)) return true;
              // ★ 回退二：最后手段——force 放置（绝不让特殊兵种凭空消失）
              return spawner.spawnSingle(def as never, c.x, raster.surfaceHeightAt(c.x, c.z), c.z, -1, true, mhp);
            };
            for (const e of enemies) {
              if (e.swarmUid !== uid) continue;
              const x = e.position.x, z = e.position.z, y = e.position.y;
              const mhp = (e as { maxHp?: number }).maxHp ?? 0;   // ★ 原血量（用户定 2026-09-27）
              e.retire('recycled');
              respawn(x, y, z, mhp);
              return true;
            }
            const p = swarm.pool;
            for (let i = 0; i < p.count; i++) {
              if (p.swarmUid[i] !== uid) continue;
              const x = p.x[i], y = p.y[i], z = p.z[i], mhp = p.maxHp[i];   // ★ 原血量
              swarm.recycleByUid(uid, why);
              respawn(x, y, z, mhp);
              return true;
            }
          }
        }
        for (const e of enemies) {
          if (e.swarmUid !== uid) continue;
          e.retire(why === 'stuck' ? 'stuck' : 'despawned');   // ★ 如实标记：stuck 不再记成 recycled（统计分桶）
          return true;
        }
        spawner.dropStashByUid(uid);
        return swarm.recycleByUid(uid, why);
      },
      // ★ 引擎决策 → 队长核（**唯一执行层**）；UI/探针走 engineView（不再有镜像板）
      emit: (squadId, order, now) => {
        squadCores?.accept(squadId, order, now);   // ★ P4：队长核接令（导航+调遣）
      },
    });
    shadowBridge.directMode = DIRECT;   // ★ ?direct=1：关蜂群引擎（只执行玩家指令）
    // ★ 队长核（重写 P2）：实机队长接令/分流/汇报；位置单源 = 队长
    const roleOf = (id: number): 'engineer' | 'flyer' | 'ranged' | 'melee' => {
      const sq = swarm.squads.get(id);
      const def = sq ? mobDefs[sq.mobKind] as { role?: string; isAir?: boolean } | undefined : undefined;
      return sq?.builders ? 'engineer' : def?.isAir ? 'flyer' : def?.role === 'ranged' ? 'ranged' : 'melee';
    };
    // ★ P4：队长目标/站位**直读新 store**（唯一真源）；旧板只作走廊/滞回缓存
    setLiveOrderSource((id: number) => {
      const cur = shadowBridge?.writer.store.get(id);
      return cur
        ? { kind: cur.order.kind, target: cur.order.target, anchor: cur.order.anchor, threat: cur.order.threat }
        : null;
    });
    // ★ 开火闩锁（新引擎 AttackQueues→TimerManager 置/撤）→ 成员指令开火门（软禁火）
    swarm.setFireGate((uid: number) => shadowBridge?.timers.canFire(uid) ?? true);
    squadCores = new SquadRegistry(
      roleOf,
      (r: SquadReport, now: number) => shadowBridge?.squads.report(r, now),
      (id: number) => {
        const sq = swarm.squads.get(id);
        return sq ? Math.max(0, sq.members.size - sq.casualties) : 0;
      },
      // ★ 队长核驱动端口（执行层落地；成员指令唯一写口 = swarm.applyDirectivePort）
      {
        squadOf: (id: number) => swarm.squads.get(id) ?? null,
        ensurePath: (state, squad, now) => swarm.ensurePathFor(state, squad, now),
        patrolNext: (id, x, z, ax, az, r, leg) => {
          // ★ 总攻=全体到舰（用户定 2026-09-27）：巡逻腿=锚点（舰）——直接压到舰，不巡。
          if (swarm.data.battlePosture === 'assault') return { x: ax, z: az };
          // ★★ 巡逻设计（用户定 2026-09-27）：**巡逻=不停调用长/短寻路走向下一腿**——
          //   本端口只产"下一腿目标点"：地面腿走可行性（reachFrom 校验，长短寻路同源消费）；
          //   空中腿**不做可行性**（直航目标）。围绕点**跟随当前位（可一直变）**；
          //   腿=**大幅侧向**（基准 24m，逐级回退）× 交替侧 + 轻微外推；
          //   **绝不向舰大幅后退**（腿只有侧向+外向分量）；空中不做可行性、直接飞；地面走可达校验。
          const sq = swarm.squads.get(id);
          let air = false;
          if (sq) {
            const p = swarm.pool;
            for (let i = 0; i < p.count; i++) if (p.swarmUid[i] === sq.leaderUid) { air = p.isAir[i] === 1; break; }
            if (!air) for (const e of enemies) if (e.swarmUid === sq.leaderUid) { air = e.isAir; break; }
          }
          const ring = swarm.data.ring;
          let ox = x - ring.cx, oz = z - ring.cz;
          const od = Math.hypot(ox, oz);
          if (od < 1e-3) { ox = 1; oz = 0; } else { ox /= od; oz /= od; }   // 外向（远离舰）
          const tx2 = -oz, tz2 = ox;                                        // 侧向
          const R = Math.max(24, r);
          const drift = R * 0.25;                                           // 轻微外推（防原地/回退）
          const s0 = leg >= 0 ? 1 : -1;
          const cands: [number, number][] = [];
          for (const rr of [R, R * 0.6, R * 0.3]) {
            cands.push([x + tx2 * s0 * rr + ox * drift, z + tz2 * s0 * rr + oz * drift]);
            cands.push([x - tx2 * s0 * rr + ox * drift, z - tz2 * s0 * rr + oz * drift]);
          }
          cands.push([x + ox * drift, z + oz * drift]);
          for (const [gx, gz] of cands) {
            if (air) return swarm.data.clampToRing(gx, gz);               // 空中：免可行性，夹环直飞
            if (swarm.reachFrom(id, gx, gz)) return { x: gx, z: gz };     // 地面：可达校验
          }
          return null;
        },
        // ★ 去哪就去哪（简化 2026-09-25）：队长目标 = 下一路点 / 队令目标（无锚点层）
        leaderTarget: (state, _squad, lx, lz) => currentTargetOf(state, lx, lz),
        // ★ 驻守（队长状态）：舰位 + 掩体表（自主掩体循环；毁件自然消失）
        shipPoint: () => ({ x: hooks.shipX, z: hooks.shipZ }),
        playerPoint: () => ({ x: hooks.playerX, z: hooks.playerZ }),
        coversNear: (x: number, z: number, r: number) => swarm.data.holeTable.covers
          .filter((c) => Math.hypot(c.x - x, c.z - z) <= r)
          .map((c) => ({ x: c.x, z: c.z })),
        coverFrom: (tx, tz, x, z) => swarm.data.debugHasCover(tx, tz, x, z),
        clampRing: (x, z) => swarm.data.clampToRing(x, z),
        fireAllowed: (uid) => shadowBridge?.timers.canFire(uid) ?? true,
        applyDirective: (uid, order, dir, until, ax, az) => swarm.applyDirectivePort(uid, order, dir, until, ax, az),
        mobTactics: (mi) => mobDefs[mi]?.tactics ?? null,
      },
    );
    // ★ 执行态单源（队长核）：SwarmSystem 的 steer/follow/寻路读这里；旧黑板只作 UI 镜像
    swarm.setSquadStateSource((id: number) => squadCores?.stateOf(id) ?? null);
    // ★ 队注销：清队长核 + 引擎 store + 汇报记录
    swarm.setSquadGone((id: number) => {
      squadCores?.drop(id);
      shadowBridge?.writer.release(id);
      shadowBridge?.squads.remove(id);
    });
    // ★ P-Flux 接线（用户定 2026-09-27；《移动执行重写.md》§7.4）：
    //   实体（纹理/血条等）**不销毁**——L3→L2 隐藏、L2→L3 显示复用、L1 收纳对象仓/取出复用。
    //   （现网升降格仍走旧销毁路径；本口在 P-L2′「隐藏更新」接线后接管——见文档相位。）
    setTierHandover(new Flux({
      hasEntity: (uid) => (spawner.entityByUid(uid) ?? null) !== null,
      hideEntity: (uid) => spawner.hideByUid(uid),
      showEntity: (uid) => spawner.showByUid(uid),
      stashEntity: (uid) => spawner.stashByUid(uid),
      unstashEntity: (uid) => spawner.unstashByUid(uid),
      hasInPool: (uid) => { const pl = swarm.pool; for (let i = 0; i < pl.count; i++) if (pl.swarmUid[i] === uid) return true; return false; },
      takeFromPool: (uid) => swarm.takeAgent(uid),
      // ★ 物化（L1→L2 从预留名册出人）：走**唯一生成口**（记配额）；满编/闸门拒绝 → false（调用方回补预留）
      putToPool: (data) => swarm.spawn(data as never, false) >= 0,
    }));
    // ★ UI/探针只读视图（引擎令 + 汇报 + 队长核执行态；替代旧镜像板）
    engineView = {
      squads: () => (shadowBridge ? squadViews(shadowBridge.writer, shadowBridge.squads, (id) => squadCores?.stateOf(id) ?? null) : []),
      recentCommands: (n: number) => shadowBridge?.writer.recent(n) ?? [],
      latestCommandPerSquad: (w: number) => shadowBridge?.writer.latestPerSquad(w) ?? new Map(),
    };
    setSwarmDebugView(engineView);
    setSwarmTraceView(engineView);
    // ★ 战术侧（《RTS架构.md》§2.12）：扇区构建系统 + 大队管理器（只读编制/部署计划；不直接发令）
    tactics = {
      sectors: new SectorBuilder(),
      battalions: new BattalionManager(),
      mainSectors: [0],
      acc: 0,
      tick(h: number): void {
        this.acc += h;
        if (this.acc < 0.5) return;
        this.acc = 0;
        const swd = swarm.data;
        const ship = { x: spawn.x, z: spawn.z, y: raster.surfaceHeightAt(spawn.x, spawn.z) };
        const band = swd.fortifyBand;
        // ★ 舰船关联高地整片排除（含其上坑洞）；无舰船 → 传 null = 正常占领
        this.sectors.buildOne(ship.x, ship.z, ship.y, band.rLo, band.rHi,
          (x, z) => raster.surfaceHeightAt(x, z), (x, z) => swd.blockedAt(x, z));
        const recs: { id: number; role: 'engineer' | 'melee' | 'ranged' | 'flyer'; alive: number; x: number; z: number; atom?: string; phase?: string; progress?: number; stillS?: number }[] = [];
        if (shadowBridge) for (const r of shadowBridge.squads.all()) recs.push({ id: r.id, role: r.role, alive: r.alive, x: r.x, z: r.z, atom: r.atom, phase: r.phase, progress: r.progress, stillS: r.stillS });
        this.battalions.refresh(recs);
        this.battalions.regroup();
        this.battalions.deploy(this.mainSectors, spawn.x, spawn.z);   // ★ 就近选防区（传舰位）
        this.battalions.gaps(this.mainSectors);
        // ★ 主攻选择（用户定 2026-09-26）：按难度（事态 p）选 1~3 个扇区；当前集合仍有效则不重选（稳定）
        {
          const p01 = swarm.data.postureP;
          const k = p01 < 0.4 ? 1 : p01 < 0.75 ? 2 : 3;
          // ★ 主攻选择冻结（用户定 2026-09-27）：**一次选定后不再按容量重排**；
          //   只在 ①首次无选 ②事态档 k 变化 时重选（选中即冻结）。
          if (this.mainSectors.length !== k) {
            const sel = this.sectors.selectMain(k);
            if (sel.length > 0) this.mainSectors = sel;
            else if (this.mainSectors.length === 0) this.mainSectors = [0];
          }
        }
        swarm.data.mainSectors = [...this.mainSectors];   // ★ 主攻扇区 → 四兵种创建与工兵投放
        swarm.data.squadSectorOf = (id) => this.battalions.deployPlan.get(id) ?? -1;   // ★ 部署真源 → 三兵种创建计数
        // ★ 防区锚点（用户定 2026-09-27）：可部署面中离舰最近的**可达**点（可达优先；否则最近点）。
        //   缓存键 = `pathStamp`（= **表真正重建**的代次，见 PassTableKeeper/SwarmData），
        //   挖掘次数不参与 → 不会恒失效；BFS 只查最近 8 个候选（次数封顶）。
        const anchorCache = new Map<number, { stamp: number; a: { x: number; z: number } | null }>();
        swarm.data.sectorAnchorOf = (sec) => {
          const stamp = swarm.data.pathStamp;
          const hit = anchorCache.get(sec);
          if (hit && hit.stamp === stamp) return hit.a;
          const pts = this.sectors.sectors[sec]?.points;
          if (!pts || pts.length === 0) { anchorCache.set(sec, { stamp, a: null }); return null; }
          const near = [...pts].sort((a, b) => a.d - b.d).slice(0, 8);
          let bestReach: { x: number; z: number } | null = null;
          let bestReachD = Infinity;
          for (const p of near) {
            if (p.d < bestReachD && swarm.reachable(spawn.x, spawn.z, p.x, p.z)) {
              bestReachD = p.d; bestReach = { x: p.x, z: p.z };
            }
          }
          const a = bestReach ?? { x: near[0]!.x, z: near[0]!.z };
          anchorCache.set(sec, { stamp, a });
          return a;
        };
      },
    };
  }
  // ★ 玩家发令面板（重写 P3；用户定）：所有玩家命令从这里出 → EngineBridge.playerOrder*
  const cmdPanel = new CommandPanel();
  cmdPanel.onOrder = (kind, target, scope) => {
    const k = kind as SquadOrder['kind'];
    let n = 0;
    if (scope === 'all') n = shadowBridge?.playerOrderAll(k, target) ?? 0;
    else if (scope === 'selected') {
      for (const id of cmdPanel.selectedIds()) if (shadowBridge?.playerOrder(id, k, target)) n++;
    } else n = shadowBridge?.playerOrderNear(k, target, 60) ?? 0;
    cmdPanel.lastText = `${kind} → ${n} 队已接令（${scope}）`;
  };
  // ★ AI 行为上下文（原 WorldMode.aiCtx）：驱动 L3 实体移动/攻击（aiSystem.updateAll）
  const explosionFx = new ExplosionFx(scene);
  const meleeToTargets = (x: number, z: number, range: number, dmg: number): void => {
    if (Math.hypot(x - spawn.x, z - spawn.z) <= range + SHIP_LENGTH / 2) shipHp = Math.max(0, shipHp - dmg);
  };
  const aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => ({ x: spawn.x, z: spawn.z }),   // ★ 索敌 = 舰船
    attack: (opts) => {
      if (opts.type === 'projectile') {
        const skin = (opts as { bulletSkin?: string }).bulletSkin;
        const pool = opts.camp === 'enemy' ? (skin === 'fireball' ? enemyBolts : enemyArrows) : playerBullets;
        executeAttack(entities, pool, opts);
        return;
      }
      if (opts.type === 'aoe') {
        if (opts.camp === 'enemy') {
          explosionFx.spawn(opts.x, opts.y, opts.z, opts.radius);
          meleeToTargets(opts.x, opts.z, opts.radius, opts.damage);
        }
        return;
      }
      if (opts.type === 'melee' && opts.camp === 'enemy') meleeToTargets(opts.x, opts.z, opts.range, opts.damage);
    },
    focusX: spawn.x, focusZ: spawn.z, focusY: 0,
  };
  const shipState = { get hp(): number { return shipHp; } };
  // ★ 升格判据（用户定）：**相机视野内** → L3 实体；离开视野由 tickDemote 降格
  const _pv = new THREE.Vector3();
  hooks.inView = (x: number, z: number) => {
    const y = raster.surfaceHeightAtFor(x, z, 0) + 1.2;
    _pv.set(x, y, z).project(camera);
    if (_pv.z > 1 || _pv.x < -1.15 || _pv.x > 1.15 || _pv.y < -1.15 || _pv.y > 1.15) return false;
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    return d < 220;
  };
  // ★ RTS 全体敌人管理器（外接；框选/单击/红圈）
  const enemyMgr = new EnemyManager({ enemies, swarm, camera, scene });
  // ★ 右侧敌人列表（兵种 → 队长 → 代理；点击选中出红圈）
  const enemyPanel = new EnemyListPanel(swarm, enemyMgr, ENEMY_ROSTER.map((s) => s.name), engineView!);
  // ★ 寻路可视化小地图（走廊/起点/终点/队令/队长；M 键开关）
  const navMap = new NavDebugMap(raster, swarm, () => ({ x: spawn.x, z: spawn.z }), engineView ?? undefined, () => (tactics ? { sectors: tactics.sectors, mainSectors: tactics.mainSectors } : null));
  // ★ 上坡点场景可视化（用户定 2026-09-26）：**默认绘制**（H 键可关）
  enemyPanel.onInspectCommand = (sid, entry) => navMap.open(sid, entry ? { x: entry.tx, z: entry.tz } : undefined);
  // ★ AI 可读记录器（命令/指令/寻路/生死；Y=下载 JSONL，U=控制台打印中文摘要）
  const aiTrace = new AiTrace(swarm, enemies, SEED, ENEMY_ROSTER.map((s) => s.name), engineView ?? undefined);
  // ★ 快车道结算（代理直扣 / 实体走管线）；K = 对相机中心 18m 内造成 15 伤害（演示/测试口）
  const fastLane = new FastLane(swarm, enemies);
  // ★ 时间轴（拖动 = 绝对当日进度；事态/闸门/命令随之重算）
  const timeline = new Timeline(swarm.data);
  timeline.onChange = () => { navMap.redrawNow(); enemyPanel.refreshNow(); };   // ★ 时间轴一动：小地图/列表立即重绘
  // ★ 贴地/悬停/掉坑结算（原 WorldMode：玩家 + 每个敌人实体每帧）
  const charClamp = new CharacterClamp({
    raster,
    player: null as unknown as Parameters<typeof CharacterClamp.prototype.update>[0],
    clampVehicle: () => {},
    platformTopAt: () => null,
  });
  // ★ 加速（用户定 2026-09-25）：只跑 AI 性能开销小；dt 缩放，日进度走**模拟时钟**
  let speed = 1;
  let simT = 0;
  /** ★ 倍速档位（10× 一键直达；Timeline 按钮/`,`/`.` 同源） */
  const SPEEDS = [1, 2, 5, 10, 20, 50, 100];
  R.__setSpeed = (v: number): void => { speed = Math.max(1, Math.min(100, v)); };
  R.__speeds = SPEEDS;
  // ★ 指挥器建计划：**敌方登陆点**（距舰 ~160m 的可行方向）——不能在舰旁布防/刷兵
  const pickEnemyLanding = (): { x: number; z: number } => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = spawn.x + Math.cos(a) * 160;
      const z = spawn.z + Math.sin(a) * 160;
      if (swarm.data.blockedAt(x, z)) continue;
      if (raster.surfaceHeightAtFor(x, z, 0) < -1.0) continue;
      return { x, z };
    }
    return { x: spawn.x + 160, z: spawn.z };
  };
  const landing = pickEnemyLanding();
  // ★ 复制信息面板（调试：seed + 舰落点 + 敌落点 + 相机；一键复制）
  const copyInfo = new CopyInfoPanel(() => ({
    seed: SEED, ship: { x: spawn.x, z: spawn.z }, landing, cam: { x: cam.tx, z: cam.tz },
  }));
  try {
    // ★ 建表半径必须**覆盖舰船**（长行军目标=舰；否则目标在表外 → 长寻路回落失败）
    const tableR = Math.min(240, Math.ceil(Math.hypot(landing.x - spawn.x, landing.z - spawn.z)) + 60);
    swarm.data.planDefense(landing.x, landing.z, tableR, performance.now() / 1000);
  } catch (e) {
    console.warn('[rts] planDefense 失败（命令链仍可手动）', e);
  }

  // ---- ★ 子弹 / 战斗管线（敌箭/敌法球/玩家弹池 + 唯一命中结算）----
  let combat: CombatSystem;
  const playerBullets = new BulletManager(entities, scene, createSolidBulletAsset(), 10, renderer, hitEffects, (p) => combat.resolveBulletHit(p));
  const enemyArrows = new BulletManager(entities, scene, createArrowAsset(), 8, renderer, hitEffects, (p) => combat.resolveBulletHit(p), { baseWidth: 0.28 });
  const enemyBolts = new BulletManager(entities, scene, createFireballAsset(), 6, renderer, hitEffects, (p) => combat.resolveBulletHit(p));
  combat = new CombatSystem({
    physics, swarm, bullets: playerBullets, chunks,
    spawnSentinelAt: () => {},
    spawnItemDrops: () => {},
    agitateWaterNear: () => {},
    showAgentDamage: () => {},
  });
  // ★ 敌方远程出口：代理/实体射击 → 真弹道（箭/法球按 skin 选池；命中由 CombatSystem 唯一结算）
  hooks.onAgentRanged = (tk, dmg, x, z, tx, tz, skin, speed, life, spread) => {
    const oy = raster.surfaceHeightAtFor(x, z, 0) + 1.0;
    const aimY = tk === AGENT_TARGET_SHIP ? shipY + 2 : oy + 1.7;
    let dx = tx - x, dy = aimY - oy, dz = tz - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (spread > 0) {
      const s = { x: dx, y: dy, z: dz };
      scatterDir(s, spread);
      dx = s.x; dy = s.y; dz = s.z;
    }
    executeAttack(entities, skin === 1 ? enemyBolts : enemyArrows, {
      type: 'projectile', source: AGENT_SOURCE,
      x: x + dx * 0.7, y: oy + dy * 0.7, z: z + dz * 0.7,
      dirX: dx, dirY: dy, dirZ: dz,
      speed, camp: 'enemy', lifetime: life, damage: dmg,
    });
  };
  // ★ 不再手工铺环：兵力全部由**四兵种管理器的创建接口**按防区需求创建
  // ★ 兜底胶囊渲染（仅当 FTX 批量不可用时创建；否则不加入场景——防"红胶囊占位"）
  const useFallback = !batchOn;
  const unitMesh = useFallback
    ? new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.6, 1.4, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0xcc4433 }),
      256,
    )
    : null;
  if (unitMesh) {
    unitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    unitMesh.frustumCulled = false;
    unitMesh.count = 0;
    scene.add(unitMesh);
  }
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x4a5a3a, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(0.5, 1, 0.3);
  scene.add(dl);
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();
  const _axisY = new THREE.Vector3(0, 1, 0);
  const renderAgents = (): void => {
    if (!unitMesh) return;   // FTX 批量渲染接管
    const pool = swarm.pool;
    let n = 0;
    for (let i = 0; i < pool.count; i++) {
      if (pool.hp[i] <= 0) continue;
      _p.set(pool.x[i], pool.y[i] + 0.8, pool.z[i]);
      _q.setFromAxisAngle(_axisY, pool.yaw[i]);
      _m4.compose(_p, _q, _s);
      unitMesh.setMatrixAt(n++, _m4);
    }
    unitMesh.count = n;
    unitMesh.instanceMatrix.needsUpdate = true;
  };

  const sun = new SunCycle();
  sun.reset(10);
  const feedLight = (): void => {
    updateTerrainLighting(sun.current);
    updateWallMaterialsLighting(sun.current);
    updateApronLighting(sun.current);
  };

  // ★ 手动放敌人接口（用户定 2026-09-24，调试）：B 切换放置模式 → 左键点地放一窝（**可放水里**）；
  //   右键点地 = 强制移动令（玩家源，选中队全员 advance）——用于手测"掉水里能不能出来"
  let placeMode = false;
  const placeHint = document.createElement('div');
  placeHint.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:4px 10px;background:rgba(20,28,40,0.85);color:#9fe3ff;font:12px Consolas,monospace;border:1px solid rgba(90,160,220,0.6);border-radius:4px;display:none;z-index:901;pointer-events:none;';
  document.body.appendChild(placeHint);
  const groundAt = (cx: number, cy: number): { x: number; z: number } | null => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObjects(scene.children, true)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  };
  /** ★ 手动放置一窝敌兵（force：可放水里/坑里；调试接口，探针同口） */
  /** ★ **仅调试/探针**：手动放敌（玩法创建只走四兵种管理器；此口不参与玩法） */
  const placeEnemyAt = (x: number, z: number): boolean => {
    const def = mobDefs.find((d) => d.canBuild !== true && d.isAir !== true) ?? mobDefs[0];
    return def ? spawner.spawnOne(def, x, 0, z, -1, true) : false;
  };
  /** ★ 强制移动令（玩家源；选中队全体 advance）→ 返回发令队数（调试接口，探针同口） */
  const forceMoveSelectionTo = (x: number, z: number): number => {
    const seen = new Set<number>();
    for (const hh of enemyMgr.selected()) {
      const sq = swarm.squads.squadOf(hh.uid);
      if (!sq || seen.has(sq.id)) continue;
      seen.add(sq.id);
      shadowBridge?.playerOrder(sq.id, 'act', { x, z });   // 玩家源 → 同链（只给队长）
    }
    return seen.size;
  };
  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyB') {
      placeMode = !placeMode;
      placeHint.style.display = placeMode ? 'block' : 'none';
      placeHint.textContent = '放置模式：左键点地放敌兵（可放水里）· 右键点地=强制移动令 · 再按 B 退出';
      renderer.domElement.style.cursor = placeMode ? 'crosshair' : '';
    }
    if (e.code === 'BracketLeft') cam.pitch = clamp(cam.pitch + 0.08, 0.12, 1.45);
    if (e.code === 'BracketRight') cam.pitch = clamp(cam.pitch - 0.08, 0.12, 1.45);
    if (e.code === 'Escape') { if (navMap.visible) navMap.close(); else enemyMgr.clear(); }
    if (e.code === 'KeyM') navMap.toggleOverview();
    if (e.code === 'KeyY') aiTrace.download();
    if (e.code === 'KeyU') console.log(aiTrace.digest(150));
    if (e.code === 'Comma' || e.code === 'Period') {
      const i = SPEEDS.indexOf(speed);
      const step = e.code === 'Period' ? 1 : -1;
      const j = i < 0 ? SPEEDS.findIndex((v) => v >= speed) : i + step;
      speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, j))] ?? speed;
    }
    if (e.code === 'KeyK') {
      const r = fastLane.damageArea(cam.tx, cam.tz, 18, 15);
      console.log(`[快车道] 区域伤害 15：代理 ${r.agents} · 实体 ${r.entities}`);
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  // ---- ★ 输入：左键=平移视角（Shift+左=旋转），右键=选/框选，中键=发令，WASD=平移 ----
  const selBox = document.createElement('div');
  selBox.style.cssText = 'position:fixed;border:1px solid rgba(255,80,60,0.9);background:rgba(255,80,60,0.12);pointer-events:none;z-index:900;display:none;';
  document.body.appendChild(selBox);
  let dragging = false, lastX = 0, lastY = 0;
  let boxing = false, boxX0 = 0, boxY0 = 0, boxMoved = 0;
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (placeMode && e.button === 0) {         // ★ 放置模式：左键点地放一窝（force：可放水里/坑里）
      const g = groundAt(e.clientX, e.clientY);
      if (g) placeEnemyAt(g.x, g.z);
      return;
    }
    if (e.button === 2) {                      // 右键 = 选/框选
      boxing = true; boxMoved = 0;
      boxX0 = e.clientX; boxY0 = e.clientY;
      return;
    }
    if (e.button === 1) {                      // 中键 = 发令（临时入口，命令面板后续接管）
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
      const hit = rc.intersectObjects(scene.children, true)[0];
      if (hit) {
        cmdPanel.setTarget(hit.point.x, hit.point.z);
        // ★ 玩家手动命令（重写 P3；用户定）：新引擎经唯一发令器 + player 旁路 → **只给队长**
        //   （60m 内的小队收令；可在 __rts.newEngine() 看到）
        shadowBridge?.playerOrderNear('act', { x: hit.point.x, z: hit.point.z }, 60);
      }
      return;
    }
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  addEventListener('mouseup', (e) => {
    dragging = false;
    if (!boxing) return;
    boxing = false;
    selBox.style.display = 'none';
    if (boxMoved < 6) {
      const h = enemyMgr.pickAt(e.clientX, e.clientY);
      if (h) enemyMgr.select([h], e.shiftKey);
      else if (enemyMgr.selected().length > 0) {
        // ★ 强制移动令（玩家源，调试/手测）：右键点地 → 选中队全体 advance（玩家令优先，引擎不覆盖）
        const g = groundAt(e.clientX, e.clientY);
        if (g) forceMoveSelectionTo(g.x, g.z);
      }
      else if (!e.shiftKey) enemyMgr.clear();
    } else {
      enemyMgr.select(enemyMgr.pickBox(boxX0, boxY0, e.clientX, e.clientY), e.shiftKey);
    }
  });
  addEventListener('mousemove', (e) => {
    if (boxing) {
      boxMoved += Math.abs(e.clientX - boxX0) + Math.abs(e.clientY - boxY0);
      const lx = Math.min(boxX0, e.clientX), ly = Math.min(boxY0, e.clientY);
      selBox.style.left = `${lx}px`; selBox.style.top = `${ly}px`;
      selBox.style.width = `${Math.abs(e.clientX - boxX0)}px`; selBox.style.height = `${Math.abs(e.clientY - boxY0)}px`;
      selBox.style.display = 'block';
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (e.shiftKey || (e.buttons & 4) !== 0) {
      cam.yaw -= dx * 0.005;
      cam.pitch = clamp(cam.pitch + dy * 0.004, 0.12, 1.45);
      return;
    }
    const k = cam.dist * 0.0022;
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    cam.tx -= (rx * dx + fx * dy) * k;
    cam.tz -= (rz * dx + fz * dy) * k;
    clampArea();
  });
  addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 25, 900); }, { passive: true });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  // 右键：只做选/框选（阻止浏览器菜单）
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  // 双击地面 = 移出生点（加载窗与指挥起点随迁）
  addEventListener('dblclick', (e) => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObjects(scene.children, true)[0];
    if (!hit) return;
    spawn.x = hit.point.x; spawn.z = hit.point.z;
    clampArea();
  });

  let last = performance.now();
  /** ★ 单个模拟子步（加速用；每步 ≤0.05s）：AI/指挥/实体模拟/子弹——不含渲染/表现 */
  const simStep = (h: number): void => {
    setSimNow(simT);   // ★ 模拟时钟单源（玩法计时全读它 → 倍速同步加速）
    const fx2 = Math.sin(cam.yaw), fz2 = Math.cos(cam.yaw);
    hooks.camForwardX = fx2; hooks.camForwardZ = fz2;
    hooks.playerX = spawn.x; hooks.playerZ = spawn.z;   // ★ 代理索敌 = 舰船
    // ★ 敌军兵力 HUD（用户定 2026-09-27）：在场 = alive；上限 = min(total, releaseCap)（随事态）；总配额 = total
    {
      const led = swarm.ledger;
      const cap = Math.min(led.total, Math.max(0, led.releaseCap));
      const txt = `敌军：在场 ${led.alive} ｜ 上限 ${cap} ｜ 总配额 ${led.total}（累计生成 ${led.spawned}）`;
      if (enemyStatsEl.textContent !== txt) enemyStatsEl.textContent = txt;
    }
    // ★ 舰船位置单源（用户定 2026-09-27）：hooks.ship 之前只在初始化拷贝一次玩家出生点、之后永不更新
    //   → 兜底"朝舰推进"方位错。每步从**舰船实体**（地图/小地图同源的那个接口）同步。
    hooks.shipX = shipEntity.position.x; hooks.shipZ = shipEntity.position.z;
    hooks.camX = cam.tx; hooks.camZ = cam.tz;   // ★ 相机位置（分层 LOD 第二参照；用户定 2026-09-27）
    hooks.entityCount = enemies.length;
    // ★ 模拟时钟（秒）：一个白天 = 720s（06:00→18:00，12 分钟）；simT 累加的是秒（h），不是毫秒
    hooks.dayT01 = ((R.__rts as { __dayOverride?: number } | undefined)?.__dayOverride ?? (R.__dayOverride as number | undefined)) ?? Math.min(1, simT / 720);
    swarm.update(h, hooks);
    // ★ 事态环单源（用户定）：新引擎 OrderValidator ① 用指挥官（PostureFn）的环——不是自带默认值
    if (shadowBridge) {
      const rg = swarm.data.ring;
      shadowBridge.dbg.ringMin = rg.minD >= 0 ? rg.minD : 0;
      shadowBridge.dbg.ringMax = rg.maxD >= 0 ? rg.maxD : 0;
    }
    // ★ 引擎时钟 = **模拟时钟**（行动/下命令随倍速同步；10× 时 2Hz 拍也×10）
    const nowS = simT;
    shadowBridge?.tick(h, nowS);   // ★ 新引擎拍（唯一指挥链）
    squadCores?.tick(h, nowS, (id) => {   // ★ P2/P4：队长核推进（导航+调遣+汇报）
      const sq = swarm.squads.get(id);
      const lead = sq?.members.get(sq.leaderUid);
      return lead ? { x: lead.x, z: lead.z } : null;
    });
    // ★ 执行态 → 视图由 engineView 按需读取（镜像板已删）
    if (shadowBridge) {
      const list: PanelSquad[] = [];
      for (const r of shadowBridge.squads.all()) list.push({ id: r.id, role: r.role, alive: r.alive, selected: false });
      cmdPanel.setSquads(list);
    }
    spawner.tickDemote(h, cam.tx, cam.tz);     // ★ 远距/出视野 L3 → 降格回池
    spawner.tickReserved(h, cam.tx, cam.tz);   // ★ P-L1：预留名册走近物化（队长单点 → 队长+代理）
    coverLazy.realize(spawn.x, spawn.z, cam.tx, cam.tz, SWARM.L3_RADIUS);   // ★ 工事懒更新：走近物化
    aiCtx.dt = h; aiCtx.time += h;
    aiCtx.target = aiCtx.findTarget('enemy');
    aiCtx.focusX = cam.tx; aiCtx.focusZ = cam.tz;   // ★ AI 激活焦点=相机（RTS 调试：看哪哪活；原=舰船 → 远处手放敌人休眠）
    aiSystem.updateAll(h, aiCtx);
    for (const e of enemies) charClamp.update(e, h);   // ★ 贴地/悬停/掉坑结算
    tactics?.tick(h);   // ★ 战术侧：扇区摊销构建 + 大队编制/部署计划（只读，不发令）
    explosionFx.update(h);
    entities.simulate(h);                      // ★ 实体模拟相（移动/AI/物理同步）
    // ★ 碰撞修正（用户定 2026-09-27）：敌人互相挤压 → **等大反向斥力**（各推一半，限幅）
    {
      const refs: typeof enemies = [];
      const bodies: SepBody[] = [];
      for (const e of enemies) {
        if (e.dead || e.lifeState !== 'active') continue;
        const shape = (e.collisionVolume as unknown as { shape?: Record<string, number> }).shape ?? {};
        const r = Math.max(0.3, shape['radius'] ?? Math.max(shape['hx'] ?? 0.4, shape['hz'] ?? 0.4));
        const yaw = e.faceYaw;
        refs.push(e); bodies.push({ x: e.position.x, z: e.position.z, y: e.position.y, r, dx: Math.sin(yaw), dz: Math.cos(yaw) });
      }
      const pu = separationPushes(bodies);
      for (let i = 0; i < bodies.length; i++) {
        const dx = pu.x[i] as number, dz = pu.z[i] as number;
        if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) continue;
        const b = bodies[i] as SepBody;
        sepHintY = b.y;
        const lim = sepProbe.wetAt(b.x, b.z) ? SHORE_CLIMB_MAX : EDGE_CLIFF_BAND;
        if (!canShift(sepProbe, b.x, b.z, b.y, b.x + dx, b.z + dz, lim)) continue;
        const e = refs[i];
        if (e) { e.entity.position.x = b.x + dx; e.entity.position.z = b.z + dz; }
      }
    }
    physics.step();
    playerBullets.update(h, camera);
    enemyArrows.update(h, camera);
    enemyBolts.update(h, camera);
  };

  const frame = (): void => {
    const now = performance.now();
    const dtR = Math.min(0.05, (now - last) / 1000);
    last = now;
    // ★ 加速（用户定：最高 100×）：**子步进**（每步 ≤0.05s，防高倍速炸物理/AI）
    let rem = Math.min(dtR * speed, 5);   // 每帧最多 5s 模拟
    let guard = 0;
    while (rem > 1e-4 && guard++ < 200) {
      const h = Math.min(0.05, rem);
      simStep(h);
      rem -= h;
      simT += h;
    }
    const dt = dtR;   // 渲染/表现相用实时 dt
    const sp = cam.dist * 0.8 * dt;
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    // ★ W/S 修正：W = 朝屏幕上方（视线方向）前进
    if (keys.has('KeyW') || keys.has('ArrowUp')) { cam.tx -= fx * sp; cam.tz -= fz * sp; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { cam.tx += fx * sp; cam.tz += fz * sp; }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) { cam.tx -= rx * sp; cam.tz -= rz * sp; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { cam.tx += rx * sp; cam.tz += rz * sp; }
    clampArea();
    applyCam();
    chunks.update(cam.tx, cam.tz, dtR, fx, fz);   // 地形流式：实时 dt
    swarm.syncRender(camera, cam.tx, cam.tz);   // ★ FTX 批量渲染同步（每帧）
    // ★ 舰船大蓝圈脉冲（常显）
    const pulse = 1 + Math.sin(performance.now() / 1000 * 1.6) * 0.06;
    shipRing.scale.setScalar(pulse);
    shipRing2.scale.setScalar(2 - pulse);
    shipRingMat.opacity = 0.65 + Math.sin(performance.now() / 1000 * 1.6) * 0.2;
    enemyMgr.update();   // ★ 红圈跟随 + 死亡自动收敛
    enemyPanel.refresh();   // ★ 右侧列表（2Hz 内部节流）
    navMap.update();        // ★ 寻路可视化小地图（M 开关；10Hz 内部节流）
    aiTrace.update(dt);     // ★ AI 可读记录（2Hz 变化采样）
    timeline.refresh();     // ★ 时间轴（2Hz）
    entities.present(dtR);   // ★ 表现相（实时；渲染同步/动画）
    CharacterFxManager.update(dtR, camera);   // ★ 实体 FTX 帧动画/渲染推进
    entities.renderAll(camera);   // ★ 实体渲染阶段（视锥+LOD+贴片/血条/附属特效）
    renderAgents();
    feedLight();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  R.__rts = { raster, phase: 'world', chunks, cam, camera, scene, renderer, spawn, spawner, coverLazy, swarm, mobDefs, physics, entities, copyInfo, get simT(): number { return simT; }, ship: proc.group, combat, enemyArrows, enemyBolts, playerBullets, enemies, aiCtx, shipState, enemyMgr, enemyPanel, navMap, aiTrace, fastLane, hooks, timeline, shadowBridge, engineView, placeEnemyAt, forceMoveSelectionTo, goneLog, squadCores, climbStats: { core: CLIMB_STATS, route: CLIMB_ROUTE_STATS, trace: CLIMB_TRACE, book: () => climbBook.size },
    tactics: { sectors: tactics?.sectors ?? null, battalions: tactics?.battalions ?? null, get mainSectors(): number[] { return tactics?.mainSectors ?? []; }, setMainSectors(k: number[]): void { if (tactics) tactics.mainSectors = k; } }, get speed(): number { return speed; },
    /** ★ 新引擎调试口契约（重写 P4；G9）：一次取全新架构快照（UI/探针只读） */
    newEngine: shadowBridge ? () => ({
      ticks: shadowBridge!.dbg.ticks,
      shadow: shadowBridge!.shadow,
      spread: shadowBridge!.dbg.spread,
      refreshed: shadowBridge!.dbg.refreshed,
      squads: { ...shadowBridge!.squads.dbg },
      melee: { ...shadowBridge!.melee.dbg },
      ranged: { ...shadowBridge!.ranged.dbg },
      flyer: { ...shadowBridge!.flyer.dbg },
      engineer: { ...shadowBridge!.engineer.dbg, ...shadowBridge!.engineer.fortDbg },
      writer: { ...shadowBridge!.writer.dbg },
      protect: { ...shadowBridge!.protect.dbg },
      queues: { ...shadowBridge!.queues.dbg },
      timers: { ...shadowBridge!.timers.dbg },
      pos: { ...shadowBridge!.pos.dbg },
      sectors: { ...shadowBridge!.sectors.dbg },
    }) : null };
}

// ---- 严格分流：直进 或 先选点（进世界前 await rapier + 敌军素材）----
const enter = (x: number, z: number): void => {
  void (async () => {
    await ensureRapierReady();
    const mobAssets: EnemyAssetEntry[] = [];
    for (const spec of ENEMY_ROSTER) {
      try {
        mobAssets.push({ id: spec.id, asset: await FtxAsset.load(enemyAssetUrl(spec)) });
      } catch {
        console.warn(`[rts] 敌军素材缺失：${spec.id}（本兵种不生成）`);
      }
    }
    console.log(`[rts] 敌军素材 ${mobAssets.length}/${ENEMY_ROSTER.length}`);
    let hitEffects: HitEffectShapeExport[] = [];
    try {
      const hitAsset = await Asset.load(encodeURI('/fx/bullets/主角子弹击中特效.scene.zip'));
      hitEffects = hitAsset.hitEffects;
    } catch {
      console.warn('[rts] 命中特效素材缺失（弹道仍可用）');
    }
    startWorld(x, z, mobAssets, hitEffects);
  })();
};
if (UX !== null && UZ !== null) {
  enter(Number(UX), Number(UZ));
} else {
  const sel = new SpawnSelect(raster, WORLD_R);
  R.__rts = { raster, phase: 'select', select: sel };
  sel.onConfirm = (x, z) => enter(x, z);
  sel.onPick = (x, z) => { zoneShip.x = x; zoneShip.z = z; };   // ★ 选点阶段：点哪画哪（防区调试视图）
  // ★ 实时换图：新种子 → 新 RasterMap → 小地图重绘（仍留在阶段 A，无 3D）
  sel.onSeed = (s) => {
    raster = new RasterMap(s);
    sel.setRaster(raster);
    R.__rts = { raster, phase: 'select', select: sel };
  };
}
