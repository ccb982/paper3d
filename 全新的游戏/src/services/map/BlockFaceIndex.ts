// ============================================================
// BlockFaceIndex —— per-chunk 地块面级粗信息索引
// ============================================================
// 精修层定型后构建，供后处理(bevel/crack/pit/侧壁)与运行时(地面交互)统一查询。
// 只存面级元信息（角色/高度/裁决/落差/材质），几何顶点不存。
//
// 构建时机：在 refineChunkSource / buildChunkFinal / buildChunkWallBuffers 之后。
// 消费方：PostProcess（只读）、运行时地面交互（读写 materialId）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import {
  type BlockSource,
  type ChunkWallBuffers,
  finalRuling,
  type EdgeRuling,
} from "./Refinements";
import { tileById } from "./Tiles";
import type { TileGenRole } from "./Tiles";

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

const BPS = BLOCKS_PER_SIDE; // 15（60m / 4m）
const N = CHUNK_SIZE; // 60
const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;
const BEVEL_EPS = 0.05; // 与 PostProcess.bevelOffset 同容差

// ------------------------------------------------------------
// 数据结构
// ------------------------------------------------------------

/** 单侧面信息 */
export interface FaceSide {
  ruling: EdgeRuling;
  /** 与邻居块的落差（高侧-低侧，≥0） */
  drop: number;
  /** 邻块在 cells 数组中的下标（跨界/缺块 = null） */
  neighborIdx: number | null;
  /** 材质 ID（默认 0；运行时替换为流体残差等） */
  materialId: number;
  /** 原墙 quad 精确索引（后处理侧壁剔除/重建用；null = 该边无墙） */
  wallRef: { quads: Uint16Array } | null;
  /** 是否弧边 bevel（后处理预判缓存） */
  isBevel: boolean;
}

/** 单个地块的面粗信息 */
export interface BlockFaceEntry {
  id: number;
  h: number;
  hBase: number;
  role: TileGenRole | "";
  top: { materialId: number };
  sides: [FaceSide, FaceSide, FaceSide, FaceSide];
  bottom: { materialId: number };
}

/** per-chunk 块面索引 */
export class BlockFaceIndex {
  readonly BPS = BPS;
  readonly cx: number;
  readonly cz: number;
  readonly cells: BlockFaceEntry[];
  /** 顶面米格级 4 角高（引用 buildChunkFinal 产物，60×60×4；与块逻辑高不同源） */
  readonly cornerH: Float32Array;

  constructor(cx: number, cz: number, cells: BlockFaceEntry[], cornerH: Float32Array) {
    this.cx = cx;
    this.cz = cz;
    this.cells = cells;
    this.cornerH = cornerH;
  }

  /** 按局部块坐标查询 */
  at(lbx: number, lbz: number): BlockFaceEntry | undefined {
    if (lbx < 0 || lbz < 0 || lbx >= BPS || lbz >= BPS) return undefined;
    return this.cells[lbz * BPS + lbx];
  }

  /** 按世界块坐标查询（跨界返回 undefined） */
  atWorld(wbx: number, wbz: number): BlockFaceEntry | undefined {
    return this.at(wbx - this.cx * BPS, wbz - this.cz * BPS);
  }

  /** 按世界块坐标 + 方向查邻居面 */
  sideAt(wbx: number, wbz: number, dir: 0 | 1 | 2 | 3): FaceSide | undefined {
    return this.atWorld(wbx, wbz)?.sides[dir];
  }

  /** 顶面米格级 4 角高（世界米格坐标，跨界返回 undefined） */
  cornerHAt(wx: number, wz: number): { h00: number; h10: number; h11: number; h01: number } | undefined {
    const lx = wx - this.cx * N;
    const lz = wz - this.cz * N;
    if (lx < 0 || lz < 0 || lx >= N || lz >= N) return undefined;
    const ci = (lz * N + lx) * 4;
    return {
      h00: this.cornerH[ci],
      h10: this.cornerH[ci + 1],
      h11: this.cornerH[ci + 2],
      h01: this.cornerH[ci + 3],
    };
  }
}

/** per-chunk 地块面索引 bundle：一次构建，顶面/侧壁/调试/贴地全复用。
 *  持有精修层产物引用（cornerH、wallBuffers），避免各后处理函数重复构建。 */
export interface BlockFaceIndexBundle {
  /** 块面索引（role/h/ruling/drop/isBevel/wallRef…） */
  index: BlockFaceIndex;
  /** 精修源（跨 chunk 邻居下钻用） */
  src: BlockSource;
  /** 顶面米格级 4 角高（引用 buildChunkFinal 产物） */
  cornerH: Float32Array;
  /** 原墙缓冲（侧壁重建后写回同一引用供物理/渲染同源） */
  wallBuffers: ChunkWallBuffers;
}

