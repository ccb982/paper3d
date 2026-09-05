// ============================================================
// PatchCompute —— 地块破坏几何计算的共享纯函数（主线程/Worker 同源）
// ============================================================
// 语义（§14.10）：给定 chunk 的补丁掩码 → 产出顶面/侧壁几何字节。
// 输入面收敛于 Refinements「统一输入面」（ChunkDataLite：heights+blockTypes，
// 3×3 邻域 chunk）——与 RasterMap.surfaceBlocks（makeChunkSource 闭包）完全
// 同源，Worker 端把拷出的数组喂同一工厂 → 字节级一致（由构造保证，验收 ⑧ 锁定）。
// 本文件不 import three —— Worker 依赖最小（与 terrainBake.worker 同哲学）。
// ============================================================

import { buildFaceTable } from "./FaceTable";
import {
  buildTopGeometry,
  buildWallGeometry,
  buildPatchOverlay,
  type FaceGeometry,
} from "./FaceBuild";
import {
  makeChunkSource,
  refineChunkSource,
  type ChunkDataLite,
} from "./Refinements";

/** Worker ↔ 主线程传输的几何结果（typed arrays；buffer 可 transfer） */
export interface PatchGeomRaw {
  top: {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
    topTriCount: number;
  };
  wall: {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    shade: Float32Array;
    indices: Uint32Array;
    topTriCount: number;
  };
}

export type PatchGeomResult = PatchGeomRaw;

/**
 * ★ 唯一几何生成函数（表驱动 + 补丁掩码）：
 * readChunk 闭包 = 共享源数据（主线程 = RasterMap.getChunkData；Worker =
 * 传输拷贝）。内部与 RasterMap.chunkSource 同一路径：makeChunkSource →
 * refineChunkSource(seed, cx, cz) → buildFaceTable → 双 builder。
 */
export function computeTableGeometry(
  readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  seed: number,
  cx: number,
  cz: number,
  mask: Uint8Array | undefined,
): PatchGeomResult {
  const src = refineChunkSource(makeChunkSource(readChunk), seed, cx, cz);
  const patch = mask && mask.length > 0 ? buildPatchOverlay(mask, cx, cz) : undefined;
  const table = buildFaceTable(src, cx, cz);
  const top = buildTopGeometry(table, src, patch);
  const wall = buildWallGeometry(table, src, patch);
  return {
    top: {
      vertices: top.vertices,
      normals: top.normals,
      uvs: top.uvs as Float32Array,
      colors: top.colors as Float32Array,
      indices: top.indices,
      topTriCount: top.topTriCount,
    },
    wall: {
      vertices: wall.vertices,
      normals: wall.normals,
      uvs: wall.uvs as Float32Array,
      colors: wall.colors as Float32Array,
      shade: wall.shade as Float32Array,
      indices: wall.indices,
      topTriCount: wall.topTriCount,
    },
  };
}

/** FaceGeometry 窄化（FaceBuild 类型不可直接三线传输；这里只做类型别名收口） */
export type { FaceGeometry };
