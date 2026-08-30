// ============================================================
// ChunkWalls —— chunk 断崖侧壁网格（只读精修层定型快照/墙缓冲）
// ============================================================
// 2026-08-30 重构（《精修层与定型快照架构.md》）：断崖墙的【扫描/几何/明暗
// 顶点色】统一搬到 Refinements.buildChunkWallBuffers（精修层统一产出墙 raw
// 缓冲）；本文件只做：
//   ① 提供墙扫描所需的光栅上下文（逻辑高度/地块定义/组调色板/seed）
//   ② 调 buildChunkWallBuffers 拿精修层墙缓冲
//   ③ 把 raw 缓冲包装成 THREE Mesh（含顶点色），供渲染。
//
// ★ 物理同源：墙三角形必须并入地面 trimesh（buildChunkSideWalls 同时输出
//   raw 顶点/索引，由 ChunkManager 与顶面经 Refinements.mergeTerrainPhysics
//   合并后建刚体——碰撞=所见不变式）。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE } from './ChunkGenerator';
import { buildChunkWallBuffers, type ChunkWallBuffers } from './Refinements';
import { groupByKey, type GroupPalette } from './TileGroups';
import type { RasterMap } from './RasterMap';
import { TERRAIN_LIGHT_TUNING } from './TerrainMaterial';

/** 侧壁材质注册表（每帧由 updateWallLighting 统一喂昼夜标量；dispose 时 clear） */
const wallMaterials = new Set<THREE.MeshBasicMaterial>();

/**
 * 每帧昼夜调制（与地形顶面同源：仅改整体亮度，不改烘焙阴影方向）。
 */
export function updateWallLighting(sun: {
  color: number;
  intensityScale: number;
  daylight: number;
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambI = T.ambientNightIntensity +
    (T.ambientDayIntensity - T.ambientNightIntensity) * sun.daylight;
  const scalar = ambI + T.sunIntensity * sun.intensityScale * 0.8;
  for (const m of wallMaterials) m.color.setScalar(scalar);
}

/** 模式退出时清空注册表（材质已由 ChunkManager.disposeVisual 释放） */
export function clearWallMaterials(): void {
  wallMaterials.clear();
}

/** 墙构建产物：视觉网格 + raw 物理缓冲（局部坐标，与顶面同约定可合并建 trimesh） */
export interface ChunkWallsBuild {
  mesh: THREE.Mesh | null;
  buffers: ChunkWallBuffers;
  /** 物理顶点（= buffers.vertices，局部坐标） */
  vertices: Float32Array;
  /** 物理索引（= buffers.indices） */
  indices: Uint32Array;
}

/**
 * 生成 chunk 全部断崖侧壁合并网格（局部坐标，中心为原点）。
 * 扫描/几何/明暗由精修层 buildChunkWallBuffers 统一产出；本函数只供
 * 光栅上下文并把缓冲装成 THREE 网格。
 */
export function buildChunkSideWalls(raster: RasterMap, cx: number, cz: number): ChunkWallsBuild {
  const N = CHUNK_SIZE;
  const seed = raster.worldSeed;
  const gkey = raster.getChunkData(cx, cz)?.groupKey;
  const palette: GroupPalette | undefined = gkey ? groupByKey(gkey)?.palette : undefined;

  const buffers = buildChunkWallBuffers(raster.surfaceBlocks, cx, cz, N, {
    seed,
    palette,
    heightAt: (x, z) => raster.heightAt(x, z),
    tileDefAt: (x, z) => raster.tileDefAt(x, z),
  });

  if (buffers.indices.length === 0) {
    return { mesh: null, buffers, vertices: buffers.vertices, indices: buffers.indices };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buffers.vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  wallMaterials.add(mat);
  return {
    mesh: new THREE.Mesh(geo, mat),
    buffers,
    vertices: buffers.vertices,
    indices: buffers.indices,
  };
}