// ------------------------------------------------------------
// 构建函数
// ------------------------------------------------------------

/**
 * 构建 per-chunk 地块面索引。
 * @param src         精修后的 BlockSource（refineChunkSource 产出）
 * @param cx, cz      chunk 坐标
 * @param cornerH     buildChunkFinal 产出的顶面 4 角高（60×60×4）
 * @param wallBuffers buildChunkWallBuffers 产出的原墙 quad
 */
export function buildBlockFaceIndex(
  src: BlockSource,
  cx: number,
  cz: number,
  cornerH: Float32Array,
  wallBuffers: ChunkWallBuffers,
): BlockFaceIndex {
  const cells: BlockFaceEntry[] = new Array(BPS * BPS);

  // ---- ① 填充每个地块 ----
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      const info = src.blockAt(bx, bz);
      const id = info?.id ?? 0;
      const h = info?.h ?? 0;
      const hBase = info?.hBase ?? h;
      const role: TileGenRole | "" = info ? tileById(info.id).genRole : "";

      const sides = [] as FaceSide[];
      for (let dir = 0; dir < 4; dir++) {
        const d4 = DIR4[dir];
        const nbInfo = src.blockAt(bx + d4.dx, bz + d4.dz);
        const ruling = finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3);
        const nbH = nbInfo?.h ?? 0;
        const drop = Math.max(0, h - nbH);

        sides.push({
          ruling,
          drop,
          neighborIdx: null,
          materialId: 0,
          wallRef: null,
          isBevel: isBevelEdge(src, bx, bz, dir as 0 | 1 | 2 | 3, role, info, nbInfo),
        });
      }

      cells[lbz * BPS + lbx] = {
        id,
        h,
        hBase,
        role,
        top: { materialId: 0 },
        sides: sides as [FaceSide, FaceSide, FaceSide, FaceSide],
        bottom: { materialId: 0 },
      };
    }
  }

  // ---- ② neighborIdx ----
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const e = cells[lbz * BPS + lbx];
      for (let dir = 0; dir < 4; dir++) {
        const nlx = lbx + DIR4[dir].dx;
        const nlz = lbz + DIR4[dir].dz;
        if (nlx >= 0 && nlx < BPS && nlz >= 0 && nlz < BPS) {
          e.sides[dir].neighborIdx = nlz * BPS + nlx;
        }
      }
    }
  }

  // ---- ③ wallRef（原墙 quad → 归属块/方向） ----
  buildWallRef(cells, wallBuffers, cx, cz);

  return new BlockFaceIndex(cx, cz, cells, cornerH);
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 判定某边是否弧边 bevel（与 PostProcess.isBevelEdge 同语义） */
function isBevelEdge(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
  curRole: TileGenRole | "",
  curInfo: { id: number; h: number } | undefined,
  nbInfo: { id: number; h: number } | undefined,
): boolean {
  if (curRole !== "platform") return false;
  if (!nbInfo) return false;
  if (tileById(nbInfo.id).genRole !== "ground") return false;
  if (!curInfo) return false;
  if (nbInfo.h >= curInfo.h - BEVEL_EPS) return false;
  if (finalRuling(src, bx, bz, dir) !== "cliff") return false;
  const lr = finalRuling(src, bx, bz, (dir ^ 2) as 0 | 1 | 2 | 3);
  const rr = finalRuling(src, bx, bz, ((dir ^ 2) ^ 1) as 0 | 1 | 2 | 3);
  if (lr === "weld" || rr === "weld") return false;
  return true;
}

/**
 * 从原墙 quad 反推发射块 + 方向 → 登记 wallRef（精确复用精修层约定）。
 * 墙 quad（buildChunkWallBuffers 产出）：
 *   · uv 首对 (uvu,uvv) = 发射块局部 tile 索引：`uvu=(tblX+0.5)/15`，
 *     故 tblX = round(uvu*15-0.5)，发射块 world = tblX + cx*15。
 *   · 顶两顶点(顶A/顶B)在同一块边界线上 → 按发射块边界反推 dir
 *     （逻辑同 PostProcess.quadEdgeDir，已实测正确）。
 */
