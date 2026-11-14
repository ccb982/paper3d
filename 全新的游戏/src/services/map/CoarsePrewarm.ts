// ============================================================
// CoarsePrewarm —— 基地阶段预创建出生点周围粗块（2026-11-14）
// ============================================================
// ★ 为什么要它（用户定调：「在基地就可以预创建当天出生点附近大范围地块」）：
//   战场代码在回基地时并不会停止，只是切了环境；而 scene 是**跨模式共享**的
//   （基地渲染的是室内 interiorScene，室外 scene 在基地模式下不渲染）。
//   → 于是可以在「回基地、天数推进」之后，趁空闲把新一天出生点周围的粗块
//     **一次性建好**放进 scene，玩家下次出击进场即完整地形，不会看到空洞。
//
// ★ 生命周期：
//   · 预创建物带 userData.coarseChunk = key → 下次进战场时由 ChunkManager
//     认领（adoptCoarseMeshes），不重复构建；
//   · 预创建在「回基地」时做（WorldMode 已 exit，ChunkManager 已 dispose），
//     所以它必须是**独立于 ChunkManager 实例**的能力（本模块）。
//
// ★ 粗块内容：硬边几何 + 纯色顶点色 + 静态水面（与 ChunkManager.buildCoarseMesh
//   同口径）；无烘焙/装饰/物理 —— 进场后细化层会逐块替换它。
// ============================================================

import * as THREE from 'three';
import { RasterMap } from './RasterMap';
import { CHUNK_SIZE } from './ChunkGenerator';
import { chunkKeyOf } from './RasterMap';
import { computeTableGeometry } from './PatchCompute';
import { groupByKey } from './TileGroups';
import type { GroupPalette } from './TileGroups';

/** ★ 预创建粗块的 userData 标记（ChunkManager 认领用） */
export const COARSE_CHUNK_FLAG = 'coarseChunk';

let sharedMat: THREE.MeshBasicMaterial | null = null;
function coarseMaterial(): THREE.MeshBasicMaterial {
  sharedMat ??= new THREE.MeshBasicMaterial({ vertexColors: true });
  return sharedMat;
}

/**
 * ★ 预创建出生点周围一大片粗块（同步，主线程）
 *   @param scene 室外共享 scene（基地模式下不渲染 → 不影响基地画面）
 *   @param cx,cz 中心（米）
 *   @param radius 半径（格）—— 铺 ±radius 方环
 *
 *   同步执行（主线程）：基地阶段一次性开销可接受；换来的是**进场即完整**。
 */
export function prewarmCoarseAround(
  scene: THREE.Scene,
  cx: number,
  cz: number,
  radius: number,
  visible = false,
  seed = 12345,
): number {
  // ★ 地图数据层可能还不存在（首次出击前从没进过战场 → RasterMap.current 为
  //   null）→ 预创建自己造一个（同 seed → 地形与实战完全一致）。
  //   用完还原 RasterMap.current：进战场时 WorldMode 会 new 自己的实例，
  //   不能让预创建的实例占着 current。
  const prevCurrent = RasterMap.current;
  const raster = prevCurrent ?? new RasterMap(seed);
  try {
    return prewarmWithRaster(scene, raster, cx, cz, radius, visible);
  } finally {
    RasterMap.current = prevCurrent;
  }
}

