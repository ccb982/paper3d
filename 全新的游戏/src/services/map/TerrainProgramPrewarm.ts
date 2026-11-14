// ============================================================
// TerrainProgramPrewarm —— 精细地形/侧壁 shader program 的异步预热
// ============================================================
// ★ 背景（2026-11-14 修「舰船落地卡顿」）：
//   顶面(TerrainMaterial)与侧壁(WallMaterial)的片元着色器各 46KB / 43KB
//   —— MATERIAL_GLSL 内联了 14 种材质的「全量 + 高频」两套函数。AMD 驱动
//   首次编译链接各需 5~6 秒。
//   航行期只渲染粗块(MeshBasicMaterial)，这两个 program 直到落地切细化才
//   **第一次**被渲染 → three 在 new WebGLUniforms() 里同步查 ACTIVE_UNIFORMS
//   → 主线程死等驱动链接完成（实测单帧 longtask 15727ms）→ 落地必卡。
//
// ★ 做法：把「驱动侧编译」提前到玩家还在基地/航行时就开始，落地时零等待。
//   · three 的 renderer.compileAsync 走 KHR_parallel_shader_compile：
//     glLinkProgram 立即返回，驱动在后台线程编译，主线程全程不阻塞
//     （实测本机 glLinkProgram 仅 6ms，耗时全落在之后的同步等待上）。
//   · 编译完成后 program 已就绪；落地首帧的 uniform 反射查询立即返回，
//     不再有同步点。
//   · program 缓存键 = 着色器源码 + 灯光/雾/色彩空间 + **geometry 派生位**
//     等状态；预热必须与 chunk 真实材质同键 → 命中同一个 program 直接复用。
//     ★ geometry 属性集必须与真实 chunk 地形一致（见下方注释）：
//       缓存键含 vertexNormals（有无 normal 属性，位 23）等 geometry 派生位，
//       少一个属性就换一份 program → 预热白费、落地照旧卡。
//
// ★ 预热必须在**基地模式已退出**之后做（基地往同一 scene 加了 4 盏灯 →
//   灯光数不同 → program 缓存键不同 → 预热失效）。故调用点为 WorldMode.enter()。
//
// ★ 预热件必须长期存活：three 的 program 按 usedTimes 引用计数，
//   预热材质一旦 dispose 会连带释放 program → 预热失效。
// ============================================================

import * as THREE from 'three';
import { TerrainMaterial, WallMaterial } from './TerrainMaterial';

/** ★ 预热件长期持有（dispose 会连带释放 program → 预热白费）。 */
const held: THREE.Material[] = [];

/** 已预热过的渲染器（幂等：同一渲染器只预热一次）。 */
const warmed = new WeakSet<THREE.WebGLRenderer>();

let resolveReady: (() => void) | null = null;
/** program 就绪信号（精细地块异步加载的闸门）。 */
const readyPromise = new Promise<void>((res) => { resolveReady = res; });

/**
 * 精细地块 program 是否已就绪（驱动编译完成）。
 * ★ 落地切细化前用它当闸门：未就绪就继续用粗块顶着，绝不同步等待。
 */
export function terrainProgramsReady(): Promise<void> {
  return readyPromise;
}

/**
 * 预热精细地形/侧壁的 shader program（异步；不阻塞调用方）。
 *
 * @param renderer 主渲染器
 * @param scene    世界场景 —— 灯光/雾状态的唯一来源，必须与落地渲染时同状态，
 *                 否则 program 缓存键不同 → 预热失效、落地照旧卡。
 * @param camera   当前相机
 */
export function prewarmTerrainPrograms(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  if (warmed.has(renderer)) return;
  warmed.add(renderer);

  // 占位纹理（uniform 取值不影响 program，只为构造合法材质）。
  const dummy = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  dummy.needsUpdate = true;

  // ★ 构造参数必须与 ChunkManager.buildTerrainMeshes 完全一致：
  //   useVertexColor=true → 顶点着色器变体一致 → program 缓存键一致。
  const top = new TerrainMaterial(dummy, dummy, dummy, undefined, true);
  const wall = new WallMaterial(dummy, dummy, undefined, true);
  held.push(top, wall);

  // 预热场景：只放这两件（compileAsync 的第三个参数传真实场景取灯光/雾）。
  const warmScene = new THREE.Scene();
  // ★ geometry 属性集必须与真实 chunk 地形一致（ChunkManager.toGeo）：
  //   program 缓存键含 geometry 派生位 —— 位 23 vertexNormals（有无 normal 属性）、
  //   位 11 vertexAlphas（color 属性 itemSize==4）。少一个属性就换一份 program
  //   → 预热白费、落地照旧卡。这里按真实 chunk 的完整属性集构造。
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('apw', new THREE.BufferAttribute(new Float32Array(3), 1));
  warmScene.add(new THREE.Mesh(geo, top));
  warmScene.add(new THREE.Mesh(geo, wall));

  // ★ 2026-11-14 回退：曾把 sharedWaterMaterial 也挂进来预热，结果它的 uniforms
  //   依赖 FFT 渲染目标（预热场景里为空）→ 链接失败 → three 缓存无效 program
  //   → 实战每帧 `useProgram: program not valid`（256 次）→ 驱动侧持续阻塞，
  //   表现为「按 F 后画面卡死几秒、且 PerformanceObserver 没有 longtask」。
  //   水面 program 必须在它自己的 RT 就绪后再预热（见 WaterMaterial.follow）。

  void renderer
    .compileAsync(warmScene, camera, scene)
    .then(() => { resolveReady?.(); })
    .catch((e) => {
      console.warn('[地形预热] 失败（落地仍可能卡）', e);
      // 失败也要放行闸门：宁可落地卡一次，也不能让精细地块永远不加载。
      resolveReady?.();
    });
}
