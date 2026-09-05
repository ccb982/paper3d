// ============================================================
// RegionDeform —— 查询后的修改落位（架构文档 §13/§14.5，2026-09-05）
//   查询（query3D）→ 分类（classifyParts）之后，把区域形状真正改写进地形：
//     · 就地哑改（fine cell / 整格在形状内的 coarse cell）：下沉顶点 → 顶/壁/物理
//       三缓同步 + 法线重算（顶沿↔壁顶沿同世界点同值 → 水密自然达成）
//     · 重建决策（coarse 部分覆盖 cell 需升 fine 才能精确改动）：返回重建清单，
//       由装配方按 deform 高度源整 chunk 重建（§13.6 deformYView，下阶段）
//   坑剖面（§13.4）：平底 + 陡壁 smoothstep（s(u)=3u²−2u³,u=(R−r)/0.35，两端 C¹）
//   深度/下沉量默认 verticalPushOf（形状通用代理），可由 depthAt 覆写（§13.4 dent）
// ============================================================

import {
  applyFaceVertices,
  classifyParts,
  resolveFaceVertices,
  type BuiltChunk,
  type ChunkCtx,
  type FaceRef,
  type PartInfo,
  type RegionQuery,
  type VertexUpdate,
  worldKey,
} from "./RegionFaceQuery";
import { topYView } from "./FaceBuild";
import { chunkKeyOf } from "./RasterMap";

const N = 60;

// ------------------------------------------------------------
// 坑剖面（§13.4）：平底 + 陡壁 smoothstep（R=口沿半径，D=坑深，壁宽 0.35m）
// ------------------------------------------------------------

/** 陡壁带宽（m）：口沿 r=R 处 offset=0（两端 C¹），坑底 r≤R−0.35 均匀平面 −D */
export const PIT_WALL = 0.35;

export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** 径向 (r: 到坑心水平距离) 的下沉量（≤0） */
export function pitProfileOffset(r: number, R: number, D: number): number {
  if (r >= R) return 0;
  const u = (R - r) / PIT_WALL;
  const s = u >= 1 ? 1 : smoothstep(u);
  return -D * s;
}

/** 生成 §13.4 dent 的 depthAt（返回下压深度 ≥0；坑心下方最深，口沿 0） */
export const pitDepthUnder = (cx: number, cz: number, R: number, D: number) =>
  (x: number, _y: number, z: number): number => Math.max(0, -pitProfileOffset(Math.hypot(x - cx, z - cz), R, D));

// ------------------------------------------------------------
// 落位决策（哪些面就地改、哪些 cell 需升 fine 重建）
// ------------------------------------------------------------

export interface DeformCellRef {
  lx: number; lz: number; bx: number; bz: number;
}

export interface RebuildRecord {
  key: number;
  cx: number; cz: number;
  cells: DeformCellRef[];
  reason: string;
}

export interface DeformPlan {
  updates: VertexUpdate[];
  /** 就地改动（fine 顶 cell / 整格在形状内 coarse cell）的 fid 集 */
  inPlaceFids: Set<number>;
  /** 部分覆盖的 coarse cell → 需升级 fine 并整 chunk 重建（§14.4 needRefine 落位） */
  rebuild: RebuildRecord[];
  stats: { inPlace: number; rebuildCells: number };
}

const byFid = (parts: PartInfo[]): Map<number, PartInfo> =>
  new Map(parts.map((p) => [p.fid, p]));

export function planDeform(
  q: RegionQuery,
  parts: PartInfo[] = classifyParts(q),
): DeformPlan {
  const by = byFid(parts);
  const updates: VertexUpdate[] = [];
  const inPlaceFids = new Set<number>();
  const rebuildMap = new Map<number, RebuildRecord>();
  for (const f of q.faces) {
    if (f.kind !== "top-cell") continue;
    const p = by.get(f.fid)?.top;
    if (!p) continue;
    const cells = p.verts;
    if (f.isFine) {
      // fine cell：按分类顶点（0.125 原生）就地下沉
      let hit = 0;
      for (const v of cells) {
        if (v.inside && v.depth > 0) {
          updates.push({ x: v.gx, z: v.gz, dy: -v.depth });
          hit++;
        }
      }
      if (hit > 0) inPlaceFids.add(f.fid);
      continue;
    }
    // coarse cell：内侧角一律原地沉（含部分覆盖格 —— 保证跨格/壁沿水密）；
    // 4 角全内 → 就地；否则必须升 fine 重建（1m 格无法平滑表达坑壁）
    let nIn = 0;
    for (const v of cells) {
      if (v.inside) { nIn++; if (v.depth > 0) updates.push({ x: v.gx, z: v.gz, dy: -v.depth }); }
    }
    if (nIn === 4) {
      inPlaceFids.add(f.fid);
    } else if (nIn > 0) {
      let rec = rebuildMap.get(q.chunks.get(chunkKeyOf(f.cx, f.cz))!.key);
      if (!rec) {
        rec = { key: chunkKeyOf(f.cx, f.cz), cx: f.cx, cz: f.cz, cells: [], reason: "coarse-partial-need-fine" };
        rebuildMap.set(rec.key, rec);
      }
      rec.cells.push({ lx: f.lx, lz: f.lz, bx: f.bx, bz: f.bz });
    }
  }
  return {
    updates,
    inPlaceFids,
    rebuild: [...rebuildMap.values()],
    stats: { inPlace: inPlaceFids.size, rebuildCells: [...rebuildMap.values()].reduce((a, r) => a + r.cells.length, 0) },
  };
}

