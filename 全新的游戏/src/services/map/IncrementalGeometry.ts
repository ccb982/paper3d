// ============================================================
// IncrementalGeometry —— 地块级增量几何（按表只重算受影响地块，其余字节级复用）
// ============================================================
// 语义（§14.11 + 用户定调"以地块为单位进行重建，其余不变"）：
//   每个 chunk 缓存一份「无补丁基座」几何（不随 levels 变化的顶面/侧壁字节——
//   topYView 只取决于 src/table，补丁只叠 depthOf 下挖）。每次破坏：
//   · partition（本文件 §"受影响掩码"，比 partitionPatch 更精）：
//         topCell：补丁 cell ∪ 外扩 1 圈（预防性扩张——覆盖深度场/粗↔细
//                   布局变化及坑口交界；安全超集，多发的 fine cell 字节不变）
//         wallSide：该 4m 边两侧 8 个 coarse cell 任一带受影响标记
//                   —— 同时覆盖 ①补丁色/剔除差 ②本侧 cell 转 fine 的节点密度差
//                   （partitionPatch.blockSides 只查"带补丁"，漏密度差，此处补全）
//     · 受影响 cell/side → 用与 full 构建同一函数（emitTopCellFine/emitWallSide）
//       重发（补丁上下文）；其余 → 直接拷贝基座字节（byte-exact：无补丁区
//       depthOf=0，输出与 full 构建逐位一致——由构造保证）。
//   ★ 顶面受影响 cell 恒为 fine（补丁区∪1圈全 fine），故顶面只需 emitTopCellFine；
//     coarse 分支在增量路径永不触发（布局差 = 粗↔细转换的正是受影响集）。
//   ★ 索引每次全量重发（纯整数，无采样代价）：受影响 = writeTopIndices(当前 vi)；
//     未受影响 = 拷贝基座 idx 段并偏移 Δvi。
//   ★ 缓存按 (seed,cx,cz) 键控；切风格/dispose 时由调用方 dropCache() 清空
//     （chunk 数据重建 → src/table 变化 → 基座作废）。LRU 封顶防内存无界。
// ============================================================

import { CHUNK_SIZE, BLOCKS_PER_SIDE } from "./ChunkGenerator";
import type { FaceTable } from "./FaceTable";
import {
  emitTopCellFine,
  emitWallSide,
  writeTopIndices,
  topFineCells,
  topFineCellsFor,
  buildTopGeometry,
  buildWallGeometry,
  buildLevelOverlay,
  FINE_S,
  TOP_COARSE_TRI,
  TOP_FINE_TRI,
  type FaceGeometry,
  type PatchOverlay,
  type TopAccum,
  type WallAccum,
} from "./FaceBuild";
import type { BlockSource } from "./Refinements";

const N = CHUNK_SIZE;      // 60
const BPS = BLOCKS_PER_SIDE; // 15
const NC = N * N;          // 顶面 coarse cell 数
const NBS = BPS * BPS * 4; // 侧壁 4m 边数
const FINE_V = (FINE_S + 1) * (FINE_S + 1); // fine cell 顶点数（81）

/** 基座几何缓存（每 chunk 一份；LRU 封顶） */
interface ChunkBase {
  seed: number;
  cx: number;
  cz: number;
  baseFine: Uint8Array;       // 无补丁 fine 掩码（= topFineCells）
  top: FaceGeometry;          // 无补丁顶面全量字节
  wall: FaceGeometry;         // 无补丁侧壁全量字节
  /** 顶面逐 cell 顶点数（4 | 81；cell 序 = buildTopGeometry 遍历序） */
  topV: Int32Array;
  /** 顶面逐 cell 顶点前缀偏移（长度 NC+1） */
  topVPre: Int32Array;
  /** 顶面逐 cell 索引前缀偏移（长度 NC+1） */
  topIPre: Int32Array;
  /** 侧壁逐边顶点数（边序 = lbz*BPS*4 + lbx*4 + dir） */
  wallV: Int32Array;
  /** 侧壁逐边顶点/索引前缀偏移（长度 NBS+1） */
  wallVPre: Int32Array;
  /** 侧壁逐边索引前缀偏移（长度 NBS+1） */
  wallIPre: Int32Array;
}

