// ============================================================
// RegionFaceQuery —— 三维区域面查询工具（架构文档 §14，2026-09-05）
//   两段式（用户定调）：
//     阶段1 query3D(shape) —— 表粗筛：一个三维形状 → 涉及哪些面（FaceRef[]）
//     阶段2 classifyParts(RQ, shape) —— 每面哪部分区域在形状内（PartInfo[]）
//   形状 = 解析 SDF 复合：球 / 盒 / 折线槽（2.5D 有盖棱柱），union/intersect/subtract
//   两模式：
//     模式 A（表驱动，无实例）：读 FaceTable/src/fine 图 —— chunk 未建也能查
//     模式 B（实装对位）：terrain.builtOf 提供实际缓冲（渲染双 Mesh + 物理合并
//       trimesh），read/apply 读写真实几何；切片由表决定确定性重扫换算（§14.3）
//   ★ 顶/壁分割与索引布局 = buildTopGeometry/buildWallGeometry 的同序重扫：
//     coarse 顶 cell = 4 顶点/6 索引，fine = 81/384（FINE_S=8 → 8×8×6）；
//     壁 column quads = 4 + 7×(沿边 fine span 数)；物理 = 顶∪壁（nVT 偏移）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import {
  buildFaceTable,
  edgeEndpoints,
  type FaceTable,
  WALL_EPS,
  WALL_MIN_DEPTH,
} from "./FaceTable";
import { topFineCells, topYView } from "./FaceBuild";
import {
  surfaceHeightCore,
  type BlockSource,
} from "./Refinements";
import { chunkKeyOf } from "./RasterMap";

const N = CHUNK_SIZE; // 60
const BPS = BLOCKS_PER_SIDE; // 15
/** fine 细分数（与 FaceBuild.FINE_S 同值：0.125m 子网格） */
export const FINE_S = 8;

// ------------------------------------------------------------
// 形状（解析 SDF 复合）
// ------------------------------------------------------------

export interface AABB3 {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export type Shape3D =
  | { kind: "sphere"; x: number; y: number; z: number; r: number }
  | { kind: "box"; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  | { kind: "slot"; pts: [number, number][]; halfW: number; topY: number; depth: number }
  | { kind: "union"; a: Shape3D; b: Shape3D }
  | { kind: "intersect"; a: Shape3D; b: Shape3D }
  | { kind: "subtract"; a: Shape3D; b: Shape3D };

/** 形状包围盒 */
export function boundsOf(s: Shape3D): AABB3 {
  switch (s.kind) {
    case "sphere": {
      const r = s.r;
      return { minX: s.x - r, minY: s.y - r, minZ: s.z - r, maxX: s.x + r, maxY: s.y + r, maxZ: s.z + r };
    }
    case "box":
      return { minX: s.minX, minY: s.minY, minZ: s.minZ, maxX: s.maxX, maxY: s.maxY, maxZ: s.maxZ };
    case "slot": {
      let mnX = Infinity, mnZ = Infinity, mxX = -Infinity, mxZ = -Infinity;
      for (const [x, z] of s.pts) {
        mnX = Math.min(mnX, x); mxX = Math.max(mxX, x);
        mnZ = Math.min(mnZ, z); mxZ = Math.max(mxZ, z);
      }
      return {
        minX: mnX - s.halfW, minZ: mnZ - s.halfW,
        maxX: mxX + s.halfW, maxZ: mxZ + s.halfW,
        minY: s.topY - s.depth, maxY: s.topY,
      };
    }
    case "union":
    case "intersect":
    case "subtract": {
      const a = boundsOf(s.a), b = boundsOf(s.b);
      if (s.kind === "union") {
        return {
          minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), minZ: Math.min(a.minZ, b.minZ),
          maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY), maxZ: Math.max(a.maxZ, b.maxZ),
        };
      }
      // intersect / subtract：仅当与 a 相交才有意义 → 用 a 的界（保守）
      return a;
    }
  }
}

/** 点到折线段集（含首尾连线）的最小距离 */
function distToPolyline(pts: [number, number][], x: number, z: number): number {
  let dMin = Infinity;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], z - pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const cx = ax + t * dx, cz = az + t * dz;
    dMin = Math.min(dMin, Math.hypot(x - cx, z - cz));
  }
  return dMin;
}

