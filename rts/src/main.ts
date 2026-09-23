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
import type { SwarmTierPort } from './systems/swarm/SwarmTierPort';
import { ENEMY_BY_ID } from './config/enemyRoster';
import type { AgentSnapshot } from './systems/swarm/AgentPool';
import type { SwarmHooks } from './systems/swarm/SwarmSystem';
import { AGENT_TARGET_SHIP } from './systems/swarm/AgentPool';
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
  entities.create({
    kind: 'ship', x: spawn.x, y: shipY + 0.8, z: spawn.z,
    physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: SHIP_LENGTH / 2, hy: 0.8, hz: 1.2 } } },
  });
  const orders = new OrderBus(scene);

  // ---- ★ 敌人（R1c 最小接线）：SwarmSystem 指挥链 + 自渲染胶囊（无物理/无战斗） ----
  const swarm = new SwarmSystem();
  // ★ FTX 精细贴图批量渲染（每兵种图集 + InstancedMesh；替代胶囊）
  let batchOn = false;
  if (mobAssets.length > 0) {
    try {
      swarm.buildBatch(scene, mobAssets.map((m) => m.asset));
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
  // ---- ★ L3 实体敌人（tierPort）：代理 ↔ EnemyBase 双向换载体 ----
  const assetById = new Map(mobAssets.map((m) => [m.id, m.asset]));
  const byUid = new Map<number, EnemyBase>();
  const animMap = {
    states: { idle: { 前: ['前'], 后: ['后'] }, walk: { 前: ['前'], 后: ['后'] }, attack: { 前: ['前'], 后: ['后'] } },
    fps: { idle: 1, walk: 1, attack: 1 },
  };
  const tierPort: SwarmTierPort = {
    promote: (snap: AgentSnapshot) => {
      const spec = ENEMY_ROSTER[snap.mobIndex];
      const asset = spec ? assetById.get(spec.id) : undefined;
      if (!spec || !asset) return;
      // ★ 快照字段兜底（缺省/NaN → 用名册上限），否则血条比例 NaN = 空条
      const snapMax = Number.isFinite(snap.maxHp) && snap.maxHp > 0 ? snap.maxHp : spec.hp;
      const snapHp = Number.isFinite(snap.hp) && snap.hp > 0 ? snap.hp : snapMax;
      const enemy = new EnemyBase(entities, scene, asset, {
        x: snap.x, y: snap.y, z: snap.z, animMap, facing: '前', aiConfig: spec.ai,
        hp: snapMax, defense: snap.defense, attackPower: spec.attackPower,
        scale: spec.scale, collisionScale: spec.collisionScale,
      }, camera);
      enemy.hydrate(snap);
      enemy.maxHp = snapMax;
      enemy.hp = Math.min(snapHp, snapMax);
      if (snap.uid > 0) byUid.set(snap.uid, enemy);
    },
    demote: (enemy: EnemyBase) => {
      const uid = enemy.swarmUid;
      byUid.delete(uid);
      const x = enemy.position.x, y = enemy.position.y, z = enemy.position.z;
      entities.destroy(enemy.id);
      const spec = ENEMY_ROSTER[0]!;
      swarm.spawn({
        uid, mobIndex: 0, x, y, z, hp: spec.hp, maxHp: spec.hp,
        defense: spec.defense, attackPower: spec.attackPower, speed: 4.5,
        meleeDamage: 2, meleeRange: 1.5, scale: spec.scale,
        tier: 1, aggro: 0, wanderSpeed: 1.2,
      }, true);
    },
  };
  hooks.tierPort = tierPort;
  hooks.activeUnits = () => [...byUid.values()];
  // ★ 命令下发到 L3 实体（原游戏 WorldSpawner.applyOrderToEntity 同款）
  hooks.onDirective = (uid, order, directive, until) => {
    const e = byUid.get(uid);
    if (!e || e.dead) return;
    e.applyOrder(
      { kind: order.kind, targetX: order.target?.x ?? 0, targetZ: order.target?.z ?? 0, until, seq: order.seq },
      {
        kind: directive.kind, targetX: directive.targetX ?? 0, targetZ: directive.targetZ ?? 0,
        wardUid: directive.wardUid ?? 0, until: directive.until,
        fire: 0, speedMul: directive.speedMul, seq: directive.seq,
      },
    );
  };
  hooks.onLeaderChanged = (uid, isLeader) => {
    const e = byUid.get(uid);
    if (e && !e.dead) e.isLeader = isLeader;
  };
  hooks.onAgentKilled = (mobIndex, x, y, z) => { void mobIndex; void x; void y; void z; };

  // ---- ★ 世界刷怪器（原游戏 WorldSpawner）：指挥器端口的实现载体 ----
  const mobDefs: MobDef[] = mobAssets.map(({ id, asset }) => {
    const spec = ENEMY_BY_ID.get(id) ?? ENEMY_ROSTER[0]!;
    return {
      id: spec.id, name: spec.name, asset,
      ai: spec.ai, hp: spec.hp, defense: spec.defense, attackPower: spec.attackPower,
      scale: spec.scale, collisionScale: spec.collisionScale,
      pack: spec.pack, weight: spec.weight, drops: spec.drops,
      groundSink: spec.groundSink ?? 0,
      isAir: spec.isAir === true,
      airAltitude: spec.airAltitude ?? 2,
      billboard: spec.billboard,
      role: spec.role, attackType: spec.attackType,
      suicide: spec.suicide, squadMode: spec.squadMode, noDemote: spec.noDemote,
      elite: spec.elite, canBuild: spec.canBuild, tactics: spec.tactics,
    } as MobDef;
  });
  const spawner = new WorldSpawner({
    enemies: [...byUid.values()],
    enemyDefs: new WeakMap(),
    mobDefs,
    bossEntity: null, bossRun: false, threat: null, spawnChunkKey: 0, scalingInputs: null,
    enemyScale: { hp: 1, atk: 1, def: 0 },
    player: null, ship: null, entities, swarm, swarmDirector: null,
    chunks, raster, session: null, scene, camera,
    drones: [], worldUIManager: null,
    testChunk: false, shipDestroyed: false, bossAsset: null,
    showFloatingAt: () => {}, syncSceneBgm: () => {}, returnToBase: () => {},
  } as unknown as SpawnDeps);
  // ★ 指挥器端口接线（兵力创建/工事全权在指挥层；spawnMob/spawnBuilder/buildCover/digTrench）
  wireCommanderPorts({
    commander: swarm.commander, spawner, raster, mobDefs, entities, scene, chunks,
    surfaceAt: (x, z) => raster.surfaceHeightAtFor(x, z, 0),
    playerPos: () => ({ x: cam.tx, z: cam.tz }),
  });
  hooks.mobTactics = (mi) => mobDefs[mi]?.tactics ?? null;
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
    swarm.commander.planDefense(landing.x, landing.z, 80);
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

  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'BracketLeft') cam.pitch = clamp(cam.pitch + 0.08, 0.12, 1.45);
    if (e.code === 'BracketRight') cam.pitch = clamp(cam.pitch - 0.08, 0.12, 1.45);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  let dragging = false, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', (e) => {
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
  // 右键发令（玩家手动令入口）
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObjects(scene.children, true)[0];
    if (!hit) return;
    const kind = e.altKey ? 'build' : e.shiftKey ? 'garrison' : 'advance';
    orders.issue({ kind, target: { x: hit.point.x, z: hit.point.z }, source: 'player', roe: 'engage', ttl: 6 });
  });
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
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
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
    chunks.update(cam.tx, cam.tz, dt, fx, fz);
    // ★ 敌人指挥链推进 + 实体/批量渲染
    hooks.camForwardX = fx; hooks.camForwardZ = fz;
    hooks.playerX = cam.tx; hooks.playerZ = cam.tz;
    hooks.entityCount = byUid.size;
    swarm.update(dt, hooks);
    swarm.syncRender(camera, cam.tx, cam.tz);   // ★ FTX 批量渲染同步（每帧）
    entities.update(dt, undefined, { forward: { x: fx, z: fz }, right: { x: rx, z: rz } });
    physics.step();
    playerBullets.update(dt, camera);
    enemyArrows.update(dt, camera);
    enemyBolts.update(dt, camera);
    CharacterFxManager.update(dt, camera);   // ★ 实体 FTX 帧动画/渲染推进
    entities.renderAll(camera);   // ★ 实体渲染阶段（视锥+LOD+贴片/血条/附属特效）
    renderAgents();
    feedLight();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  R.__rts = { raster, phase: 'world', chunks, cam, camera, scene, renderer, spawn, orders, swarm, physics, entities, ship: proc.group, combat, enemyArrows, enemyBolts, playerBullets, l3: byUid };
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
