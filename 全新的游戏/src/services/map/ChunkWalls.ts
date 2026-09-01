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

import * as THREE from "three";
import { CHUNK_SIZE } from "./ChunkGenerator";
import { buildChunkWallBuffers, type ChunkWallBuffers } from "./Refinements";
import { groupByKey, type GroupPalette } from "./TileGroups";
import type { RasterMap } from "./RasterMap";
import {
  WallMaterial,
  updateWallMaterialsLighting,
  clearWallMaterialRegistry,
  type TileRenderConfig,
} from "./TerrainMaterial";

/**
 * 每帧昼夜调制（与地形顶面同源：仅改整体亮度 + 实时色温/太阳方向，
 * 不改烘焙阴影方向——断崖明暗永久存在于 shade 顶点属性；委托
 * TerrainMaterial.wallRegistry 统一喂）。
 */
export function updateWallLighting(sun: {
  color: number;
  intensityScale: number;
  daylight: number;
  dir: { x: number; y: number; z: number };
}): void {
  updateWallMaterialsLighting(sun);
}

/** 模式退出时清空注册表（材质已由 ChunkManager.disposeVisual 释放） */
export function clearWallMaterials(): void {
  clearWallMaterialRegistry();
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
 * 扫描/几何由精修层 buildChunkWallBuffers 统一产出；本函数只供
 * 光栅上下文并把缓冲装成 THREE 网格。
 * @param albedo 顶面同款烘焙 albedo 纹理（侧壁统一采样，见 WallMaterial）
 * @param lightmap 顶面同款烘焙光图（侧壁转用 lm.r/lm.g 顶面同公式光照）
 * @param matCfg 顶面同款材质配置（buldTileRenderConfig 产物；null/undefined
 *   时墙体退化为纯色 WallMaterial——测试/异常路径），侧壁借此采样与顶面
 *   完全一致的 uTileIds 微纹理 + 物料函数库。
 */
export function buildChunkSideWalls(
  raster: RasterMap,
  cx: number,
  cz: number,
  albedo: THREE.Texture,
  lightmap: THREE.Texture,
  matCfg?: TileRenderConfig,
): ChunkWallsBuild {
  const N = CHUNK_SIZE;
  const seed = raster.worldSeed;
  const gkey = raster.getChunkData(cx, cz)?.groupKey;
  const palette: GroupPalette | undefined = gkey
    ? groupByKey(gkey)?.palette
    : undefined;

  const buffers = buildChunkWallBuffers(raster.chunkSource(cx, cz), cx, cz, N, {
    seed,
    palette,
    heightAt: (x, z) => raster.heightAt(x, z),
    tileDefAt: (x, z) => raster.tileDefAt(x, z),
  });

  if (buffers.indices.length === 0) {
    return {
      mesh: null,
      buffers,
      vertices: buffers.vertices,
      indices: buffers.indices,
    };
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(buffers.vertices, 3),
  );
  geo.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(buffers.normals, 3),
  );
  // ★ UV：每面地块中心 uv（Refinements 按本侧块 bxC/bzC 推出）→ 采样
  //   uTileIds 得所属地块 id，墙纹理与其背后地面逐位一致（2026-09-01）。
  geo.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(buffers.uvs, 2),
  );
  // ★ shade：纯烘焙明暗（不含底色）——WallMaterial 用它乘 OKLab 材质纹理
  geo.setAttribute(
    "shade",
    new THREE.Float32BufferAttribute(buffers.shade, 1),
  );
  // 兼容旧路径：保留 color 属性（无光照场景/调试用）
  geo.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(buffers.colors, 3),
  );
  geo.setIndex(new THREE.BufferAttribute(buffers.indices, 1));;

  // ★ 2026-09-01：侧壁从 MeshBasicMaterial 纯色 → WallMaterial 复用顶面纹理
  //   与顶面同款光照公式（uAlbedo/uLightmap/uAmbientColor/uSunColor 同一套）。
  const mat = new WallMaterial(albedo, lightmap, matCfg);
  return {
    mesh: new THREE.Mesh(geo, mat),
    buffers,
    vertices: buffers.vertices,
    indices: buffers.indices,
  };
}