/** 带符号距离函数：sdf(p) ≤ 0 ⇔ p 在形状内 */
export function sdfAt(s: Shape3D, x: number, y: number, z: number): number {
  switch (s.kind) {
    case "sphere":
      return Math.hypot(x - s.x, y - s.y, z - s.z) - s.r;
    case "box":
      return Math.max(
        x - s.maxX, s.minX - x,
        y - s.maxY, s.minY - y,
        z - s.maxZ, s.minZ - z,
      );
    case "slot": {
      const d = distToPolyline(s.pts, x, z) - s.halfW;
      return Math.max(d, s.topY - s.depth - y, y - s.topY);
    }
    case "union":
      return Math.min(sdfAt(s.a, x, y, z), sdfAt(s.b, x, y, z));
    case "intersect":
      return Math.max(sdfAt(s.a, x, y, z), sdfAt(s.b, x, y, z));
    case "subtract":
      return Math.max(sdfAt(s.a, x, y, z), -sdfAt(s.b, x, y, z));
  }
}

export const containsShape = (s: Shape3D, x: number, y: number, z: number): boolean =>
  sdfAt(s, x, y, z) <= 0;

/**
 * 形状在 (x,z) 处的垂直下压量（“挖多深”代理；§13 的 deformOffset 由消费者经
 * ClassifyOpts.depthAt 覆写）。对真删补/编辑可另给精确函数。
 */
export function verticalPushOf(s: Shape3D, x: number, y: number, z: number): number {
  if (!containsShape(s, x, y, z)) return 0;
  switch (s.kind) {
    case "sphere": {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d >= s.r) return 0;
      return Math.sqrt(s.r * s.r - d * d); // 垂直穿深（球心正下方最深）
    }
    case "box":
      return s.maxY - Math.max(s.minY, Math.min(y, s.maxY));
    case "slot":
      return Math.min(s.depth, s.topY - Math.min(y, s.topY));
    default:
      return Math.max(0, -sdfAt(s, x, y, z));
  }
}

// ------------------------------------------------------------
// 拓扑重扫（顶/壁/物理的确定性布局；与 FaceBuild 装配完全同构）
// ------------------------------------------------------------

export interface TopLayout {
  vB: Uint32Array; // 第 (lx,lz) cell 顶点基址
  iB: Uint32Array; // 第 (lx,lz) cell 索引基址
  topVtx: number;  // 顶顶点总数（= 物理 nVT）
  topIdx: number;  // 顶索引总数（= 物理顶索引段长）
}

/** key = (lbz*BPS+lbx)*4+dir */
export interface WallLayout {
  vB: Uint32Array;
  iB: Uint32Array;
  quads: Uint32Array; // 该 column 的 quad 数
  wallVtx: number;
  wallIdx: number;
}

export function buildTopLayout(fineE: Uint8Array): TopLayout {
  const vB = new Uint32Array(N * N);
  const iB = new Uint32Array(N * N);
  let v = 0, i = 0;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      vB[lz * N + lx] = v;
      iB[lz * N + lx] = i;
      if (fineE[lz * N + lx]) { v += (FINE_S + 1) * (FINE_S + 1); i += FINE_S * FINE_S * 6; }
      else { v += 4; i += 6; }
    }
  }
  return { vB, iB, topVtx: v, topIdx: i };
}

const wallKey = (lbx: number, lbz: number, dir: number) => (lbz * BPS + lbx) * 4 + dir;

/** 某块 dir 边沿 4 个 1m span 的 fine 标记（与 FaceBuild.dirEdgeCells 同式） */
export function dirEdgeCells(dir: number, lbx: number, lbz: number, fineE: Uint8Array): Uint8Array {
  const out = new Uint8Array(4);
  if (dir === 0 || dir === 1) {
    const lx = lbx * 4 + (dir === 0 ? 3 : 0);
    for (let j = 0; j < 4; j++) out[j] = fineE[(lbz * 4 + j) * N + lx];
  } else {
    const lz = lbz * 4 + (dir === 2 ? 3 : 0);
    for (let j = 0; j < 4; j++) out[j] = fineE[lz * N + lbx * 4 + j];
  }
  return out;
}

export function buildWallLayout(fineE: Uint8Array): WallLayout {
  const vB = new Uint32Array(BPS * BPS * 4);
  const iB = new Uint32Array(BPS * BPS * 4);
  const quads = new Uint32Array(BPS * BPS * 4);
  let v = 0, i = 0;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      for (let dir = 0; dir < 4; dir++) {
        const k = wallKey(lbx, lbz, dir);
        vB[k] = v; iB[k] = i;
        const row = dirEdgeCells(dir, lbx, lbz, fineE);
        let f = 0;
        for (let s = 0; s < 4; s++) if (row[s]) f++;
        const q = 4 + 7 * f; // 4 个 1m coarse + 每 fine span 各多插入 7 个节点
        quads[k] = q;
        v += 4 * q; i += 6 * q;
      }
    }
  }
  return { vB, iB, quads, wallVtx: v, wallIdx: i };
}