// ------------------------------------------------------------
// 法线重算（顶面细格中心差分；壁法线恒水平不动）
// ------------------------------------------------------------

/**
 * 顶 cell 内（0.125 细格）顶点法线中心差分重算。
 * 高度源 = 变形后高度（topYView + offset），与写入值同一深度函数 → 法线与几何一致。
 */
export function recomputeTopNormals(
  ctx: ChunkCtx,
  f: Extract<FaceRef, { kind: "top-cell" }>,
  built: BuiltChunk,
  offset: (x: number, y: number, z: number) => number,
): void {
  if (!f.isFine) return; // coarse 顶法线恒 (0,1,0) 不变
  const G = 9; // 0.125m → 9×9
  const yt = new Float64Array(G * G);
  const wx0 = f.cx * N + f.lx, wz0 = f.cz * N + f.lz;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const wx = wx0 + gx / 8, wz = wz0 + gy / 8;
      const base = topYView(ctx.table, ctx.src, f.bx, f.bz, wx, wz);
      yt[gy * G + gx] = base + offset(wx, base, wz);
    }
  }
  const vB = f.render.vBase;
  const nor = built.topNormals;
  const step = 1 / 8;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const yC = yt[gy * G + gx];
      const yL = gx > 0 ? yt[gy * G + gx - 1] : yC;
      const yR = gx < G - 1 ? yt[gy * G + gx + 1] : yC;
      const yD = gy > 0 ? yt[(gy - 1) * G + gx] : yC;
      const yU = gy < G - 1 ? yt[(gy + 1) * G + gx] : yC;
      const nx2 = -(yR - yL);
      const nz2 = -(yU - yD);
      const ny = 2 * step;
      const il = 1 / Math.hypot(nx2, ny, nz2);
      const io = (vB + gy * G + gx) * 3;
      nor[io] = nx2 * il;
      nor[io + 1] = ny * il;
      nor[io + 2] = nz2 * il;
    }
  }
}

// ------------------------------------------------------------
// 执行：就地下沉（渲染顶/壁 + 物理合并三通写）→ 法线重算
// ------------------------------------------------------------

export interface DeformResult {
  written: number;
  normals: number;
  rebuilt: RebuildRecord[];
}

/**
 * 就地变形：把 plan.updates 按世界 (x,z) 落到所有涉及面（含跨 cell 重复顶点与
 * 壁顶沿）→ 顶/壁/物理 同值；再对就地 fine cell 重算法线。
 * 返回重建清单（coarse-partial cell）供装配方走整 chunk 重建路径（§13.7）。
 */
export function executeDeformInPlace(
  q: RegionQuery,
  plan: DeformPlan,
  terrain: Parameters<typeof applyFaceVertices>[2],
  opts: { depthAt: (x: number, y: number, z: number) => number },
): DeformResult {
  const written = applyFaceVertices(q, plan.updates, terrain);
  let normals = 0;
  const offset = (x: number, y: number, z: number) => -opts.depthAt(x, y, z);
  for (const fid of plan.inPlaceFids) {
    const f = q.faces[fid] as Extract<FaceRef, { kind: "top-cell" }>;
    const ctx = q.chunks.get(chunkKeyOf(f.cx, f.cz))!;
    const built = ctx.built ?? terrain.builtOf?.(f.cx, f.cz) ?? null;
    if (!built) continue;
    recomputeTopNormals(ctx, f, built, offset);
    normals++;
  }
  return { written, normals, rebuilt: plan.rebuild };
}

// ------------------------------------------------------------
// 验收辅助
// ------------------------------------------------------------

/** 某世界点在不同槽位（顶/壁/物理）的 Y 值集合 —— 可用 snap 读取变形前快照 */
export function yValuesAt(
  q: RegionQuery,
  x: number,
  z: number,
  terrain: Parameters<typeof applyFaceVertices>[2],
  snap?: { top?: Float32Array; wall?: Float32Array; phys?: Float32Array },
): number[] {
  const key = worldKey(x, z);
  const out: number[] = [];
  for (const f of q.faces) {
    const ctx = q.chunks.get(chunkKeyOf(f.cx, f.cz))!;
    const built = ctx.built ?? terrain.builtOf?.(f.cx, f.cz) ?? null;
    if (!built) continue;
    const slots = resolveFaceVertices(q, f);
    for (const s of slots) {
      if (worldKey(s.x, s.z) !== key) continue;
      const arr = snap
        ? (s.renderMesh === "top" ? snap.top ?? built.topVertices : snap.wall ?? built.wallVertices)
        : (s.renderMesh === "top" ? built.topVertices : built.wallVertices);
      const pvArr = snap?.phys ?? built.physVertices;
      for (const vi of s.renderVertex) out.push(arr[vi * 3 + 1]);
      for (const vi of s.physVertex) out.push(pvArr[vi * 3 + 1]);
    }
  }
  return out;
}