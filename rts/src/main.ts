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
import { OrderBus } from './order/OrderBus';
import { SpawnSelect } from './ui/SpawnSelect';
import { SwarmSystem } from './systems/swarm/SwarmSystem';
import { PhysicsWorld, ensureRapierReady } from './services/physics/PhysicsWorld';
import { EntityManager } from './entity/EntityManager';
import { addStaticObstacle, removeStaticObstacle } from './services/physics/StaticObstacleRegistry';
import { CHUNK_SIZE } from './services/map/ChunkGenerator';
import { ENEMY_ROSTER, enemyAssetUrl, type EnemyAssetEntry } from './config/enemyRoster';
import { FtxAsset } from './vendor/player/FtxAsset';
import { buildProceduralShip, SHIP_LENGTH } from './entity/ship/proceduralShip';
import { EnemyBase } from './entity/EnemyBase';
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
import { buildEnemyCover } from './modes/world/EnemyCoverBuild';
import { footSinkRatioOf } from './services/fx/FootAnchor';
import { CharacterClamp } from './systems/world/CharacterClamp';
import { EnemyManager } from './ui/EnemyManager';
import { EnemyListPanel } from './ui/EnemyListPanel';
import { NavDebugMap } from './ui/NavDebugMap';
import { AiTrace } from './debug/AiTrace';
import { FastLane } from './rts/FastLane';
import { Timeline } from './ui/Timeline';
import { GAME_MIN, REWRITE_ON } from './systems/swarm/SwarmConfig';
import { EngineBridge, type LiveSquad } from './systems/swarm/engine/EngineBridge';
import { SquadRegistry } from './systems/swarm/squad/SquadRegistry';
import { createSquadNav } from './systems/swarm/squad/MarchAction';
import { CommandPanel, type PanelSquad } from './ui/CommandPanel';
import type { SquadOrder, SquadReport } from './systems/swarm/engine/contracts';
import { pickSteer, steerDbg, steerScores } from './entity/SteerPick';

const q = new URLSearchParams(location.search);
const SEED = Number(q.get('seed') ?? 4242);
const UX = q.get('x');
const UZ = q.get('z');
/** ★ 固定世界（±4 chunk ×60m = 480m 见方；地形一次性加载） */
const WORLD_R = 4 * 60 - 20;
const R = globalThis as unknown as Record<string, unknown>;

// ---- 阶段 A 起点：只建数据层（无 3D）----
let raster = new RasterMap(SEED);
R.__rts = { raster, phase: 'select' };

