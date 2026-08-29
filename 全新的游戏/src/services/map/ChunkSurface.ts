// ============================================================
// ChunkSurface —— chunk 顶面网格构建器（SurfaceRules 派生）
// ============================================================
// 取代旧 PlaneGeometry + vertexHeightAt 位移路径（2026-08-29，
// 《地形边缘裁决与视觉面架构.md》§3/§4）：
//   - 基本单元 = 米格 cell（恒属于唯一 4m 块），四角按【块归属】取高：
//     weld 角点 = 环绕 2×2 格 max（与旧几何逐位等价）；
//     cliff 硬角点 = 本块自持高度（两侧各持各高，落差由 ChunkWalls 墙补）。
//   - 三角剖分与旧 PlaneGeometry 完全一致：对角线 (lx,lz+1)-(lx+1,lz)，
//     T1=△(c00,c01,c10)（fx+fz≤1 侧）、T2=△(c01,c11,c10)——
//     全 weld 配置下与旧网格三角形逐位重合（顶点复制不影响渲染）。
//   - 输出一份缓冲三处消费：渲染 geometry / 物理 trimesh / UV 对齐烘焙。
//
// 局部坐标约定与旧路径一致：chunk 中心为原点（±30），y = 视觉面高度。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, BLOCKS_PER_SIDE } from './ChunkGenerator';
import { cornerHeight, MISSING_BLOCK, type BlockInfo, type BlockSource } from './SurfaceRules';
import type { RasterMap } from './RasterMap';

export interface ChunkSurfaceBuild {
  /** 顶面渲染网格（TerrainMaterial 消费 position/normal/uv） */
  geometry: THREE.BufferGeometry;
  /** 物理顶点（= geometry 顶点，局部坐标；与墙三角形合并后建 trimesh） */
  vertices: Float32Array;
  /** 物理索引（= geometry 索引） */
  indices: Uint32Array;
}

/**
 * 构建一个 chunk 的顶面网格。
 * ★ 3×3 chunk 数据先 ensureData 补齐并预取成本地块表——角点查询零 Map 开销，
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
  const src: BlockSource = {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      const ibx = bx - B0;
      const ibz = bz - BZ0;
      if (ibx < 0 || ibz < 0 || ibx >= W || ibz >= W) return undefined;
      return table[ibz * W + ibx];
    },
  };

  // ---- 逐 cell 装配（局部坐标，chunk 中心为原点）----
  const cells = N * N;               // 3600
  const positions = new Float32Array(cells * 4 * 3);
  const normals = new Float32Array(cells * 4 * 3);
  const uvs = new Float32Array(cells * 4 * 2);
  const indices = new Uint32Array(cells * 6);
  const HALF = N / 2;
  let vp = 0;   // 顶点游标（float）
  let up = 0;   // uv 游标
  let ip = 0;   // 索引游标
  let vi = 0;   // 顶点编号

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      // cell 所属块（表内偏移 = 块内偏移 + 1）
      const cbx = Math.floor(lx / 4) + 1;
      const cbz = Math.floor(lz / 4) + 1;
      const B = table[cbz * W + cbx] ?? MISSING_BLOCK;
      // 四角（块归属取高）：c00=(lx,lz) c10=(lx+1,lz) c01=(lx,lz+1) c11=(lx+1,lz+1)
      const h00 = cornerHeight(src, B, lx, lz);
      const h10 = cornerHeight(src, B, lx + 1, lz);
      const h01 = cornerHeight(src, B, lx, lz + 1);
      const h11 = cornerHeight(src, B, lx + 1, lz + 1);
      const x00 = lx - HALF, z00 = lz - HALF;

      // 4 顶点（顺序 c00 c10 c11 c01）
      positions[vp] = x00;     positions[vp + 1] = h00; positions[vp + 2] = z00;
      positions[vp + 3] = x00 + 1; positions[vp + 4] = h10; positions[vp + 5] = z00;
      positions[vp + 6] = x00 + 1; positions[vp + 7] = h11; positions[vp + 8] = z00 + 1;
      positions[vp + 9] = x00;     positions[vp + 10] = h01; positions[vp + 11] = z00 + 1;
      for (let k = 0; k < 4; k++) normals[vp + k * 3 + 1] = 1; // 法线 +Y（与旧路径一致）
      // UV（与旧路径逐位同映射：u=lx/60, v=lz/60）
      uvs[up] = lx / N;         uvs[up + 1] = lz / N;
      uvs[up + 2] = (lx + 1) / N; uvs[up + 3] = lz / N;
      uvs[up + 4] = (lx + 1) / N; uvs[up + 5] = (lz + 1) / N;
      uvs[up + 6] = lx / N;       uvs[up + 7] = (lz + 1) / N;
      // 顶点编号：0=c00 1=c10 2=c11 3=c01
      // T1 = △(c00,c01,c10)（fx+fz≤1 侧）；T2 = △(c01,c11,c10)——绕序朝 +Y
      indices[ip] = vi;         indices[ip + 1] = vi + 3; indices[ip + 2] = vi + 1;
      indices[ip + 3] = vi + 3; indices[ip + 4] = vi + 2; indices[ip + 5] = vi + 1;
      vp += 12; up += 8; ip += 6; vi += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return { geometry, vertices: positions, indices };
}

/** 块内 x 偏移（支持负块坐标：worldBx − chunk 原点块） */
function ibx0(bx: number, ccx: number, bps: number): number {
  return bx - ccx * bps;
}

/** 块内 z 偏移 */
function ibz0(bz: number, ccz: number, bps: number): number {
  return bz - ccz * bps;
}