const baseCache = new Map<string, ChunkBase>();
const CACHE_CAP = 16; // LRU 封顶（chunk 基数小；超限淘汰最旧）

function cacheKey(seed: number, cx: number, cz: number): string {
  return `${seed}/${cx},${cz}`;
}

/** 顶面逐 cell 布局（顶点数/前缀），从无补丁 fine 掩码推导（4 | 81） */
function topLayout(fine: Uint8Array): { v: Int32Array; vPre: Int32Array; iPre: Int32Array } {
  const v = new Int32Array(NC);
  const vPre = new Int32Array(NC + 1);
  const iPre = new Int32Array(NC + 1);
  const fineTri = TOP_FINE_TRI * 3, coarseTri = TOP_COARSE_TRI * 3;
  for (let i = 0; i < NC; i++) {
    v[i] = fine[i] ? FINE_V : 4;
    vPre[i + 1] = vPre[i] + v[i];
    iPre[i + 1] = iPre[i] + (fine[i] ? fineTri : coarseTri);
  }
  return { v, vPre, iPre };
}

/** 侧壁逐边布局：节点数 = Σ(span fine ? 8 : 1) + 1；无补丁必全发 → 顶点数=(节点−1)*4 */
function wallLayout(fine: Uint8Array): { v: Int32Array; vPre: Int32Array; iPre: Int32Array } {
  const v = new Int32Array(NBS);
  const vPre = new Int32Array(NBS + 1);
  const iPre = new Int32Array(NBS + 1);
  for (let s = 0; s < NBS; s++) {
    const lbz = Math.floor(s / (BPS * 4));
    const lbx = Math.floor((s % (BPS * 4)) / 4);
    const dir = s % 4;
    const nodes = wallNodes(fine, lbx, lbz, dir);
    const verts = (nodes - 1) * 4;
    v[s] = verts;
    vPre[s + 1] = vPre[s] + verts;
    iPre[s + 1] = iPre[s] + (nodes - 1) * 6;
  }
  return { v, vPre, iPre };
}

/** 与 emitWallSide 同一节点列生成（无补丁计数用） */
function wallNodes(fine: Uint8Array, lbx: number, lbz: number, dir: number): number {
  let n = 0;
  for (let span = 0; span < 4; span++) {
    let cell: number;
    if (dir === 0) cell = fine[(lbz * 4 + span) * N + lbx * 4 + 3];
    else if (dir === 1) cell = fine[(lbz * 4 + span) * N + lbx * 4];
    else if (dir === 2) cell = fine[(lbz * 4 + 3) * N + lbx * 4 + span];
    else cell = fine[(lbz * 4) * N + lbx * 4 + span];
    n += cell ? FINE_S : 1;
  }
  return n + 1;
}

/** 构建并缓存基座（无补丁 full 构建）；已缓存直接返回 */
export function seedBaseGeometry(
  seed: number, cx: number, cz: number,
  table: FaceTable, src: BlockSource,
  baseFine: Uint8Array, top: FaceGeometry, wall: FaceGeometry,
): ChunkBase {
  const key = cacheKey(seed, cx, cz);
  const hit = baseCache.get(key);
  if (hit) return hit;
  const tv = topLayout(baseFine);
  const wl = wallLayout(baseFine);
  const base: ChunkBase = {
    seed, cx, cz, baseFine, top, wall,
    topV: tv.v, topVPre: tv.vPre, topIPre: tv.iPre,
    wallV: wl.v, wallVPre: wl.vPre, wallIPre: wl.iPre,
  };
  if (baseCache.size >= CACHE_CAP) {
    const oldest = baseCache.keys().next();
    if (!oldest.done) baseCache.delete(oldest.value);
  }
  baseCache.set(key, base);
  return base;
}