// ------------------------------------------------------------
// 面引用与 chunk 上下文
// ------------------------------------------------------------

export interface RenderSlice {
  mesh: "top" | "wall";
  vBase: number; vCount: number;
  iBase: number; iCount: number;
}

export interface PhysSlice {
  vBase: number; vCount: number; // 物理合并缓冲（壁已含 nVT 偏移）
  iBase: number; iCount: number;
}

export type FaceRef =
  | {
    kind: "top-cell";
    fid: number;
    cx: number; cz: number;
    lx: number; lz: number; // chunk 局部 1m 格
    bx: number; bz: number; // 视角块
    isFine: boolean;
    render: RenderSlice;
    phys: PhysSlice;
  }
  | {
    kind: "wall";
    fid: number;
    cx: number; cz: number;
    bx: number; bz: number; // 发墙块
    dir: number;
    render: RenderSlice;
    phys: PhysSlice;
  };

/** 模式 B：已建 chunk 的实际缓冲（渲染顶/壁双 Mesh + 物理合并 trimesh，§6.5 同源） */
export interface BuiltChunk {
  key: number;
  topVertices: Float32Array;
  topIndices: Uint32Array;
  wallVertices: Float32Array;
  wallIndices: Uint32Array;
  physVertices: Float32Array;
  physIndices: Uint32Array;
}

export interface RegionTerrain {
  chunkSource(cx: number, cz: number): BlockSource;
  builtOf?(cx: number, cz: number): BuiltChunk | null;
  getTable?(cx: number, cz: number): FaceTable | null;
}

export interface ChunkCtx {
  key: number;
  cx: number; cz: number;
  src: BlockSource;
  table: FaceTable;
  fineE: Uint8Array;
  top: TopLayout;
  walls: WallLayout;
  built: BuiltChunk | null;
}

export interface RegionQuery {
  shape: Shape3D;
  bounds: AABB3;
  chunks: Map<number, ChunkCtx>;
  faces: FaceRef[];
}

// ------------------------------------------------------------
// 阶段 1：表查询粗筛（shape → 涉及哪些面）
// ------------------------------------------------------------

function chunkKeysIn(a: AABB3): { cx: number; cz: number }[] {
  const out: { cx: number; cz: number }[] = [];
  const c0x = Math.floor(a.minX / N), c1x = Math.floor((a.maxX - 1e-9) / N);
  const c0z = Math.floor(a.minZ / N), c1z = Math.floor((a.maxZ - 1e-9) / N);
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) out.push({ cx, cz });
  }
  return out;
}

/** 线段（2D）是否与 AABB（2D）相交（slab 裁剪） */
function segHitsAabb(
  x0: number, z0: number, x1: number, z1: number,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  const slabs: [number, number, number][] = [
    [b.minX - x0, b.maxX - x0, dx],
    [b.minZ - z0, b.maxZ - z0, dz],
  ];
  for (const [lo, hi, d] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (x0 < lo && x0 > hi) return false;
      continue;
    }
    const a = Math.min(lo / d, hi / d), c = Math.max(lo / d, hi / d);
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

const aabbOverlap2D = (
  x0: number, z0: number, x1: number, z1: number,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean => x0 < b.maxX && x1 > b.minX && z0 < b.maxZ && z1 > b.minZ;

/** 顶 cell 的保守 y 窗口（覆盖 bevel 下弯 ≤0.3 + weld 慢坡进顶邻差） */
function cellYWindow(
  src: BlockSource, bx: number, bz: number, h: number,
): { yLow: number; yHigh: number } {
  let maxH = h, minBase = h;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nb = src.blockAt(bx + dx, bz + dz);
      if (!nb) continue;
      maxH = Math.max(maxH, nb.h);
      minBase = Math.min(minBase, nb.hBase ?? nb.h);
    }
  }
  return { yLow: minBase - 1.2, yHigh: maxH + 0.5 };
}

const yOverlap = (y0: number, y1: number, b: { minY: number; maxY: number }): boolean =>
  y1 > b.minY && y0 < b.maxY;

