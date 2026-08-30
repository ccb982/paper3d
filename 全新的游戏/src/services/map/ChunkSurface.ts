// ============================================================
// ChunkSurface —— chunk 顶面网格构建器（只读精修层定型快照）
// ============================================================
// 2026-08-30 重构（《精修层与定型快照架构.md》）：几何定型统一移到
// Refinements.buildChunkFinal（唯一定型角点高度场 + 顶面 raw 缓冲）；
// 本文件只做三件事：
//   ① 建立精修后的 BlockSource（17×17 邻域表，供 buildChunkFinal 统一建源）
//   ② 调 buildChunkFinal 拿到定型快照（角点高度场 + 顶面缓冲）
//   ③ 把 raw 缓冲包装成 THREE BufferGeometry，返回给渲染与物理消费。
// 不再逐角调 cornerHeight 拼网格——角点已由精修层一次性定型。
//
// 局部坐标约定与旧路径一致：chunk 中心为原点（±30），y = 视觉面高度。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, BLOCKS_PER_SIDE } from './ChunkGenerator';
import { buildChunkFinal, type BlockInfo, type BlockSource, type ChunkFinal } from './Refinements';
import { refine, planRefinements } from './Refinements';
import type { RasterMap } from './RasterMap';

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
 * 3×3 chunk 数据先 ensureData 补齐并预取成本地块表——角点查询零 Map 开销，
 * 且保证邻块数据存在（裁决永不见"未加载=0"的假邻域，与烘焙同哲学）。
 */
export function buildChunkTopSurface(raster: RasterMap, cx: number, cz: number): ChunkSurfaceBuild {
  const N = CHUNK_SIZE;
  const BPS = BLOCKS_PER_SIDE;

  // ---- 本地块表：世界块坐标 [cx*15−1 .. cx*15+15] × 同 z（17×17）----
  const W = BPS + 2;
  const B0 = cx * BPS - 1;
  const BZ0 = cz * BPS - 1;
  const table: (BlockInfo | undefined)[] = new Array(W * W);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      raster.ensureData(cx + dx, cz + dz); // 确定性纯生成（亚毫秒）
    }
  }
  for (let ibz = 0; ibz < W; ibz++) {
    for (let ibx = 0; ibx < W; ibx++) {
      const bx = B0 + ibx;
      const bz = BZ0 + ibz;
      const ccx = Math.floor(bx / BPS);
      const ccz = Math.floor(bz / BPS);
      const data = raster.getChunkData(ccx, ccz);
      if (!data) { table[ibz * W + ibx] = undefined; continue; }
      const lx = (bx - ccx * BPS) * 4;
      const lz = (bz - ccz * BPS) * 4;
      const gi = lz * N + lx;
      table[ibz * W + ibx] = { id: data.blockTypes[ibz0(bz, ccz, BPS) * BPS + ibx0(bx, ccx, BPS)] ?? 0, h: data.heights[gi] ?? 0 };
    }
  }
  const src: BlockSource = refine({
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      const ibx = bx - B0;
      const ibz = bz - BZ0;
      if (ibx < 0 || ibz < 0 || ibx >= W || ibz >= W) return undefined;
      return table[ibz * W + ibx];
    },
  }, planRefinements(raster.worldSeed));

  // ---- ★ 精修层统一产出定型快照（角点场 + 顶面缓冲一次算好）----
  const finalTerrain = buildChunkFinal(src, cx, cz, N);
  const { vertices, normals, uvs, indices } = finalTerrain.top;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return { geometry, vertices, indices, finalTerrain };
}

/** 块内 x 偏移（支持负块坐标：worldBx − chunk 原点块） */
function ibx0(bx: number, ccx: number, bps: number): number {
  return bx - ccx * bps;
}

/** 块内 z 偏移 */
function ibz0(bz: number, ccz: number, bps: number): number {
  return bz - ccz * bps;
}
