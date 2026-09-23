// ============================================================
// RTS 主入口（R0 骨架）：种子直开地形 + 2.5D 俯视相机（无主角/无飞机落地）
// 用法：?seed=4242&x=120&z=-80（出生地自己调；缺省 seed 4242 / (120,-80)）
// ============================================================
import * as THREE from 'three';
import { RasterMap } from './services/map/RasterMap';
import { ChunkManager } from './services/map/ChunkManager';
import type { ChunkGroundHost } from './services/map/decor/MapEntityDecorBase';
import { SunCycle } from './services/render/SunCycle';
import { updateTerrainLighting, updateWallMaterialsLighting } from './services/map/TerrainMaterial';
import { updateApronLighting } from './services/map/decor/PlatformApron';
import { OrderBus } from './order/OrderBus';

(globalThis as unknown as Record<string, unknown>).__rtsBoot = 'module-start';
const q = new URLSearchParams(location.search);
const SEED = Number(q.get('seed') ?? 4242);
/** ★ 出生点（URL ?x=&z= 或双击地面重选；仅决定指挥/表窗起点） */
const spawn = { x: Number(q.get('x') ?? 0), z: Number(q.get('z') ?? 0) };
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** ★ 固定世界（一次性加载，±4 chunk ×60m = 480m 见方；不流式创建/销毁） */
const WORLD_R = 4 * 60 - 20;
/** ★ 开局=选点阶段（整图俯视，点地面定出生点） */
const ui = { phase: 'select' as 'select' | 'play' };
const clampArea = (): void => {
  cam.tx = clamp(cam.tx, -WORLD_R, WORLD_R);
  cam.tz = clamp(cam.tz, -WORLD_R, WORLD_R);
};

// ---- 渲染器 / 场景 / 相机 ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe3ee, 300, 1100);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 8000);

/** RTS 相机（俯视为主，可压到近水平） */
const cam = { tx: 0, tz: 0, dist: 620, yaw: Math.PI * 0.25, pitch: 1.45 };
function applyCam(): void {
  const ch = Math.cos(cam.pitch) * cam.dist;
  camera.position.set(cam.tx + Math.sin(cam.yaw) * ch, Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * ch);
  camera.lookAt(cam.tx, 0, cam.tz);
}

// ---- 地形：物理宿主本阶段空实现（无单位无碰撞）----
const host: ChunkGroundHost = {
  createGround: () => -1,
  destroyGround: () => {},
  createGroundCells: () => null,
};
const raster = new RasterMap(SEED);
const chunks = new ChunkManager(scene, raster, host);
chunks.setWaterVisible(true);
chunks.bootstrap(spawn.x, spawn.z);
const orders = new OrderBus(scene);   // ★ R1：命令单源（台账+令牌）

// ---- 光照（固定正午；地形吃 baked 光照 uniform）----
const sun = new SunCycle();
sun.reset(10);
function feedLight(): void {
  updateTerrainLighting(sun.current);
  updateWallMaterialsLighting(sun.current);
  updateApronLighting(sun.current);
}

// ---- 输入 ----
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'BracketLeft') cam.pitch = clamp(cam.pitch + 0.08, 0.12, 1.45);
  if (e.code === 'BracketRight') cam.pitch = clamp(cam.pitch - 0.08, 0.12, 1.45);
});
addEventListener('keyup', (e) => keys.delete(e.code));
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // ★ 玩家手动发令（R1 第一版）：右键=advance、Alt+右键=build、Shift+右键=garrison
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = rc.intersectObjects(scene.children, true)[0];
  if (!hit) return;
  const kind = e.altKey ? 'build' : e.shiftKey ? 'garrison' : 'advance';
  orders.issue({ kind, target: { x: hit.point.x, z: hit.point.z }, source: 'player', roe: 'engage', ttl: 6 });
});
let downX = 0, downY = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY; });
addEventListener('mouseup', (e) => {
  dragging = false;
  // ★ 选点阶段：点击（非拖拽）地面 = 确定出生点 → 进正式视角（地形已一次性加载）
  if (ui.phase === 'select' && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObjects(scene.children, true)[0];
    if (hit) {
      spawn.x = hit.point.x; spawn.z = hit.point.z;
      ui.phase = 'play';
      cam.tx = spawn.x; cam.tz = spawn.z; cam.dist = 150; cam.pitch = 0.95;
      clampArea();
    }
  }
});
// ★ 双击地面 = 重选出生点（加载窗随之移动）
addEventListener('dblclick', (e) => {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = rc.intersectObjects(scene.children, true)[0];
  if (!hit) return;
  spawn.x = hit.point.x; spawn.z = hit.point.z;
  cam.tx = spawn.x; cam.tz = spawn.z;
  clampArea();
});
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (e.shiftKey || (e.buttons & 4) !== 0) {
    cam.yaw -= dx * 0.005;
    cam.pitch = clamp(cam.pitch + dy * 0.004, 0.12, 1.45);
    return;
  }
  const k = cam.dist * 0.0022;   // 拖拽平移（随缩放）
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  cam.tx -= (rx * dx + fx * dy) * k;   // ★ 上下修正：拖下 = 视角后退（世界跟手下移）
  cam.tz -= (rz * dx + fz * dy) * k;
  clampArea();
});
addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 25, 900); }, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- 主循环 ----
let last = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sp = cam.dist * 0.8 * dt;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  if (keys.has('KeyW') || keys.has('ArrowUp')) { cam.tx += fx * sp; cam.tz += fz * sp; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { cam.tx -= fx * sp; cam.tz -= fz * sp; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { cam.tx -= rx * sp; cam.tz -= rz * sp; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { cam.tx += rx * sp; cam.tz += rz * sp; }
  clampArea();   // ★ 只加载/显示出生点表窗范围（80m）
  applyCam();
  chunks.update(cam.tx, cam.tz, dt, fx, fz);
  feedLight();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// 调试句柄（探针/控制台）
(window as unknown as Record<string, unknown>).__rts = { raster, chunks, cam, camera, scene, renderer, spawn, orders };