/** 切风格/dispose 等 chunk 数据换代时清空全部基座缓存 */
export function incrementalDropCache(): void {
  baseCache.clear();
}

export interface IncrementalResult {
  top: FaceGeometry;
  wall: FaceGeometry;
}

// ------------------------------------------------------------
// ★ 受影响掩码：补丁 cell ∪ 外扩 1 圈（预防性扩张）
// ------------------------------------------------------------

/** 顶面受影响 cell：补丁 cell ∪ 外扩 1 圈（Chebyshev 1 邻域） */
function affectedTopMask(patch: PatchOverlay): Uint8Array {
  const mask = new Uint8Array(NC);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!patch.isPatched(lx, lz)) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = lx + dx, nz = lz + dz;
          if (nx >= 0 && nz >= 0 && nx < N && nz < N) mask[nz * N + nx] = 1;
        }
      }
    }
  }
  return mask;
}

/** 侧壁受影响 4m 边：该边两侧 8 个 1m cell 任一带受影响标记 */
function affectedSideMask(mask: Uint8Array): Uint8Array {
  const sideMask = new Uint8Array(NBS);
  let s = 0;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      for (let dir = 0; dir < 4; dir++) {
        for (let j = 0; j < 4; j++) {
          let ox: number, oz: number, nxb: number, nzb: number;
          if (dir === 0) { ox = lbx * 4 + 3; oz = lbz * 4 + j; nxb = ox + 1; nzb = oz; }
          else if (dir === 1) { ox = lbx * 4; oz = lbz * 4 + j; nxb = ox - 1; nzb = oz; }
          else if (dir === 2) { ox = lbx * 4 + j; oz = lbz * 4 + 3; nxb = ox; nzb = oz + 1; }
          else { ox = lbx * 4 + j; oz = lbz * 4; nxb = ox; nzb = oz - 1; }
          if (mask[oz * N + ox]) { sideMask[s] = 1; break; }
          if (nxb >= 0 && nzb >= 0 && nxb < N && nzb < N && mask[nzb * N + nxb]) { sideMask[s] = 1; break; }
        }
        s++;
      }
    }
  }
  return sideMask;
}

/**
 * ★ 主线程（CPU 侧）预计算受影响掩码：纯 (levels, cx, cz) 函数，不依赖 src/table。
 * 主线程一次算好 top+side 掩码 → 随消息传给 Worker，Worker 不再重复扫掩码
 * （几何装配直接用）。Worker 与主线程回退都可复用同一函数 → 字节一致。
 */
export function computeIncrementalMasks(
  levels: Uint8Array, cx: number, cz: number,
): { top: Uint8Array; side: Uint8Array } {
  const patch = buildLevelOverlay(levels, cx, cz);
  const top = affectedTopMask(patch);
  return { top, side: affectedSideMask(top) };
}

// ------------------------------------------------------------
// ★ 增量装配：受影响重发 + 未受影响拷贝基座（两路输出 = full 构建逐位一致）
// ------------------------------------------------------------