export function query3D(shape: Shape3D, terrain: RegionTerrain): RegionQuery {
  const B = boundsOf(shape);
  const chunks = new Map<number, ChunkCtx>();
  const faces: FaceRef[] = [];
  let fid = 0;

  for (const { cx, cz } of chunkKeysIn(B)) {
    const key = chunkKeyOf(cx, cz);
    const src = terrain.chunkSource(cx, cz);
    const table = terrain.getTable?.(cx, cz) ?? buildFaceTable(src, cx, cz);
    const fineE = topFineCells(table, src);
    const top = buildTopLayout(fineE);
    const walls = buildWallLayout(fineE);
    const built = terrain.builtOf?.(cx, cz) ?? null;
    const ctx: ChunkCtx = { key, cx, cz, src, table, fineE, top, walls, built };
    chunks.set(key, ctx);

    const ox = cx * N, oz = cz * N;

    // ---- 顶 cell：足迹与 B.xy 相交 且 表面高 y 窗口与 B.y 重叠 ----
    const lx0 = Math.max(0, Math.floor(B.minX - ox));
    const lx1 = Math.min(N - 1, Math.ceil(B.maxX - ox - 1e-9));
    const lz0 = Math.max(0, Math.floor(B.minZ - oz));
    const lz1 = Math.min(N - 1, Math.ceil(B.maxZ - oz - 1e-9));
    for (let lz = lz0; lz <= lz1; lz++) {
      for (let lx = lx0; lx <= lx1; lx++) {
        if (!aabbOverlap2D(ox + lx, oz + lz, ox + lx + 1, oz + lz + 1, B)) continue;
        const bx = cx * BPS + Math.floor(lx / 4);
        const bz = cz * BPS + Math.floor(lz / 4);
        const cell = table.cells[(bz - cz * BPS) * BPS + (bx - cx * BPS)];
        const win = cellYWindow(src, bx, bz, cell.h);
        if (!yOverlap(win.yLow, win.yHigh, B)) continue;
        const fine = fineE[lz * N + lx] === 1;
        const k = lz * N + lx;
        const vCount = fine ? (FINE_S + 1) * (FINE_S + 1) : 4;
        const iCount = fine ? FINE_S * FINE_S * 6 : 6;
        faces.push({
          kind: "top-cell", fid: fid++,
          cx, cz, lx, lz, bx, bz, isFine: fine,
          render: { mesh: "top", vBase: top.vB[k], vCount, iBase: top.iB[k], iCount },
          phys: { vBase: top.vB[k], vCount, iBase: top.iB[k], iCount },
        });
      }
    }

    // ---- 壁 column：贴边竖条带（顶沿~lowBase−EPS−MIN）与 B 相交 ----
    const b0x = Math.max(0, Math.floor((B.minX - ox) / 4) - 1);
    const b1x = Math.min(BPS - 1, Math.ceil((B.maxX - ox) / 4) - 1e-9 + 1);
    const b0z = Math.max(0, Math.floor((B.minZ - oz) / 4) - 1);
    const b1z = Math.min(BPS - 1, Math.ceil((B.maxZ - oz) / 4) - 1e-9 + 1);
    for (let lbz = b0z; lbz <= b1z; lbz++) {
      for (let lbx = b0x; lbx <= b1x; lbx++) {
        const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
        const cell = table.cells[lbz * BPS + lbx];
        for (let dir = 0; dir < 4; dir++) {
          const [[ex0, ez0], [ex1, ez1]] = edgeEndpoints(bx, bz, dir);
          if (!segHitsAabb(ex0, ez0, ex1, ez1, B)) continue;
          const side = cell.sides[dir as 0 | 1 | 2 | 3];
          const nbx = bx + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
          const nbz = bz + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
          const nb = src.blockAt(nbx, nbz);
          const nbBase = nb?.hBase ?? nb?.h ?? cell.h;
          const cellBase = cell.hBase ?? cell.h;
          const yHigh = side.topEdgeY + 0.4;
          const yLow = Math.min(cellBase, nbBase) - 0.8;
          if (!yOverlap(yLow, yHigh, B)) continue;
          const k = wallKey(lbx, lbz, dir);
          const q = walls.quads[k];
          faces.push({
            kind: "wall", fid: fid++,
            cx, cz, bx, bz, dir,
            render: { mesh: "wall", vBase: walls.vB[k], vCount: q * 4, iBase: walls.iB[k], iCount: q * 6 },
            phys: {
              vBase: top.topVtx + walls.vB[k], vCount: q * 4,
              iBase: top.topIdx + walls.iB[k], iCount: q * 6,
            },
          });
        }
      }
    }
  }

  return { shape, bounds: B, chunks, faces };
}

// ------------------------------------------------------------
// 阶段 2：classifyParts —— 每面哪部分区域在形状内
// ------------------------------------------------------------

export interface VertexPartIn {
  gx: number; gz: number; // 世界格点/采样点
  y: number;              // 几何同式顶高
  inside: boolean;
  depth: number;          // 垂直下压量（deformOffset 代理）
}