function prewarmWithRaster(
  scene: THREE.Scene,
  raster: RasterMap,
  cx: number,
  cz: number,
  radius: number,
  visible: boolean,
): number {
  const pcx = Math.floor(cx / CHUNK_SIZE);
  const pcz = Math.floor(cz / CHUNK_SIZE);
  const mat = coarseMaterial();
  // ★ 一次性收集已有 key（避免逐块扫 scene 的 O(n²)）
  const done = new Set<number>();
  for (const [key] of collectPrewarmed(scene)) done.add(key);
  let built = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const bx = pcx + dx, bz = pcz + dz;
      const key = chunkKeyOf(bx, bz);
      if (done.has(key)) continue;
      done.add(key);
      // ★ 先确保数据存在（同步纯函数生成，幂等）——否则算不出几何
      raster.ensureData(bx, bz);
      const data = raster.getChunkData(bx, bz);
      if (!data) continue;
      const palette: GroupPalette | undefined = data.groupKey
        ? groupByKey(data.groupKey)?.palette
        : undefined;
      const geom = computeTableGeometry(
        (ax, az) => raster.getChunkData(ax, az),
        raster.worldSeed, bx, bz,
        undefined, null, null, undefined,
        true, // ★ 粗块模式：硬边几何（与 worker 同函数同参数）
        palette,
      );
      if (!geom) continue;
      const group = buildCoarseGroup(geom, mat, bx, bz);
      group.userData[COARSE_CHUNK_FLAG] = key;
      // ★ 预创建阶段默认**不可见**：基地模式渲染的就是室外 scene（BaseMode 每帧
      //   render(this.scene)），可见的话房间里会凭空冒出室外大地（穿帮）。
      //   出击瞬间由 setPrewarmedVisible(true) 点亮。
      group.visible = visible;
      scene.add(group);
      built++;
    }
  }
  return built;
}

/** ★ 点亮/隐藏全部预创建粗块（出击瞬间点亮；基地期间保持隐藏防穿帮） */
export function setPrewarmedVisible(scene: THREE.Scene, visible: boolean): void {
  for (const [, group] of collectPrewarmed(scene)) group.visible = visible;
}

/**
 * ★ 把预创建的粗块**载入 GPU**（2026-11-14 用户定调「预创建并载入」）
 *   仅建几何 + 放进 scene 不算载入：几何属性要等**首次渲染**才上传 GPU
 *   → 289 块的上传全压在进场第一帧（又是一次长任务）。
 *   做法：用一台俯视出生点的临时相机，把 scene 渲染到 1×1 离屏 RT
 *   （不落屏、不闪屏），渲染完属性已进 GPU → 进场即可用。
 */
export function prewarmUpload(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cx: number,
  cz: number,
): void {
  const cam = new THREE.PerspectiveCamera(70, 1, 1, 8000);
  cam.position.set(cx, 1500, cz);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(4, 4);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
  }
}

/** ★ 取 scene 里所有预创建的粗块 group（按 key） */
export function collectPrewarmed(scene: THREE.Scene): Map<number, THREE.Group> {
  const out = new Map<number, THREE.Group>();
  for (const child of scene.children) {
    const k = (child.userData as Record<string, unknown>)[COARSE_CHUNK_FLAG];
    if (typeof k === 'number') out.set(k, child as THREE.Group);
  }
  return out;
}

/** 由粗几何建粗网格（纯色顶点色 + MeshBasic；不含水面 —— 水面由细化层接管） */
function buildCoarseGroup(
  g: { top: { vertices: Float32Array; colors?: Float32Array; indices: Uint32Array }; wall: { vertices: Float32Array; colors?: Float32Array; indices: Uint32Array } },
  mat: THREE.Material,
  cx: number,
  cz: number,
): THREE.Group {
  const group = new THREE.Group();
  const addPart = (part: { vertices: Float32Array; colors?: Float32Array; indices: Uint32Array }): void => {
    if (!part.indices || part.indices.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(part.vertices, 3));
    const n = part.vertices.length / 3;
    geo.setAttribute('color', new THREE.BufferAttribute(
      part.colors && part.colors.length === n * 3 ? part.colors : new Float32Array(n * 3).fill(0.7), 3,
    ));
    geo.setIndex(new THREE.BufferAttribute(part.indices, 1));
    geo.computeBoundingSphere();
    group.add(new THREE.Mesh(geo, mat));
  };
  addPart(g.top);
  addPart(g.wall);
  group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
  return group;
}
