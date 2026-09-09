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
import { CHUNK_SIZE, BLOCKS_PER_SIDE } from "./ChunkGenerator";
import {
  buildTopGeometry,
  buildWallGeometry,
  buildLevelOverlay,
  topFineCells,
  topFineCellsFor,
  type FaceGeometry,
} from "./FaceBuild";
import { incrementalGeometry, incrementalDropCache, seedBaseGeometry, computeIncrementalMasks, partitionGroundCells, PHYS_GRID } from "./IncrementalGeometry";
import { buildWaterSurface, levelsHash, type WaterSurfaceRaw } from "./WaterSurface";
import {
  makeChunkSource,
  refineChunkSource,
  type ChunkDataLite,
} from "./Refinements";

/** 几何 y 范围（Worker 单遍扫出；主线程解析构造包围球，免 O(n) 重扫） */
export interface GeomBounds {
  minY: number;
  maxY: number;
}

/** ★ 物理分区 trimesh（slot = pcz*grid+pcx；grid 默认 3×3=9 分区） */
export interface PatchGroundCell {
  slot: number;
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Worker ↔ 主线程传输的几何结果（typed arrays；buffer 可 transfer） */
export interface PatchGeomRaw {
  top: {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    /** ★ 补丁权重（补丁装饰纹理驱动通道；→ attribute "apw"） */
    patchW: Float32Array;
    indices: Uint32Array;
    topTriCount: number;
  };
  wall: {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    colors: Float32Array;
    shade: Float32Array;
    /** ★ 补丁权重（坑壁碎屑装饰；补丁墙恒 1） */
    patchW: Float32Array;
    indices: Uint32Array;
    topTriCount: number;
  };
  /** ★ 水体静止基面（水位 0 平面 + 坑水帘；无起伏/动画，见 《水体管线架构.md》） */
  water: WaterSurfaceRaw;
  /** ★ 物理分区（全量构建 = 全部 grid²；增量构建 = 受影响分区 → 主线程只换这些） */
  cells: PatchGroundCell[];
  /** ★ y 范围（Worker 单遍扫出 → 主线程解析构造包围球；创建/原地更新共用） */
  topBounds: GeomBounds;
  wallBounds: GeomBounds;
}

export type PatchGeomResult = PatchGeomRaw;

// ★ 自检开关：true 时增量/全量字节对比，失配则回退全量（验证期开，生产关）
const INCREMENTAL_SELF_CHECK = false;

/**
 * ★ 唯一几何生成函数（表驱动 + 补丁层数覆盖；增量/全量同源）：
 * readChunk 闭包 = 共享源数据（主线程 = RasterMap.getChunkData；Worker =
 * 传输拷贝）；levels = 中心 chunk 的层数表（§14.11；缺省 undefined = 无补丁）。
 * dirty = 本次 dig 直接挖到的世界 4m 块 key 列表（缺省 = 全量求解水体重建；
 * 供其中【连通分量 + 边界探针】做增量）。
 * 内部与 RasterMap.chunkSource 同一路径：makeChunkSource →
 * refineChunkSource(seed, cx, cz) → buildFaceTable → 双 builder。
 * ★ 增量（2026-09-08）：有补丁时走 IncrementalGeometry 的"基座缓存 + 受影响
 *   地块重发"（其余字节级复用）；无补丁时全量构建并播种基座缓存（供首次挖坑
 *   即时命中）。Worker 与主线程回退共用本函数 → 字节一致由构造保证。
 */
export function computeTableGeometry(
  readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  seed: number,
  cx: number,
  cz: number,
  levels?: Uint8Array,
  dirty?: number[] | null,
  masks?: { top: Uint8Array; side: Uint8Array } | null,
): PatchGeomResult {
  const src = refineChunkSource(makeChunkSource(readChunk), seed, cx, cz);
  const patch = levels && levels.length > 0 ? buildLevelOverlay(levels, cx, cz) : undefined;
  const table = buildFaceTable(src, cx, cz);
  let top: FaceGeometry, wall: FaceGeometry, fineE: Uint8Array;
  if (patch) {
    const inc = incrementalGeometry(seed, cx, cz, table, src, patch, masks ?? undefined);
    top = inc.top; wall = inc.wall;
    // ★ 分区布局 = 输出 fine 掩码（补丁强制 fine 区∪基座 fine 区）
    fineE = topFineCellsFor(table, src, patch);
    if (INCREMENTAL_SELF_CHECK) {
      const fTop = buildTopGeometry(table, src, patch);
      const fWall = buildWallGeometry(table, src, patch);
      if (bytesDiff(top, fTop) || bytesDiff(wall, fWall)) {
        console.error(
          `[PatchCompute] chunk(${cx},${cz}) 增量几何与全量失配！回退全量`,
        );
        top = fTop; wall = fWall;
      }
    }
  } else {
    const baseFine = topFineCells(table, src);
    fineE = baseFine;
    top = buildTopGeometry(table, src);
    wall = buildWallGeometry(table, src);
    seedBaseGeometry(seed, cx, cz, table, src, baseFine, top, wall); // 播种基座缓存
  }
  const water = buildWaterSurface(
    table, src, patch,
    patch ? { dirty: dirty ?? undefined, layersHash: levels ? levelsHash(levels) : 0 } : undefined,
  );
  // ★ 物理分区：全量 = 全部 grid²；增量 = 受影响 1m cell 掩码 → 所属分区（提前返回，
  //   只输出命中分区，主线程只换这些 collider —— 顶点焊接跨界已由 ±1 环掩码覆盖）
  const cells = partitionGroundCells(top, wall, fineE, PHYS_GRID, deriveAffectedCells(masks, PHYS_GRID));
  return {
    top: {
      vertices: top.vertices,
      normals: top.normals,
      uvs: top.uvs as Float32Array,
      colors: top.colors as Float32Array,
      patchW: top.patchW as Float32Array,
      indices: top.indices,
      topTriCount: top.topTriCount,
    },
    wall: {
      vertices: wall.vertices,
      normals: wall.normals,
      uvs: wall.uvs as Float32Array,
      colors: wall.colors as Float32Array,
      shade: wall.shade as Float32Array,
      patchW: wall.patchW as Float32Array,
      indices: wall.indices,
      topTriCount: wall.topTriCount,
    },
    water,
    cells,
    topBounds: yBoundsOf(top.vertices),
    wallBounds: yBoundsOf(wall.vertices),
  };
}

/** ★ 受影响 1m cell 掩码（top，已含补丁∪1 圈）→ 所属物理分区 slot（null = 全部分区） */
const N = CHUNK_SIZE;
const BPS = BLOCKS_PER_SIDE;
function deriveAffectedCells(
  masks?: { top: Uint8Array; side: Uint8Array } | null,
  grid = PHYS_GRID,
): number[] | null {
  if (!masks) return null;
  const set = new Set<number>();
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!masks.top[lz * N + lx]) continue;
      const bx = lx >> 2, bz = lz >> 2; // 4m 块
      const pcx = Math.floor((bx * grid) / BPS), pcz = Math.floor((bz * grid) / BPS);
      set.add(pcz * grid + pcx);
    }
  }
  return [...set];
}