export interface Crossing {
  isX: boolean;   // true = 横网格边（x 变）；false = 纵网格边（z 变）
  a: number; b: number; // 采样点下标 (a<b)
  t: number;            // 交点参数 t∈[0,1] 沿 a→b
  x: number; y: number; z: number;
}

export interface PartTop {
  res: number;            // 本次分类采样步长（细格 >=0.125）
  gridN: number;          // 每边采样点数（细格=9 / coarse=2）
  verts: VertexPartIn[];
  triStates: Int8Array;   // 逐三角 1=fully inside 0=外 -1=partial（跨界）
  crossings: Crossing[];
  needRefine: boolean;    // coarse cell 出现命中 → 需升 fine 才能精确改动
}

export interface WallNode {
  x: number; z: number;
  topY: number; botY: number;
  inside: boolean;
  depth: number;
}

export interface PartWall {
  dir: number;
  nodes: WallNode[];    // 沿边节点列（与顶网格边界同点 → 侧壁同步天然一致）
  quadInside: Int8Array; // 1=内部 -1=partial 0=外
  spanBits: Uint8Array;  // quad 命中位
  crossingT: number[];   // 顶沿交点参数（quad 局部：i + t）
}

export interface PartInfo {
  fid: number;
  involved: boolean;
  top?: PartTop;
  wall?: PartWall;
  /** cadence：coarse/fine 混合边 4 位掩码（dir 0:+x 1:−x 2:+z 3:−z；1 = 该向邻 cell 细度不同） */
  cadenceMixed: number;
}

export interface ClassifyOpts {
  resolution?: number; // 分类采样步长（默认 0.125；clamp 到细格 ≥0.125）
  depthAt?: (x: number, y: number, z: number) => number;
}

const clampRes = (r: number | undefined) => {
  const v = r ?? 0.125;
  return Math.max(0.125, Math.min(1, v));
};

function classifyTopCell(
  q: RegionQuery,
  face: Extract<FaceRef, { kind: "top-cell" }>,
  opts: ClassifyOpts,
): PartTop {
  const ctx = q.chunks.get(chunkKeyOf(face.cx, face.cz))!;
  const { table, src } = ctx;
  const wx0 = face.cx * N + face.lx, wz0 = face.cz * N + face.lz;
  const res = face.isFine ? clampRes(opts.resolution) : 1;
  const gridN = face.isFine ? Math.floor(1 / res) + 1 : 2;
  const depthOf = opts.depthAt ?? ((x: number, y: number, z: number) => verticalPushOf(q.shape, x, y, z));

  const verts: VertexPartIn[] = new Array(gridN * gridN);
  let anyIn = false;
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      const wxx = wx0 + (gx / (gridN - 1));
      const wzz = wz0 + (gy / (gridN - 1));
      const y = topYView(table, src, face.bx, face.bz, wxx, wzz);
      const inside = containsShape(q.shape, wxx, y, wzz);
      if (inside) anyIn = true;
      verts[gy * gridN + gx] = { gx: wxx, gz: wzz, y, inside, depth: inside ? depthOf(wxx, y, wzz) : 0 };
    }
  }
  const sub = gridN - 1;
  const nt = sub * sub * 2;
  const triStates = new Int8Array(nt);
  const crossings: Crossing[] = [];
  let t = 0;
  for (let jz = 0; jz < sub; jz++) {
    for (let jx = 0; jx < sub; jx++) {
      const i00 = jz * gridN + jx, i10 = jz * gridN + jx + 1;
      const i01 = (jz + 1) * gridN + jx, i11 = (jz + 1) * gridN + jx + 1;
      // 对角剖分 01-10（同 buildTopGeometry 绕序）
      for (const [a, b, c] of [[i00, i01, i10], [i01, i11, i10]] as const) {
        const vA = verts[a], vB = verts[b], vC = verts[c];
        let cnt = 0;
        if (vA.inside) cnt++; if (vB.inside) cnt++; if (vC.inside) cnt++;
        if (cnt === 3) { triStates[t] = 1; }
        else if (cnt === 0) { triStates[t] = 0; }
        else {
          triStates[t] = -1;
          for (const [p1, p2] of [[a, b], [b, c], [c, a]] as const) {
            const e1 = verts[p1], e2 = verts[p2];
            if (e1.inside === e2.inside) continue;
            const xA = e1.gx, zA = e1.gz, yA = e1.y;
            const xB = e2.gx, zB = e2.gz, yB = e2.y;
            let lo = 0, hi = 1;
            for (let iter = 0; iter < 40; iter++) {
              const mid = (lo + hi) / 2;
              const xx = xA + (xB - xA) * mid;
              const zz = zA + (zB - zA) * mid;
              const yy = yA + (yB - yA) * mid;
              if (sdfAt(q.shape, xx, yy, zz) <= 0) lo = mid; else hi = mid;
            }
            const tt = (lo + hi) / 2;
            crossings.push({
              isX: Math.abs(zB - zA) < 1e-9,
              a: p1, b: p2, t: tt,
              x: xA + (xB - xA) * tt,
              y: yA + (yB - yA) * tt,
              z: zA + (zB - zA) * tt,
            });
          }
        }
        t++;
      }
    }
  }
  return {
    res,
    gridN,
    verts,
    triStates,
    crossings,
    needRefine: !face.isFine && anyIn,
  };
}

