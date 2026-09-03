// ============================================================
// ChunkSurface —— chunk 顶面网格构建器（只读精修层定型快照）
// ============================================================
// 2026-08-30 重构（《精修层与定型快照架构.md》）：几何定型统一移到
// Refinements.buildChunkFinal（唯一定型角点高度场 + 顶面 raw 缓冲）；
// 本文件只做三件事：
//   ① 从 RasterMap.surfaceBlocks 取精修后块源（§6 三份收敛：不再自建源）
//   ② 调 buildChunkFinal 拿到定型快照（角点高度场 + 顶面缓冲）
//   ③ 把 raw 缓冲包装成 THREE BufferGeometry，返回给渲染与物理消费。
// 不再逐角调几何拼网格——角点已由精修层一次性定型（cornerCell 撕裂+传导场）。
//
// 局部坐标约定与旧路径一致：chunk 中心为原点（±30），y = 视觉面高度。
// ============================================================

import * as THREE from "three";
import { CHUNK_SIZE } from "./ChunkGenerator";
import { buildChunkFinal, type ChunkFinal } from "./Refinements";
import { buildPostRenderTop } from "./RefinementPostProcess";
import { POST_PROCESS_ENABLED } from "./RefinementPostProcessConfig";
import type { RasterMap } from "./RasterMap";

export interface ChunkSurfaceBuild {
  /** 顶面渲染网格（TerrainMaterial 消费 position/normal/uv） */
  geometry: THREE.BufferGeometry;
  /** 物理顶点（= geometry 顶点，局部坐标；与墙三角形合并后建 trimesh） */
  vertices: Float32Array;
  /** 物理索引（= geometry 索引） */
  indices: Uint32Array;
  /** ★ 精修层定型快照（per-chunk 单产物；角点高度场 + 顶面 raw 缓冲） */
  finalTerrain: ChunkFinal;
}

/**
 * 构建一个 chunk 的顶面网格（只读精修层定型快照）。
 * 块源 = RasterMap.surfaceBlocks（统一建源；缺块懒 ensureChunk，
 * 裁决永不见"未加载=0"的假邻域，与烘焙同哲学）。
 */
export function buildChunkTopSurface(
  raster: RasterMap,
  cx: number,
  cz: number,
): ChunkSurfaceBuild {
  const N = CHUNK_SIZE;

  // ---- ★ 精修层统一产出定型快照（角点场 + 顶面缓冲一次算好）。
  //   per-chunk 意图经 raster.chunkSource 应用（渲染=查询同源；当前恒空透传）----
  const finalTerrain = buildChunkFinal(raster.chunkSource(cx, cz), cx, cz, N);

  // ---- ★ 渲染版局部细分顶面（设计稿 §5）：坑/裂/倒角带内细分多顶点，
  //   ppSurfaceHeight 逐顶点取高（含圆滑/坑/裂）。无 fine 区 → 退回原顶面。
  //   顶点/索引同时喂 渲染网格 + mergeTerrainPhysics → 物理=所见自洽。----
  let top = finalTerrain.top;
  if (POST_PROCESS_ENABLED) {
    const post = buildPostRenderTop(
      raster.chunkSource(cx, cz),
      cx,
      cz,
      raster.worldSeed,
      N,
    );
    if (post.indices.length > 0) {
      finalTerrain.top = post;
      top = post;
    }
  }
  const { vertices, normals, uvs, indices } = top;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return { geometry, vertices, indices, finalTerrain };
}