function buildWallRef(
  cells: BlockFaceEntry[],
  buffers: ChunkWallBuffers,
  cx: number,
  cz: number,
): void {
  const V = buffers.vertices;
  const UV = buffers.uvs;
  const HALF = N / 2;
  const quads = V.length / 12;
  const agg = new Map<number, number[]>();

  for (let q = 0; q < quads; q++) {
    const tbX = Math.round(UV[q * 8] * 15 - 0.5);
    const tbZ = Math.round(UV[q * 8 + 1] * 15 - 0.5);
    if (tbX < 0 || tbX >= BPS || tbZ < 0 || tbZ >= BPS) continue;
    const bxC = tbX + cx * BPS;
    const bzC = tbZ + cz * BPS;

    const tAx = V[q * 12] + cx * N + HALF;
    const tAz = V[q * 12 + 2] + cz * N + HALF;
    const tBx = V[q * 12 + 3] + cx * N + HALF;
    const tBz = V[q * 12 + 5] + cz * N + HALF;
    let dir: number;
    if (tAx === tBx && (tAx === (bxC + 1) * 4 || tAx === bxC * 4)) {
      dir = tAx === (bxC + 1) * 4 ? 0 : 1;
    } else {
      dir = tAz === (bzC + 1) * 4 ? 2 : 3;
    }

    const key = (tbZ * BPS + tbX) * 4 + dir;
    let list = agg.get(key);
    if (!list) { list = []; agg.set(key, list); }
    list.push(q);
  }

  for (const [key, quads] of agg) {
    const idx = (key >> 2) | 0;
    const dir = key & 3;
    const cell = cells[idx];
    if (!cell) continue;
    cell.sides[dir].wallRef = { quads: new Uint16Array(quads) };
  }
}

// ------------------------------------------------------------
// 块级查询外观（走索引；未建 chunk 回落 src —— 两种路径逐位一致）
// ------------------------------------------------------------

/**
 * 后处理/运行时统一的「世界块 → 面信息」查询。索引命中（含跨 chunk 邻居→其他
 * chunk 已建索引）走 index.cells；缺失（单点早于 chunk 网格 / 邻居未建）回落
 * src.blockAt + finalRuling 现算。两条路径数据同源、逐位一致。
 */
export class BlockFaceQuery {
  private readonly src: BlockSource;
  private readonly getBundle: (ccx: number, ccz: number) => BlockFaceIndexBundle | undefined;

  constructor(
    src: BlockSource,
    getBundle: (ccx: number, ccz: number) => BlockFaceIndexBundle | undefined,
  ) {
    this.src = src;
    this.getBundle = getBundle;
  }

  /** 任意世界块 → 索引项（未建 chunk 回落 src 合成的只读项） */
  entry(wx: number, wz: number): BlockFaceEntry | undefined {
    const ccx = Math.floor(wx / BPS);
    const ccz = Math.floor(wz / BPS);
    const b = this.getBundle(ccx, ccz);
    if (b) {
      const lbx = wx - ccx * BPS;
      const lbz = wz - ccz * BPS;
      return b.index.at(lbx, lbz);
    }
    const info = this.src.blockAt(wx, wz);
    if (!info) return undefined;
    return {
      id: info.id,
      h: info.h,
      hBase: info.hBase ?? info.h,
      role: tileById(info.id).genRole,
      top: { materialId: 0 },
      sides: [dummySide(), dummySide(), dummySide(), dummySide()],
      bottom: { materialId: 0 },
    };
  }

  /** 块角色（= PostProcess.roleAt：undefined 语义用 "" 表达） */
  role(wx: number, wz: number): string | undefined {
    const e = this.entry(wx, wz);
    return e ? e.role || undefined : undefined;
  }

  /** 块逻辑高 */
  h(wx: number, wz: number): number {
    return this.entry(wx, wz)?.h ?? 0;
  }

  /** 边裁决（= finalRuling） */
  ruling(wx: number, wz: number, dir: 0 | 1 | 2 | 3): EdgeRuling | undefined {
    const ccx = Math.floor(wx / BPS);
    const ccz = Math.floor(wz / BPS);
    const b = this.getBundle(ccx, ccz);
    if (b) {
      const lbx = wx - ccx * BPS;
      const lbz = wz - ccz * BPS;
      return b.index.at(lbx, lbz)?.sides[dir].ruling;
    }
    return finalRuling(this.src, wx, wz, dir);
  }

  /** 边落差（高侧-低侧，≥0） */
  drop(wx: number, wz: number, dir: 0 | 1 | 2 | 3): number {
    return this.entry(wx, wz)?.sides[dir].drop ?? 0;
  }

  /** 是否弧边 bevel（= PostProcess.isBevelEdge 同语义，索引预判） */
  isBevel(wx: number, wz: number, dir: 0 | 1 | 2 | 3): boolean {
    const ccx = Math.floor(wx / BPS);
    const ccz = Math.floor(wz / BPS);
    const b = this.getBundle(ccx, ccz);
    if (b) {
      const lbx = wx - ccx * BPS;
      const lbz = wz - ccz * BPS;
      return b.index.at(lbx, lbz)?.sides[dir].isBevel ?? false;
    }
    return false;
  }
}

/** 回落路径的 dummy 侧面（数据仅在有索引时可信） */
function dummySide(): FaceSide {
  return {
    ruling: "cliff" as EdgeRuling,
    drop: 0,
    neighborIdx: null,
    materialId: 0,
    wallRef: null,
    isBevel: false,
  };
}