function classifyWallColumn(
  q: RegionQuery,
  face: Extract<FaceRef, { kind: "wall" }>,
  opts: ClassifyOpts,
): PartWall {
  const ctx = q.chunks.get(chunkKeyOf(face.cx, face.cz))!;
  const { table, src, fineE } = ctx;
  const lbx = face.bx - face.cx * BPS, lbz = face.bz - face.cz * BPS;
  const nodes = wallNodes(dirEdgeCells(face.dir, lbx, lbz, fineE));
  const m = nodes.length;
  const bx = face.bx, bz = face.bz;
  const nbx = bx + (face.dir === 0 ? 1 : face.dir === 1 ? -1 : 0);
  const nbz = bz + (face.dir === 2 ? 1 : face.dir === 3 ? -1 : 0);
  const nb = src.blockAt(nbx, nbz);
  const nbBase = nb?.hBase ?? nb?.h ?? 0;
  const cell = table.cells[lbz * BPS + lbx];
  const cellBase = cell.hBase ?? cell.h;
  const depthOf = opts.depthAt ?? ((x: number, y: number, z: number) => verticalPushOf(q.shape, x, y, z));

  const { gxW, gzW, topY, botY } = wallEdgeGeometry(face, nodes, table, src, nbx, nbz, cellBase, nbBase);

  const out: WallNode[] = new Array(m);
  for (let i = 0; i < m; i++) {
    const inside = containsShape(q.shape, gxW[i], topY[i], gzW[i]);
    out[i] = {
      x: gxW[i], z: gzW[i], topY: topY[i], botY: botY[i],
      inside,
      depth: inside ? depthOf(gxW[i], topY[i], gzW[i]) : 0,
    };
  }
  const quadInside = new Int8Array(m - 1);
  const spanBits = new Uint8Array(m - 1);
  const crossingT: number[] = [];
  for (let i = 0; i < m - 1; i++) {
    const a = out[i], b = out[i + 1];
    if (a.inside && b.inside) { quadInside[i] = 1; spanBits[i] = 1; }
    else if (!a.inside && !b.inside) { quadInside[i] = 0; }
    else {
      quadInside[i] = -1; spanBits[i] = 1;
      let lo = 0, hi = 1;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        const xx = a.x + (b.x - a.x) * mid;
        const zz = a.z + (b.z - a.z) * mid;
        const yy = a.topY + (b.topY - a.topY) * mid;
        if (sdfAt(q.shape, xx, yy, zz) <= 0) lo = mid; else hi = mid;
      }
      crossingT.push(i + (lo + hi) / 2);
    }
  }
  return { dir: face.dir, nodes: out, quadInside, spanBits, crossingT };
}

/** 沿边节点列（世界参数 s∈[0,4]；fine span 每 0.125m 一节点，其余 1m） */
export function wallNodes(rowCells: Uint8Array): number[] {
  const nodes: number[] = [];
  for (let span = 0; span < 4; span++) {
    const sub = rowCells[span] ? FINE_S : 1;
    for (let k = 0; k < sub; k++) nodes.push(span + k / sub);
  }
  nodes.push(4);
  return nodes;
}

