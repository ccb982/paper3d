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

function startWorld(spawnX: number, spawnZ: number): void {
  const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
  const spawn = { x: spawnX, z: spawnZ };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe3ee, 300, 1100);
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

  const host: ChunkGroundHost = {
    createGround: () => -1,
    destroyGround: () => {},
    createGroundCells: () => null,
  };
  const chunks = new ChunkManager(scene, raster, host);
  chunks.setWorldCenter(spawn.x, spawn.z);   // ★ 生成区域中心 = 出生点
  chunks.setCoarseMode(false);   // ★ 探索期：近处细块 + 远景粗块 LOD（coarseOnly=false 才投细化）
  chunks.setWaterVisible(true);
  chunks.bootstrap(spawn.x, spawn.z);
  const orders = new OrderBus(scene);

  // ---- ★ 敌人（R1c 最小接线）：SwarmSystem 指挥链 + 自渲染胶囊（无物理/无战斗） ----
  const swarm = new SwarmSystem();
  const hooks = {
    playerX: spawn.x, playerZ: spawn.z, shipX: spawn.x, shipZ: spawn.z,
    camForwardX: 0, camForwardZ: 1,
    // ★ 未接 L3 实体管线前：把 entityCount 顶满 → 关"近玩家升格"（否则代理被移除后 promote 空转=蒸发）
    entityCount: 1e9,
    melee: () => {},
  };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = spawn.x + Math.cos(a) * 30, z = spawn.z + Math.sin(a) * 30;
    const y = raster.surfaceHeightAtFor(x, z, 0);
    const mob = i % 2;   // 0=原石虫 / 1=整合运动（名册下标）
    swarm.spawn({
      mobIndex: mob, x, y, z,
      hp: mob === 0 ? 22 : 75, maxHp: mob === 0 ? 22 : 75,
      defense: mob === 0 ? 0 : 3, attackPower: mob === 0 ? 0 : 2,
      speed: 4.5, meleeDamage: 2, meleeRange: 1.5, scale: 1.6,
      tier: 1, aggro: 0, wanderSpeed: 1.2,
    }, true);
  }
  const unitMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.6, 1.4, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0xcc4433 }),
    256,
  );
  unitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  unitMesh.frustumCulled = false;
  scene.add(unitMesh);
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
    // ★ 敌人指挥链推进 + 胶囊渲染
    hooks.camForwardX = fx; hooks.camForwardZ = fz;
    hooks.playerX = cam.tx; hooks.playerZ = cam.tz;
    swarm.update(dt, hooks);
    renderAgents();
    feedLight();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  R.__rts = { raster, phase: 'world', chunks, cam, camera, scene, renderer, spawn, orders, swarm };
}

// ---- 严格分流：直进 或 先选点 ----
if (UX !== null && UZ !== null) {
  startWorld(Number(UX), Number(UZ));
} else {
  const sel = new SpawnSelect(raster, WORLD_R);
  R.__rts = { raster, phase: 'select', select: sel };
  sel.onConfirm = (x, z) => startWorld(x, z);
  // ★ 实时换图：新种子 → 新 RasterMap → 小地图重绘（仍留在阶段 A，无 3D）
  sel.onSeed = (s) => {
    raster = new RasterMap(s);
    sel.setRaster(raster);
    R.__rts = { raster, phase: 'select', select: sel };
  };
}