function startWorld(spawnX: number, spawnZ: number, mobAssets: EnemyAssetEntry[], hitEffects: HitEffectShapeExport[]): void {
  const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
  const spawn = { x: spawnX, z: spawnZ };

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
  entities.create({
    kind: 'ship', x: spawn.x, y: shipY + 0.8, z: spawn.z,
    physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: SHIP_LENGTH / 2, hy: 0.8, hz: 1.2 } } },
  });
  const orders = new OrderBus(scene);

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
    bossEntity: null, bossRun: false, threat: { setThreat: () => {} }, spawnChunkKey: 0, scalingInputs: null,
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
  // ★ 指挥器端口接线（兵力创建/工事全权在指挥层；spawnMob/spawnBuilder/buildCover/digTrench）
  wireCommanderPorts({
    commander: swarm.commander, spawner, raster, mobDefs, entities, scene, chunks,
    surfaceAt: (x, z) => raster.surfaceHeightAtFor(x, z, 0),
    playerPos: () => ({ x: spawn.x, z: spawn.z }),   // ★ 目标 = 舰船（非相机）
  });
  hooks.mobTactics = (mi) => mobDefs[mi]?.tactics ?? null;
  // ★ 掩体朝向修正（用户定 2026-09-25）：正面朝**舰船**（威胁来源），而非登陆点地形来向
  swarm.commander.buildCover = (x, z, v) =>
    buildEnemyCover(entities, scene, x, raster.surfaceHeightAtFor(x, z, 0), z, v, swarm.commander.defensePlan, { x: spawn.x, z: spawn.z });
  // ★ 事态环形夹取：**引擎令 + 队长自主令同门**（SquadTactics.issue 内夹取）
  swarm.tactics.ringClamp = (x, z) => swarm.commander.clampToRing(x, z);

  // ★ 官方升降格/命令/队长镜像（WorldSpawner 实现 SwarmTierPort）
  hooks.tierPort = spawner;
  hooks.activeUnits = () => enemies;
  hooks.onDirective = (uid, order, directive, until) =>
    spawner.applyOrderToEntity(uid, order, directive, until);
  hooks.onLeaderChanged = (uid, isLeader) => spawner.setLeaderFlag(uid, isLeader);
  // ★ 近战伤害（代理侧钩子）：目标=舰船（1）扣舰船血量；玩家（0）暂无实体
  let shipHp = 1000;
  hooks.melee = (targetKind, dmg, x, z) => {
    if (targetKind !== AGENT_TARGET_SHIP) return;
    if (Math.hypot(x - spawn.x, z - spawn.z) <= SHIP_LENGTH / 2 + 2) shipHp = Math.max(0, shipHp - dmg);
  };
  // ★ 新引擎接线（重写 P3/P4）：默认真下发；`?shadow=1` 只算不发；`?swarm=old` 回退旧链
  let shadowBridge: EngineBridge | null = null;
  let squadCores: SquadRegistry | null = null;
  if (REWRITE_ON) {
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
          out.push({ id: sq.id, role, x: lx, z: lz, alive: Math.max(0, sq.members.size - sq.casualties), hpRatio: sm > 0 ? sh / sm : 1 });
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
      // ★ 正式启用（用户定）：新引擎决策 → 旧执行链（队长消费）。
      //   命令映射：act/march→advance、defend/garrison→garrison、protect→protect、patrol→flank。
      //   工兵照旧：新引擎不给工兵发移动令（工事由旧指挥官派件、工兵内部决策）。
      emit: (squadId, order, now) => {
        const kindMap: Record<string, string> = {
          act: 'advance', march: 'advance', defend: 'garrison',
          garrison: 'garrison', protect: 'protect', patrol: 'flank',
        };
        swarm.tactics.issue(squadId, {
          kind: (kindMap[order.kind] ?? 'advance') as never,
          target: { x: order.target.x, z: order.target.z },
          mission: 'engine',
          anchor: order.anchor,
          threatX: order.threat?.x,
          threatZ: order.threat?.z,
          seq: 0,
          roe: order.roe,
        } as never, now, 6, 'engine');
        squadCores?.accept(squadId, order);   // ★ P2：队长核接令（分流/汇报）
      },
    });
    // ★ 正式启用（用户定 2026-09-25：**正常就用新链**）：默认 shadow=false（新引擎真下发）；
    //   `?shadow=1` 只跑影子（新引擎只算不发，用于对照/调试）
    shadowBridge.shadow = new URLSearchParams(location.search).get('shadow') === '1';
    // ★ 队长核（重写 P2）：实机队长接令/分流/汇报；位置单源 = 队长
    const leaderPosOf = (id: number): { x: number; z: number } | null => {
      const sq = swarm.squads.get(id);
      const lead = sq?.members.get(sq.leaderUid);
      return lead ? { x: lead.x, z: lead.z } : null;
    };
    const roleOf = (id: number): 'engineer' | 'flyer' | 'ranged' | 'melee' => {
      const sq = swarm.squads.get(id);
      const def = sq ? mobDefs[sq.mobKind] as { role?: string; isAir?: boolean } | undefined : undefined;
      return sq?.builders ? 'engineer' : def?.isAir ? 'flyer' : def?.role === 'ranged' ? 'ranged' : 'melee';
    };
    squadCores = new SquadRegistry(
      (id) => createSquadNav({ leaderPos: leaderPosOf, walkableLine: (a, b, c2, d2) => swarm.walkableLine(a, b, c2, d2) }, id),
      roleOf,
      (r: SquadReport, now: number) => shadowBridge?.squads.report(r, now),
      (id: number) => {
        const sq = swarm.squads.get(id);
        return sq ? Math.max(0, sq.members.size - sq.casualties) : 0;
      },
    );
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
    orders.issue({ kind: kind as never, target, source: 'player', roe: 'engage', ttl: 6 });
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
  const enemyPanel = new EnemyListPanel(swarm, enemyMgr, ENEMY_ROSTER.map((s) => s.name));
  // ★ 寻路可视化小地图（走廊/起点/终点/队令/队长；M 键开关）
  const navMap = new NavDebugMap(raster, swarm, () => ({ x: spawn.x, z: spawn.z }));
  enemyPanel.onInspectCommand = (sid, entry) => navMap.open(sid, entry ? { x: entry.tx, z: entry.tz } : undefined);
  // ★ AI 可读记录器（命令/指令/寻路/生死；Y=下载 JSONL，U=控制台打印中文摘要）
  const aiTrace = new AiTrace(swarm, enemies, SEED, ENEMY_ROSTER.map((s) => s.name), orders);
  // ★ 快车道结算（代理直扣 / 实体走管线）；K = 对相机中心 18m 内造成 15 伤害（演示/测试口）
  const fastLane = new FastLane(swarm, enemies);
  // ★ 时间轴（拖动 = 绝对当日进度；事态/闸门/命令随之重算）
  const timeline = new Timeline(swarm.commander);
  timeline.onChange = () => { navMap.redrawNow(); enemyPanel.refreshNow(); };   // ★ 时间轴一动：小地图/列表立即重绘
  // ★ 贴地/悬停/掉坑结算（原 WorldMode：玩家 + 每个敌人实体每帧）
  const charClamp = new CharacterClamp({
    raster,
    player: null as unknown as Parameters<typeof CharacterClamp.prototype.update>[0],
    clampVehicle: () => {},
    platformTopAt: () => null,
  });
  const t0Ms = performance.now();
  // ★ 加速（用户定 2026-09-25）：只跑 AI 性能开销小；dt 缩放，日进度走**模拟时钟**
  let speed = 1;
  let simT = 0;
  R.__setSpeed = (v: number): void => { speed = Math.max(1, Math.min(100, v)); };
  // ★ 指挥器建计划：**敌方登陆点**（距舰 ~160m 的可行方向）——不能在舰旁布防/刷兵
  const pickEnemyLanding = (): { x: number; z: number } => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = spawn.x + Math.cos(a) * 160;
      const z = spawn.z + Math.sin(a) * 160;
      if (swarm.commander.blockedAt(x, z)) continue;
      if (raster.surfaceHeightAtFor(x, z, 0) < -1.0) continue;
      return { x, z };
    }
    return { x: spawn.x + 160, z: spawn.z };
  };
  const landing = pickEnemyLanding();
  try {
    // ★ 建表半径必须**覆盖舰船**（长行军目标=舰；否则目标在表外 → 长寻路回落失败）
    const tableR = Math.min(240, Math.ceil(Math.hypot(landing.x - spawn.x, landing.z - spawn.z)) + 60);
    swarm.commander.planDefense(landing.x, landing.z, tableR);
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
  // ★ 不再手工铺环：兵力全部由指挥器（planDefense → 端口 spawnMob）按**进攻轴向**创建
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
  const placeEnemyAt = (x: number, z: number): boolean => {
    const def = mobDefs.find((d) => d.canBuild !== true && d.isAir !== true) ?? mobDefs[0];
    return def ? spawner.spawnOne(def, x, 0, z, undefined, -1, true) : false;
  };
  /** ★ 强制移动令（玩家源；选中队全体 advance）→ 返回发令队数（调试接口，探针同口） */
  const forceMoveSelectionTo = (x: number, z: number): number => {
    const seen = new Set<number>();
    const nowS = performance.now() / 1000;
    for (const hh of enemyMgr.selected()) {
      const sq = swarm.squads.squadOf(hh.uid);
      if (!sq || seen.has(sq.id)) continue;
      seen.add(sq.id);
      swarm.tactics.issue(sq.id,
        { kind: 'advance', target: { x, z }, anchor: { x, z }, roe: 'engage', seq: 0 },
        nowS, 30 * GAME_MIN, 'player');
      orders.issue({ kind: 'advance', target: { x, z }, source: 'player', roe: 'engage', ttl: 30 * GAME_MIN });
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
    if (e.code === 'Comma') speed = Math.max(1, speed / 2);
    if (e.code === 'Period') speed = Math.min(100, speed * 2);
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
        orders.issue({ kind: 'advance', target: { x: hit.point.x, z: hit.point.z }, source: 'player', roe: 'engage', ttl: 6 });
        // ★ 玩家手动命令（重写 P3；用户定）：新引擎经唯一发令器 + player 旁路 → **只给队长**
        //   （60m 内的小队收令；影子模式只记账，`?swarm=new` 时可在 __rts.newEngine() 看到）
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
    const fx2 = Math.sin(cam.yaw), fz2 = Math.cos(cam.yaw);
    hooks.camForwardX = fx2; hooks.camForwardZ = fz2;
    hooks.playerX = spawn.x; hooks.playerZ = spawn.z;   // ★ 代理索敌 = 舰船
    hooks.entityCount = enemies.length;
    hooks.dayT01 = ((R.__rts as { __dayOverride?: number } | undefined)?.__dayOverride ?? (R.__dayOverride as number | undefined)) ?? Math.min(1, simT / 720000);
    swarm.update(h, hooks);
    shadowBridge?.tick(h, simT / 1000);   // ★ 新引擎拍（默认真下发；?shadow=1 只算不发）
    squadCores?.tick(h, simT / 1000, (id) => {   // ★ P2：队长核推进（队长位置单源）
      const sq = swarm.squads.get(id);
      const lead = sq?.members.get(sq.leaderUid);
      return lead ? { x: lead.x, z: lead.z } : null;
    });
    if (shadowBridge) {
      const list: PanelSquad[] = [];
      for (const r of shadowBridge.squads.all()) list.push({ id: r.id, role: r.role, alive: r.alive, selected: false });
      cmdPanel.setSquads(list);
    }
    spawner.tickDemote(h, cam.tx, cam.tz);     // ★ 远距/出视野 L3 → 降格回池
    aiCtx.dt = h; aiCtx.time += h;
    aiCtx.target = aiCtx.findTarget('enemy');
    aiCtx.focusX = cam.tx; aiCtx.focusZ = cam.tz;   // ★ AI 激活焦点=相机（RTS 调试：看哪哪活；原=舰船 → 远处手放敌人休眠）
    aiSystem.updateAll(h, aiCtx);
    for (const e of enemies) charClamp.update(e, h);   // ★ 贴地/悬停/掉坑结算
    explosionFx.update(h);
    entities.simulate(h);                      // ★ 实体模拟相（移动/AI/物理同步）
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

  R.__rts = { raster, phase: 'world', chunks, cam, camera, scene, renderer, spawn, orders, swarm, physics, entities, ship: proc.group, combat, enemyArrows, enemyBolts, playerBullets, enemies, aiCtx, shipState, enemyMgr, enemyPanel, navMap, aiTrace, fastLane, hooks, timeline, shadowBridge, placeEnemyAt, forceMoveSelectionTo, pickSteer, steerDbg, steerScores, get speed(): number { return speed; },
    /** ★ 新引擎调试口契约（重写 P4；G9）：一次取全新架构快照（UI/探针只读） */
    newEngine: shadowBridge ? () => ({
      ticks: shadowBridge!.dbg.ticks,
      shadow: shadowBridge!.shadow,
      squads: { ...shadowBridge!.squads.dbg },
      melee: { ...shadowBridge!.melee.dbg },
      ranged: { ...shadowBridge!.ranged.dbg },
      flyer: { ...shadowBridge!.flyer.dbg },
      engineer: { ...shadowBridge!.engineer.dbg },
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
  // ★ 实时换图：新种子 → 新 RasterMap → 小地图重绘（仍留在阶段 A，无 3D）
  sel.onSeed = (s) => {
    raster = new RasterMap(s);
    sel.setRaster(raster);
    R.__rts = { raster, phase: 'select', select: sel };
  };
}