/** 壁沿节点世界坐标 + 顶/底高（与 buildWallGeometry 同式：顶=本块 topYView，底=低侧基底−EPS−MIN） */
function wallEdgeGeometry(
  face: Extract<FaceRef, { kind: "wall" }>,
  nodes: number[],
  table: FaceTable,
  src: BlockSource,
  nbx: number, nbz: number,
  cellBase: number, nbBase: number,
): { gxW: number[]; gzW: number[]; topY: number[]; botY: number[] } {
  const m = nodes.length;
  const bx = face.bx, bz = face.bz;
  const x0 = bx * 4, z0 = bz * 4;
  let ax: number, az: number, bxe: number, bze: number;
  if (face.dir === 0) { ax = x0 + 4; az = z0; bxe = x0 + 4; bze = z0 + 4; }
  else if (face.dir === 1) { ax = x0; az = z0; bxe = x0; bze = z0 + 4; }
  else if (face.dir === 2) { ax = x0; az = z0 + 4; bxe = x0 + 4; bze = z0 + 4; }
  else { ax = x0; az = z0; bxe = x0 + 4; bze = z0; }
  const gxW = new Array<number>(m), gzW = new Array<number>(m);
  const topY = new Array<number>(m), botY = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    const s = nodes[i];
    const gx = ax + (bxe - ax) * (s / 4);
    const gz = az + (bze - az) * (s / 4);
    const nxt = i < m - 1 ? nodes[i + 1] : s;
    const top = topYView(table, src, bx, bz, gx, gz);
    const nbTop = Math.max(
      surfaceHeightCore(src, nbx, nbz, gx, gz),
      surfaceHeightCore(src, nbx, nbz,
        ax + (bxe - ax) * (nxt / 4), az + (bze - az) * (nxt / 4)),
    );
    const lowV = Math.min(nbTop, cellBase, nbBase);
    gxW[i] = gx; gzW[i] = gz;
    topY[i] = top;
    botY[i] = Math.min(top, lowV - WALL_EPS - WALL_MIN_DEPTH);
  }
  return { gxW, gzW, topY, botY };
}

export function classifyParts(
  q: RegionQuery,
  opts: ClassifyOpts = {},
): PartInfo[] {
  return q.faces.map((f) => {
    if (f.kind === "top-cell") {
      return {
        fid: f.fid,
        involved: true,
        top: classifyTopCell(q, f, opts),
        cadenceMixed: cadenceMask(q, f),
      };
    }
    return {
      fid: f.fid,
      involved: true,
      wall: classifyWallColumn(q, f, opts),
      cadenceMixed: 0,
    };
  });
}

/** coarse/fine 混合边 4 位掩码（1 = 该向邻 cell fine 态与本 cell 不同 → 改动需连带） */
function cadenceMask(q: RegionQuery, f: Extract<FaceRef, { kind: "top-cell" }>): number {
  const ctx = q.chunks.get(chunkKeyOf(f.cx, f.cz))!;
  const { fineE } = ctx;
  const mine = f.isFine;
  let mask = 0;
  const at = (x: number, z: number): boolean => {
    if (x >= 0 && z >= 0 && x < N && z < N) return fineE[z * N + x] === 1;
    return true; // 跨界保守记为差异（防漏 T 结）
  };
  if (at(f.lx + 1, f.lz) !== mine) mask |= 1;
  if (at(f.lx - 1, f.lz) !== mine) mask |= 2;
  if (at(f.lx, f.lz + 1) !== mine) mask |= 4;
  if (at(f.lx, f.lz - 1) !== mine) mask |= 8;
  return mask;
}

// ------------------------------------------------------------
// 模式 B：read / apply（真实访问渲染与物理切片的读写入口）
// ------------------------------------------------------------

/** 面内顶点槽位（渲染 Mesh + 物理合并缓冲的对位下标；同世界点跨面/跨 quad 由 apply 按 key 合并） */
export interface VertexSlot {
  x: number; y: number; z: number;
  renderMesh: "top" | "wall";
  renderVertex: number[];
  physVertex: number[];
}