function buildTopIncremental(
  base: ChunkBase, table: FaceTable, src: BlockSource,
  patch: PatchOverlay, fineE: Uint8Array, mask: Uint8Array,
): FaceGeometry {
  // ① 受影响 cell → 预发到 scratch（emitTopCellFine base=0：法线相对自身）
  const aff = new Map<number, TopAccum>();
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const c = lz * N + lx;
      if (!mask[c]) continue;
      const a: TopAccum = { pos: [], nor: [], uv: [], col: [], pw: [] };
      const vbx = table.cx * BPS + Math.floor(lx / 4);
      const vbz = table.cz * BPS + Math.floor(lz / 4);
      emitTopCellFine(a, table, src, patch, lx, lz, vbx, vbz, table.cx * N, table.cz * N, 0);
      aff.set(c, a);
    }
  }
  // ② 总量（受影响 = 81 顶点/384 索引；其余 = 基座布局；受影响恒 fine）
  let totalV = base.topVPre[NC], totalI = base.topIPre[NC];
  for (const c of aff.keys()) {
    totalV += FINE_V - base.topV[c];
    totalI += TOP_FINE_TRI * 3 - (base.baseFine[c] ? TOP_FINE_TRI * 3 : TOP_COARSE_TRI * 3);
  }
  // ③ 最终缓冲
  const vertices = new Float32Array(totalV * 3);
  const normals = new Float32Array(totalV * 3);
  const uvs = new Float32Array(totalV * 2);
  const colors = new Float32Array(totalV * 3);
  const patchW = new Float32Array(totalV);
  const indices = new Uint32Array(totalI);
  // ④ 填充：cell 序遍历，受影响写 scratch、未受影响拷基座段
  const bt = base.top;
  let vi = 0, ii = 0;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const c = lz * N + lx;
      const bVPre = base.topVPre[c], bIPre = base.topIPre[c];
      if (mask[c]) {
        const a = aff.get(c)!;
        vertices.set(a.pos, vi * 3);
        normals.set(a.nor, vi * 3);
        uvs.set(a.uv, vi * 2);
        colors.set(a.col, vi * 3);
        patchW.set(a.pw, vi);
        writeTopIndices(indices, ii, vi, true);
        vi += FINE_V;
        ii += TOP_FINE_TRI * 3;
      } else {
        const vc = base.topV[c];
        vertices.set(bt.vertices.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
        normals.set(bt.normals.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
        uvs.set(bt.uvs!.subarray(bVPre * 2, bVPre * 2 + vc * 2), vi * 2);
        colors.set(bt.colors!.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
        patchW.set(bt.patchW!.subarray(bVPre, bVPre + vc), vi);
        const ic = base.baseFine[c] ? TOP_FINE_TRI * 3 : TOP_COARSE_TRI * 3;
        const delta = vi - bVPre;
        const is = bt.indices.subarray(bIPre, bIPre + ic);
        for (let k = 0; k < ic; k++) indices[ii + k] = is[k] + delta;
        vi += vc;
        ii += ic;
      }
    }
  }
  return {
    vertices, normals, uvs, colors, patchW, indices,
    topTriCount: indices.length / 3,
  };
}

function buildWallIncremental(
  base: ChunkBase, table: FaceTable, src: BlockSource,
  patch: PatchOverlay, fineE: Uint8Array, sideMask: Uint8Array,
): FaceGeometry {
  // ① 受影响边 → 预发到 scratch（emitWallSide：idx 相对自身，写时加 vi）
  const aff = new Map<number, { s: number; a: WallAccum; idx: number[]; nv: number }>();
  let s = 0;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      for (let dir = 0; dir < 4; dir++, s++) {
        if (!sideMask[s]) continue;
        const a: WallAccum = { pos: [], nor: [], uv: [], col: [], shd: [], pw: [] };
        const idx: number[] = [];
        const nv = emitWallSide(a, table, src, patch, fineE, lbx, lbz, dir, 0, idx);
        aff.set(s, { s, a, idx, nv });
      }
    }
  }
  // ② 总量
  let totalV = base.wallVPre[NBS], totalI = base.wallIPre[NBS];
  for (const e of aff.values()) {
    totalV += e.nv - base.wallV[e.s];
    totalI += e.nv / 4 * 6 - (base.wallV[e.s] / 4 * 6);
  }
  const vertices = new Float32Array(totalV * 3);
  const normals = new Float32Array(totalV * 3);
  const uvs = new Float32Array(totalV * 2);
  const colors = new Float32Array(totalV * 3);
  const shade = new Float32Array(totalV);
  const patchW = new Float32Array(totalV);
  const indices = new Uint32Array(totalI);
  // ④ 填充：边序遍历，受影响写 scratch、未受影响拷基座段
  const bw = base.wall;
  let vi = 0, ii = 0;
  s = 0;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      for (let dir = 0; dir < 4; dir++, s++) {
        const bVPre = base.wallVPre[s], bIPre = base.wallIPre[s];
        if (sideMask[s]) {
          const e = aff.get(s)!;
          vertices.set(e.a.pos, vi * 3);
          normals.set(e.a.nor, vi * 3);
          uvs.set(e.a.uv, vi * 2);
          colors.set(e.a.col, vi * 3);
          shade.set(e.a.shd, vi);
          patchW.set(e.a.pw, vi);
          for (let k = 0; k < e.idx.length; k++) indices[ii + k] = e.idx[k] + vi;
          vi += e.nv;
          ii += e.idx.length;
        } else {
          const vc = base.wallV[s];
          vertices.set(bw.vertices.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
          normals.set(bw.normals.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
          uvs.set(bw.uvs!.subarray(bVPre * 2, bVPre * 2 + vc * 2), vi * 2);
          colors.set(bw.colors!.subarray(bVPre * 3, bVPre * 3 + vc * 3), vi * 3);
          shade.set(bw.shade!.subarray(bVPre, bVPre + vc), vi);
          patchW.set(bw.patchW!.subarray(bVPre, bVPre + vc), vi);
          const ic = vc / 4 * 6;
          const delta = vi - bVPre;
          const is = bw.indices.subarray(bIPre, bIPre + ic);
          for (let k = 0; k < ic; k++) indices[ii + k] = is[k] + delta;
          vi += vc;
          ii += ic;
        }
      }
    }
  }
  return {
    vertices, normals, uvs, colors, shade, patchW, indices,
    topTriCount: 0,
  };
}