/** 顶点数组 y 范围（单遍扫；空数组 = {0,0}） */
function yBoundsOf(vertices: Float32Array): GeomBounds {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < vertices.length; i += 3) {
    const y = vertices[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minY === Infinity) { minY = 0; maxY = 0; }
  return { minY, maxY };
}

/** 增量/全量逐字节对比（仅自检用） */
function bytesDiff(a: FaceGeometry, b: FaceGeometry): boolean {
  const bytes = (v: Float32Array | Uint32Array | undefined): Uint8Array | null =>
    v ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;
  const same = (x: Uint8Array | null, y: Uint8Array | null): boolean => {
    if (!x || !y) return x !== y;
    if (x.byteLength !== y.byteLength) return false;
    for (let i = 0; i < x.byteLength; i++) if (x[i] !== y[i]) return false;
    return true;
  };
  return !(
    same(bytes(a.vertices), bytes(b.vertices)) &&
    same(bytes(a.normals), bytes(b.normals)) &&
    same(bytes(a.uvs as Float32Array), bytes(b.uvs as Float32Array)) &&
    same(bytes(a.colors as Float32Array), bytes(b.colors as Float32Array)) &&
    same(bytes(a.shade as Float32Array), bytes(b.shade as Float32Array)) &&
    same(bytes(a.patchW as Float32Array), bytes(b.patchW as Float32Array)) &&
    same(bytes(a.indices), bytes(b.indices))
  );
}

/** 切风格/dispose 等 chunk 数据换代时清空基座缓存（Worker/主线程同源） */
export { incrementalDropCache };

/** FaceGeometry 窄化（FaceBuild 类型不可直接三线传输；这里只做类型别名收口） */
export type { FaceGeometry };