export function resolveFaceVertices(q: RegionQuery, f: FaceRef): VertexSlot[] {
  const ctx = q.chunks.get(chunkKeyOf(f.cx, f.cz))!;
  const out: VertexSlot[] = [];
  if (f.kind === "top-cell") {
    const vB = ctx.top.vB[f.lz * N + f.lx];
    if (f.isFine) {
      for (let gy = 0; gy <= FINE_S; gy++) {
        for (let gx = 0; gx <= FINE_S; gx++) {
          const wx = f.cx * N + f.lx + gx / FINE_S;
          const wz = f.cz * N + f.lz + gy / FINE_S;
          const y = topYView(ctx.table, ctx.src, f.bx, f.bz, wx, wz);
          const vi = vB + gy * (FINE_S + 1) + gx;
          out.push({ x: wx, y, z: wz, renderMesh: "top", renderVertex: [vi], physVertex: [vi] });
        }
      }
    } else {
      const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      corners.forEach(([dx, dz], i) => {
        const wx = f.cx * N + f.lx + dx;
        const wz = f.cz * N + f.lz + dz;
        const y = topYView(ctx.table, ctx.src, f.bx, f.bz, wx, wz);
        out.push({ x: wx, y, z: wz, renderMesh: "top", renderVertex: [vB + i], physVertex: [vB + i] });
      });
    }
    return out;
  }
  // wall：沿边节点 → 每个节点在渲染/物理里的顶沿槽位（quad 邻接处重复两槽）
  const lbx = f.bx - f.cx * BPS, lbz = f.bz - f.cz * BPS;
  const nodes = wallNodes(dirEdgeCells(f.dir, lbx, lbz, ctx.fineE));
  const m = nodes.length;
  const nbx = f.bx + (f.dir === 0 ? 1 : f.dir === 1 ? -1 : 0);
  const nbz = f.bz + (f.dir === 2 ? 1 : f.dir === 3 ? -1 : 0);
  const nb = ctx.src.blockAt(nbx, nbz);
  const nbBase = nb?.hBase ?? nb?.h ?? 0;
  const cell = ctx.table.cells[lbz * BPS + lbx];
  const cellBase = cell.hBase ?? cell.h;
  const { gxW, gzW, topY, botY } = wallEdgeGeometry(f, nodes, ctx.table, ctx.src, nbx, nbz, cellBase, nbBase);
  const vB = f.render.vBase;
  const pB = f.phys.vBase;
  for (let i = 0; i < m; i++) {
    // 节点 i 同时是 quad i 的 topA 与 quad i-1 的 topB（tiling 不共享顶点 → 双双登记）
    const slots: number[] = [];
    if (i < m - 1) slots.push(vB + i * 2);           // quad i   topA
    if (i > 0) slots.push(vB + (i - 1) * 2 + 1);     // quad i-1 topB
    const ps: number[] = [];
    if (i < m - 1) ps.push(pB + i * 2);
    if (i > 0) ps.push(pB + (i - 1) * 2 + 1);
    out.push({ x: gxW[i], y: topY[i], z: gzW[i], renderMesh: "wall", renderVertex: slots, physVertex: ps });
  }
  void botY;
  return out;
}

export interface VertexUpdate {
  x: number; z: number; dy: number;
}

/**
 * 写回：对涉及面的每个顶点槽位，按世界 (x,z) 匹配增量 dy，写入渲染顶/壁缓冲
 * 与物理合并缓冲（同序同值 → 渲染=物理强一致）。返回写入槽位数。
 * ★ 顶沿↔壁顶沿同世界点：按 (x,z) 统一 key → 两侧同值（侧壁同步天然达成）。
 */
export function applyFaceVertices(
  q: RegionQuery,
  updates: VertexUpdate[],
  terrain: RegionTerrain,
): number {
  const delta = new Map<string, number>();
  for (const u of updates) delta.set(worldKey(u.x, u.z), u.dy);
  let written = 0;
  for (const f of q.faces) {
    const ctx = q.chunks.get(chunkKeyOf(f.cx, f.cz))!;
    const built = ctx.built ?? terrain.builtOf?.(f.cx, f.cz) ?? null;
    if (!built) continue; // 未建 chunk：模式 A 只读不落缓冲
    const slots = resolveFaceVertices(q, f);
    for (const s of slots) {
      const dy = delta.get(worldKey(s.x, s.z));
      if (dy === undefined) continue;
      for (const vi of s.renderVertex) {
        const arr = s.renderMesh === "top" ? built.topVertices : built.wallVertices;
        arr[vi * 3 + 1] = s.y + dy;
        written++;
      }
      for (const vi of s.physVertex) built.physVertices[vi * 3 + 1] = s.y + dy;
    }
  }
  return written;
}

/** 世界点 key（0.125 网格对齐取整 → 顶沿与壁顶沿同点必同 key） */
export const worldKey = (x: number, z: number): string =>
  `${(Math.round(x * 8) / 8).toFixed(3)},${(Math.round(z * 8) / 8).toFixed(3)}`;

// ------------------------------------------------------------
// 拓扑回归自检（供测试脚本调用）：重扫布局 vs 一次性装配的顶点/索引总数逐位一致
// ------------------------------------------------------------

export function layoutMatchesBuild(
  fineE: Uint8Array,
  topG: { vertices: Float32Array; indices: Uint32Array },
  wallG: { vertices: Float32Array; indices: Uint32Array },
): { ok: boolean; detail: string } {
  const top = buildTopLayout(fineE);
  const walls = buildWallLayout(fineE);
  const topN = topG.vertices.length / 3, topI = topG.indices.length;
  const wallN = wallG.vertices.length / 3, wallI = wallG.indices.length;
  const ok =
    top.topVtx === topN && top.topIdx === topI &&
    walls.wallVtx === wallN && walls.wallIdx === wallI;
  const detail =
    `top(v=${top.topVtx}/${topN} i=${top.topIdx}/${topI}) ` +
    `wall(v=${walls.wallVtx}/${wallN} i=${walls.wallIdx}/${wallI})`;
  return { ok, detail };
}