/**
 * ★ 增量几何入口：基座缓存缺失 → 构建基座（无补丁 full）后装配；命中 →
 * 只对受影响 cell/side 重发，其余拷基座。输出与 computeTableGeometry 的
 * full 构建逐位一致（受影响走同一 emit 函数；未受影响区 depthOf=0）。
 */
export function incrementalGeometry(
  seed: number, cx: number, cz: number,
  table: FaceTable, src: BlockSource, patch: PatchOverlay,
  masks?: { top: Uint8Array; side: Uint8Array },
): IncrementalResult {
  let base = baseCache.get(cacheKey(seed, cx, cz));
  if (!base) {
    const baseFine = topFineCells(table, src);
    const top = buildNoPatchTop(table, src);
    const wall = buildNoPatchWall(table, src);
    base = seedBaseGeometry(seed, cx, cz, table, src, baseFine, top, wall);
  }
  const fineE = topFineCellsFor(table, src, patch);
  // 掩码可主线程预算后传入（跳过 Worker 侧重复扫描）；缺省就地算
  const mask = masks ? masks.top : affectedTopMask(patch);
  const sideMask = masks ? masks.side : affectedSideMask(mask);
  return {
    top: buildTopIncremental(base, table, src, patch, fineE, mask),
    wall: buildWallIncremental(base, table, src, patch, fineE, sideMask),
  };
}

// 基座（无补丁）构建用同一 full 函数（与主线程/Worker 同源）
function buildNoPatchTop(table: FaceTable, src: BlockSource): FaceGeometry {
  return buildTopGeometry(table, src);
}
function buildNoPatchWall(table: FaceTable, src: BlockSource): FaceGeometry {
  return buildWallGeometry(table, src);
}

// ============================================================
// ★ 分区地面切分（2026-09-09）：物理按 grid×grid 空间分区（默认 3×3=9 块），
// 挖坑只重建受影响分区（提前返回，其余不动）。教训（§17.8）：225 个 4m 小块 +
// 预算队列 = 每帧 1 块 → 失败；此处 grid×grid（9 块）全同步创建，规避该坑。
// ============================================================

/** 分区网格数（每轴）；grid×grid 个物理分区 collider */
export const PHYS_GRID = 3;

/**
 * ★ 把整 chunk 顶面+侧壁切成 grid×grid 个分区 trimesh（slot = pcz*grid+pcx）。
 * 布局按输出 fine 掩码推导（受影响 cell 恒 fine、基座可能 coarse → 增量输出
 * 偏移后移，不能拿基座布局切）。每分区 = 若干 4m 块（各自 16 cell + 4 壁边）
 * 的字节拼接、索引重定基分区局部。cells 缺省 = 全部分区；增量只发受影响分区。
 */
export function partitionGroundCells(
  top: FaceGeometry, wall: FaceGeometry, fineE: Uint8Array,
  grid: number, cells?: number[] | null,
): { slot: number; vertices: Float32Array; indices: Uint32Array }[] {
  const tl = topLayout(fineE);
  const wl = wallLayout(fineE);
  const list = cells ?? Array.from({ length: grid * grid }, (_, i) => i);
  const out: { slot: number; vertices: Float32Array; indices: Uint32Array }[] = [];
  for (const slot of list) {
    const pcx = slot % grid, pcz = Math.floor(slot / grid);
    const bx0 = Math.floor((pcx * BPS) / grid), bx1 = Math.floor(((pcx + 1) * BPS) / grid);
    const bz0 = Math.floor((pcz * BPS) / grid), bz1 = Math.floor(((pcz + 1) * BPS) / grid);
    // ---- 总量：本分区所有 4m 块的 16 cell + 4 壁边 ----
    let vCount = 0, iCount = 0;
    for (let bz = bz0; bz < bz1; bz++) {
      for (let bx = bx0; bx < bx1; bx++) {
        for (let lz = bz * 4; lz < bz * 4 + 4; lz++) {
          for (let lx = bx * 4; lx < bx * 4 + 4; lx++) {
            const c = lz * N + lx;
            vCount += tl.v[c];
            iCount += fineE[c] ? TOP_FINE_TRI * 3 : TOP_COARSE_TRI * 3;
          }
        }
        for (let dir = 0; dir < 4; dir++) {
          const s = (bz * BPS + bx) * 4 + dir;
          vCount += wl.v[s];
          iCount += (wl.v[s] / 4) * 6;
        }
      }
    }
    if (vCount === 0) continue;
    const vertices = new Float32Array(vCount * 3);
    const indices = new Uint32Array(iCount);
    let vi = 0, ii = 0;
    const emitCell = (lx: number, lz: number): void => {
      const c = lz * N + lx;
      const vs = tl.vPre[c] * 3, vc = tl.v[c] * 3;
      vertices.set(top.vertices.subarray(vs, vs + vc), vi * 3);
      const is = tl.iPre[c], ic = fineE[c] ? TOP_FINE_TRI * 3 : TOP_COARSE_TRI * 3;
      for (let k = 0; k < ic; k++) indices[ii + k] = top.indices[is + k] - tl.vPre[c] + vi;
      vi += tl.v[c];
      ii += ic;
    };
    const emitSide = (bx: number, bz: number, dir: number): void => {
      const s = (bz * BPS + bx) * 4 + dir;
      const vs = wl.vPre[s] * 3, vc = wl.v[s] * 3;
      vertices.set(wall.vertices.subarray(vs, vs + vc), vi * 3);
      const is = wl.iPre[s], ic = (wl.v[s] / 4) * 6;
      for (let k = 0; k < ic; k++) indices[ii + k] = wall.indices[is + k] - wl.vPre[s] + vi;
      vi += wl.v[s];
      ii += ic;
    };
    for (let bz = bz0; bz < bz1; bz++) {
      for (let bx = bx0; bx < bx1; bx++) {
        for (let lz = bz * 4; lz < bz * 4 + 4; lz++) {
          for (let lx = bx * 4; lx < bx * 4 + 4; lx++) emitCell(lx, lz);
        }
        for (let dir = 0; dir < 4; dir++) emitSide(bx, bz, dir);
      }
    }
    out.push({ slot, vertices, indices });
  }
  return out;
}
