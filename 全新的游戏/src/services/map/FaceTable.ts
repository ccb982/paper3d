// ============================================================
// FaceTable —— 地形地块标注表（表驱动管线阶段 B，定稿）
//   架构权威文档：《地形表驱动管线重构设计.md》（定稿 2026-09-05）
// ============================================================
// 两遍创建：
//   Pass 1（单块可定，无需邻居查询）：role/h/hBase/材质 + 4 向 kind + 左右端邻边 kind
//   Pass 2（全区 Pass1 后）：topEdgeY / calcDepth / depth(=calc+保底) /
//          oppKind / arcNeighbor / topWeldDirs
// 分层归位：bevel = 精修层形态；pit/crack = 后处理精细层（不入表）。
// kind：hard(默认) / weld(坡，影响顶部插值) / bevel(弧边，左右邻边非坡)。
// 表只标注属性；精确几何交创建函数（见《地形表驱动管线重构设计.md》）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import {
  type BlockSource,
  surfaceHeightCore,
  finalRuling,
  type EdgeRuling,
} from "./Refinements";
import { tileById, type TileGenRole } from "./Tiles";

const BPS = BLOCKS_PER_SIDE; // 15
const N = CHUNK_SIZE; // 60
export const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

/** dir 同轴反向（共享边对侧）：0↔1、2↔3 */
export const oppositeDir = (dir: number) => dir ^ 1;

/**
 * 本块 dir 边的【两端点邻接的垂直边方向】：
 * 端点约定与 edgeEndpoints 一致——p0 = 沿边小端（x 向边 = z 小端/北，z 向边 = x 小端/西），
 * p1 = 沿边大端。返回 [p0 端邻接边方向, p1 端邻接边方向]。
 */
export const edgeEndAdjacentDirs = (dir: number): [number, number] =>
  dir < 2 ? [3, 2] : [1, 0];

/** 墙底相对墙顶的保底深度（有墙至少这么深，防 0 高墙/破面） */
export const WALL_MIN_DEPTH = 0.6;
/** 墙存在判据容差（与精修层 buildChunkWallBuffers 的 WALL_EPS 同值） */
export const WALL_EPS = 0.05;
/** 弧边判据容差 */
export const BEVEL_EPS = 0.05;

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

export type SideKind = "hard" | "weld" | "bevel"; // hard 默认

export interface FaceSide {
  kind: SideKind;
  /** ★ 对侧（共享边另一边地块）属性——成对标注：硬边,硬边 / 硬边,弧面 … */
  oppKind: SideKind;
  /** ★ p0 端（沿边小端）邻接的垂直侧壁属性（= edgeEndAdjacentDirs(dir)[0] 向边） */
  leftKind: SideKind;
  /** ★ p1 端（沿边大端）邻接的垂直侧壁属性（= edgeEndAdjacentDirs(dir)[1] 向边） */
  rightKind: SideKind;
  ruling: EdgeRuling;      // 裁决溯源
  // ---- Pass 2（邻居敏感） ----
  /** 该边顶面视觉高主值（本块视角，沿边最高） */
  topEdgeY: number;
  /** 计算侧壁量（视觉/逻辑落差所需，≥0；平地 = 0） */
  calcDepth: number;
  /** 最终侧壁深度 = calcDepth + 保底 WALL_MIN_DEPTH（每个侧壁恒有保底） */
  depth: number;
  /** 是否 bevel 弧边的邻边（弧带伸入该边 → 需弧顶墙） */
  arcNeighbor: boolean;
  /** 侧壁材质（默认 = topTileId，可单独改） */
  sideTileId: number;
}

export interface FaceCell {
  id: number;
  role: TileGenRole | "";
  h: number;
  hBase: number;
  topTileId: number;
  top: { materialId: number };
  /** 顶面受 weld 插值影响的方向（邻居更高的 weld 边，坡进入顶部） */
  topWeldDirs: number[];
  sides: [FaceSide, FaceSide, FaceSide, FaceSide];
  idx: number;
}

export interface FaceTable {
  cx: number;
  cz: number;
  cells: FaceCell[];
}

// ------------------------------------------------------------
// 构建
// ------------------------------------------------------------

/** 视觉面顶：某格点 (gx,gz) 在视角块 (vbx,vbz) 的高（f64，精修层同源） */
export const viewTopAt = (
  src: BlockSource,
  vbx: number,
  vbz: number,
  gx: number,
  gz: number,
): number => surfaceHeightCore(src, vbx, vbz, gx, gz);

/** 块边 dir 的边界线两端格点（世界；沿边从 0..4） */
export function edgeEndpoints(
  bx: number,
  bz: number,
  dir: number,
): [[number, number], [number, number]] {
  const x0 = bx * 4, z0 = bz * 4;
  if (dir === 0) return [[x0 + 4, z0], [x0 + 4, z0 + 4]];
  if (dir === 1) return [[x0, z0], [x0, z0 + 4]];
  if (dir === 2) return [[x0, z0 + 4], [x0 + 4, z0 + 4]];
  return [[x0, z0], [x0 + 4, z0]];
}

/**
 * ★ Pass 1：单块可定——role/h/hBase/材质 + 4 向 kind。
 * 全区所有 chunk 跑完 Pass1 后，才进入 Pass2。
 */
/** 单块某向 kind 判定（默认 hard；weld→bevel→hard 链）——Pass1 与跨界对侧共用 */
export function kindOfSide(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: number,
  forceHard?: (bxx: number, bzz: number, d: number) => boolean,
): SideKind {
  if (forceHard?.(bx, bz, dir) ?? false) return "hard";
  const info = src.blockAt(bx, bz);
  if (!info) return "hard";
  const role = tileById(info.id).genRole;
  const h = info.h;
  const ruling = finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3);
  if (ruling === "weld") return "weld";
  const nb = src.blockAt(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
  if (!nb) return "hard";
  if (
    role === "platform" &&
    tileById(nb.id).genRole === "ground" &&
    nb.h < h - BEVEL_EPS &&
    ruling === "cliff" &&
    finalRuling(src, bx, bz, edgeEndAdjacentDirs(dir)[0] as 0 | 1 | 2 | 3) !== "weld" &&
    finalRuling(src, bx, bz, edgeEndAdjacentDirs(dir)[1] as 0 | 1 | 2 | 3) !== "weld"
  ) {
    return "bevel";
  }
  return "hard";
}

export function pass1Build(
  src: BlockSource,
  cx: number,
  cz: number,
  /** 显式 hard 覆写（edgePolicy/手动），返回 true 强制硬边 */
  forceHard?: (bx: number, bz: number, dir: number) => boolean,
): FaceTable {
  const cells: FaceCell[] = [];
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      const info = src.blockAt(bx, bz);
      const id = info?.id ?? 0;
      const h = info?.h ?? 0;
      const hBase = info?.hBase ?? h;
      const role: TileGenRole | "" = info ? tileById(info.id).genRole : "";
      const topTileId = id >= 0 ? tileById(id).id : 0;

      const sides = [] as FaceSide[];
      for (let dir = 0; dir < 4; dir++) {
        const kind = kindOfSide(src, bx, bz, dir, forceHard);
        sides.push({
          kind,
          ruling: finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3),
          topEdgeY: 0, depth: 0, calcDepth: 0, arcNeighbor: false,
          oppKind: "hard", leftKind: "hard", rightKind: "hard",
          sideTileId: topTileId,
        });
      }

      // ★ 两端点邻接的垂直侧壁（同块，全部 kind 已知后回填）
      for (let dir = 0; dir < 4; dir++) {
        const s = sides[dir as 0 | 1 | 2 | 3];
        const [da, db] = edgeEndAdjacentDirs(dir);
        s.leftKind = sides[da as 0 | 1 | 2 | 3].kind;
        s.rightKind = sides[db as 0 | 1 | 2 | 3].kind;
      }

      cells.push({
        id, role, h, hBase, topTileId,
        top: { materialId: 0 },
        topWeldDirs: [],
        sides: sides as [FaceSide, FaceSide, FaceSide, FaceSide],
        idx: lbz * BPS + lbx,
      });
    }
  }
  return { cx, cz, cells };
}

/**
 * ★ Pass 2：邻居敏感细节——顶沿/深度/hasWall/弧邻接/顶部插值方向。
 * 依赖邻居边高度查询（邻块共享边视角顶），全区 Pass1 完成后调用。
 * 壁高沿 4m 边逐 1m 段变化（坡/交叉），先逐段判墙再合并为整边主值：
 *   hasWall = 任一段有墙；topEdgeY = 有墙段中本侧顶最大；depth = 对应最深段。
 */
export function pass2Build(table: FaceTable, src: BlockSource): void {
  const { cx, cz } = table;
  const cellAt = (wx: number, wz: number): FaceCell | null => {
    const ccx = Math.floor(wx / BPS);
    const ccz = Math.floor(wz / BPS);
    if (ccx !== cx || ccz !== cz) return null;
    const lbx = wx - ccx * BPS;
    const lbz = wz - ccz * BPS;
    if (lbx < 0 || lbz < 0 || lbx >= BPS || lbz >= BPS) return null;
    return table.cells[lbz * BPS + lbx];
  };

  /** 块边 dir 的第 s 段（1m）两端格点 */
  const segEnds = (bx: number, bz: number, dir: number, s: number): [[number, number], [number, number]] => {
    const x0 = bx * 4, z0 = bz * 4;
    if (dir === 0) return [[x0 + 4, z0 + s], [x0 + 4, z0 + s + 1]];
    if (dir === 1) return [[x0, z0 + s], [x0, z0 + s + 1]];
    if (dir === 2) return [[x0 + s, z0 + 4], [x0 + s + 1, z0 + 4]];
    return [[x0 + s, z0], [x0 + s + 1, z0]];
  };

  /** 邻块在共享边（邻块 dir^1 边）的本视角视觉顶，逐段 max */
  const neighborEdgeTop = (bx: number, bz: number, dir: number): number => {
    const nbx = bx + DIR4[dir].dx;
    const nbz = bz + DIR4[dir].dz;
    let m = -1e9;
    for (let s = 0; s < 4; s++) {
      const [[ax, az], [bx2, bz2]] = segEnds(nbx, nbz, oppositeDir(dir), s);
      m = Math.max(m, viewTopAt(src, nbx, nbz, ax, az), viewTopAt(src, nbx, nbz, bx2, bz2));
    }
    return m;
  };

  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      const topWeld: number[] = [];

      for (let dir = 0; dir < 4; dir++) {
        const side = cell.sides[dir as 0 | 1 | 2 | 3];
        const nbx = bx + DIR4[dir].dx;
        const nbz = bz + DIR4[dir].dz;
        const nbCell = cellAt(nbx, nbz);
        const nbH = nbCell ? nbCell.h : (src.blockAt(nbx, nbz)?.h ?? 0);
        const nbBase = nbCell ? nbCell.hBase : (src.blockAt(nbx, nbz)?.hBase ?? nbH);

        // 逐 1m 段算侧壁（每边恒有侧壁：计算量 + 保底）
        let calcMax = 0; // 计算量 = 各段所需落差深度的最大
        let topMax = -1e9;
        for (let s = 0; s < 4; s++) {
          const [[ax, az], [bx2, bz2]] = segEnds(bx, bz, dir, s);
          const sideA = Math.max(viewTopAt(src, bx, bz, ax, az), viewTopAt(src, bx, bz, bx2, bz2));
          const sideB = Math.max(
            viewTopAt(src, nbx, nbz, ax, az),
            viewTopAt(src, nbx, nbz, bx2, bz2),
          );
          topMax = Math.max(topMax, sideA);
          const hasS = cell.h > nbH || sideA > sideB + WALL_EPS;
          if (hasS) {
            const lowBase = Math.min(sideB, cell.hBase, nbBase);
            calcMax = Math.max(calcMax, Math.max(0, sideA - (lowBase - WALL_EPS)));
          }
        }
        side.topEdgeY = topMax > -1e8 ? topMax : side.topEdgeY;
        // ★ 恒有侧壁：depth = 计算量 + 保底（平地 = 0 + 保底）
        side.calcDepth = calcMax;
        side.depth = calcMax + WALL_MIN_DEPTH;

        // 对侧属性（两次标注成对）：同表直取；跨界按 src 判 kind
        if (nbCell) {
          side.oppKind = nbCell.sides[oppositeDir(dir) as 0 | 1 | 2 | 3].kind;
        } else {
          side.oppKind = kindOfSide(src, nbx, nbz, oppositeDir(dir));
        }

        // 弧邻接：本边两端点邻接的垂直边任一为 bevel（弧带伸入该边端点）
        side.arcNeighbor = side.leftKind === "bevel" || side.rightKind === "bevel";

        // 顶部插值方向：本块低侧 weld（邻居更高 → 坡爬入本块顶）
        if (side.kind === "weld" && nbH > cell.h) topWeld.push(dir);
      }
      cell.topWeldDirs = topWeld;
    }
  }
}

/** 便捷：一次调用 Pass1+Pass2 */
export function buildFaceTable(
  src: BlockSource,
  cx: number,
  cz: number,
  forceHard?: (bx: number, bz: number, dir: number) => boolean,
): FaceTable {
  const t = pass1Build(src, cx, cz, forceHard);
  pass2Build(t, src);
  return t;
}

// ------------------------------------------------------------
// 查询（跨 chunk：调用方给邻表 provider）
// ------------------------------------------------------------

export type TableProvider = (ccx: number, ccz: number) => FaceTable | null;

export class FaceQuery {
  private readonly getTable: TableProvider;
  private readonly src: BlockSource;
  constructor(getTable: TableProvider, src: BlockSource) {
    this.getTable = getTable;
    this.src = src;
  }

  tableOf(wx: number, wz: number): FaceTable | null {
    return this.getTable(Math.floor(wx / BPS), Math.floor(wz / BPS));
  }

  cell(wx: number, wz: number): FaceCell | null {
    const t = this.tableOf(wx, wz);
    if (!t) return null;
    const lbx = wx - t.cx * BPS;
    const lbz = wz - t.cz * BPS;
    if (lbx < 0 || lbz < 0 || lbx >= BPS || lbz >= BPS) return null;
    return t.cells[lbz * BPS + lbx];
  }

  side(wx: number, wz: number, dir: number): FaceSide | null {
    return this.cell(wx, wz)?.sides[dir as 0 | 1 | 2 | 3] ?? null;
  }

  /** 邻块（永远移动一格；跨界走邻表，无表回落 null） */
  neighbor(wx: number, wz: number, dir: number): FaceCell | null {
    return this.cell(wx + DIR4[dir].dx, wz + DIR4[dir].dz);
  }

  /** ★ 邻居共享边顶高（邻块视角；邻表就绪用之，否则 src 同公式现算） */
  neighborEdgeTop(wx: number, wz: number, dir: number): number {
    const nbx = wx + DIR4[dir].dx;
    const nbz = wz + DIR4[dir].dz;
    const nb = this.cell(nbx, nbz);
    if (nb) {
      const od = oppositeDir(dir) as 0 | 1 | 2 | 3;
      return nb.sides[od].topEdgeY;
    }
    const [[ax, az], [bx2, bz2]] = edgeEndpoints(nbx, nbz, oppositeDir(dir));
    return Math.max(viewTopAt(this.src, nbx, nbz, ax, az), viewTopAt(this.src, nbx, nbz, bx2, bz2));
  }

  /** 邻块朝本块的边（dir^1，只翻一次） */
  oppositeSide(wx: number, wz: number, dir: number): FaceSide | null {
    return this.neighbor(wx, wz, dir)?.sides[oppositeDir(dir) as 0 | 1 | 2 | 3] ?? null;
  }
}

// ------------------------------------------------------------
// 检验（Pass2 内/后）
// ------------------------------------------------------------

export interface TableCheckReport {
  errors: string[];
  stats: {
    kind: Record<string, number>;
    /** 有计算量（非纯保底）的侧壁边数 */
    calcSides: number;
    /** 两侧组合统计（成对标注），如 "hard,hard" */
    pairStats: Record<string, number>;
    bevelCount: number;
  };
}

/** 表合理性检验：① 弧边左右邻边非坡 ② 材质默认一致 ③ 恒保底 + 两侧组合统计 */
export function checkTable(table: FaceTable): TableCheckReport {
  const errors: string[] = [];
  const stats = {
    kind: { hard: 0, weld: 0, bevel: 0 },
    calcSides: 0,
    pairStats: {} as Record<string, number>,
    bevelCount: 0,
  };
  const push = (m: string) => { if (errors.length < 24) errors.push(m); };
  for (const cell of table.cells) {
    for (let dir = 0; dir < 4; dir++) {
      const side = cell.sides[dir as 0 | 1 | 2 | 3];
      stats.kind[side.kind]++;
      // 恒有侧壁：depth == calc + WALL_MIN_DEPTH（平地 calc=0 → 0+保底）
      if (Math.abs(side.depth - (side.calcDepth + WALL_MIN_DEPTH)) > 1e-6) {
        push(`深度非 calc+保底 块idx=${cell.idx} d${dir} calc=${side.calcDepth.toFixed(2)} depth=${side.depth.toFixed(2)}`);
      }
      if (side.calcDepth > 0) stats.calcSides++;
      // 两侧组合（本侧,对侧）成对统计
      const pair = `${side.kind},${side.oppKind}`;
      stats.pairStats[pair] = (stats.pairStats[pair] ?? 0) + 1;
      if (side.kind === "bevel") {
        stats.bevelCount++;
        const [da, db] = edgeEndAdjacentDirs(dir);
        for (const d of [da, db]) {
          if (cell.sides[d as 0 | 1 | 2 | 3].kind === "weld") {
            push(`弧边左右邻边为坡 (${table.cx * 15 + Math.floor(cell.idx % 15)},${table.cz * 15 + Math.floor(cell.idx / 15)}) d${dir} 邻d${d}`);
          }
        }
        // 左右端点邻边标注一致性复核
        if (cell.sides[da as 0 | 1 | 2 | 3].kind !== side.leftKind ||
            cell.sides[db as 0 | 1 | 2 | 3].kind !== side.rightKind) {
          push(`左右端标注不一致 块idx=${cell.idx} d${dir}`);
        }
      }
      if (side.sideTileId !== cell.topTileId) {
        push(`材质不一致 块idx=${cell.idx} d${dir}`);
      }
    }
  }
  return { errors, stats };
}

// ============================================================
// ★ 补丁分区（表驱动；2026-09-08 —— 破坏重建只重生成受影响区块）
// ============================================================
// 语义（与用户原设计对齐：按表只改相关顶部/侧壁，不整 chunk 全量重生成）：
//   给定补丁脚印（levels 层数表，1m cell 精度）+ 本 chunk 表 → 推导出「必须
//   重新发射几何的最小区块」，其余区块几何保持不变、可整体复用。
// 分区结果：
//   · topCells   ：coarse 顶面需重发的 1m cell（补丁 cell ∪ 外扩 1 圈，
//                  保 smoothstep 坡降与 coarse/fine 交界无 T 结）
//   · blockSides ：需重发的侧壁段（4m 块某向边），判定见表注释
// 装配方拿到这个分区后可只对表内区块发几何，其余沿用已建网格。
// ============================================================

export interface PatchPartition {
  /** 需重发的 coarse 顶面 1m cell（chunk 局部 lx,lz；补丁区 ∪ 外扩 1 圈） */
  topCells: { lx: number; lz: number }[];
  /** 需重发的侧壁段（4m 块局部 lbx,lbz + 方向 dir；指示该块该向 4m 边整条重发） */
  blockSides: { lbx: number; lbz: number; dir: number }[];
}

/** coarse cell(lx,lz) 是否在补丁脚印内（levels>0；含越界=false） */
function patchCellAt(levels: Uint8Array, chunkSize: number, lx: number, lz: number): boolean {
  return lx >= 0 && lz >= 0 && lx < chunkSize && lz < chunkSize && levels[lz * chunkSize + lx] > 0;
}

/**
 * 由补丁脚印 + chunk 尺寸推导最小重发分区。
 * chunkSize = levels 边长（= CHUNK_SIZE=60，coarse cell 1m）。
 * 判据：
 *   1) topCells = 补丁 cell ∪ 8 邻域（外扩 1 圈）——
 *      保证 smoothstep 坡面（PATCH_SLOPE_CELLS=1m）顶点全部涵盖 + coarse/fine
 *      交界处补丁外圈并入，与 buildTopGeometry 的 fine 掩码语义一致。
 *   2) blockSides = 该 4m 边两侧共 8 个 coarse cell 中「任一侧存在补丁」的边：
 *      · 坑缘壁（一侧补丁一侧未）需重发（顶沿随深度下移、换补丁色）；
 *      · 坑内隔断壁（两侧都补丁但等高 flush）会被剔除 → 需重发产生几何差；
 *      · 完全在坑外的边两侧都无补丁 → 几何不变，重发。
 *   越界（跨 chunk 边）视作未补丁——坑沿跨 chunk 的壁由邻 chunk 自己分区处理。
 */
export function partitionPatch(levels: Uint8Array, chunkSize: number): PatchPartition {
  const topCells: { lx: number; lz: number }[] = [];
  const blockSides: { lbx: number; lbz: number; dir: number }[] = [];
  const topSet = new Set<number>();
  const sideSet = new Set<number>();

  // ① 顶面补丁足迹（含外扩 1 圈）：由补丁 cell 展开
  for (let lz = 0; lz < chunkSize; lz++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      if (!patchCellAt(levels, chunkSize, lx, lz)) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = lx + dx, nz = lz + dz;
          if (nx < 0 || nz < 0 || nx >= chunkSize || nz >= chunkSize) continue;
          if (topSet.has(nz * chunkSize + nx)) continue;
          topSet.add(nz * chunkSize + nx);
          topCells.push({ lx: nx, lz: nz });
        }
      }
    }
  }

  // ② 侧壁：凡「该 4m 边旁 8 个 coarse cell（本侧 4 + 对侧 4）任一带补丁」的块边
  //    即需重发——坑缘壁/坑内 flush 壁都由此产生几何差。
  //    逐块边扫描，比"仅边界带"更稳（覆盖完全在坑内的块其内部隔断壁）。
  const includeSide = (bxx: number, bzz: number, d: number) => {
    const k = bxx * 4 + bzz * 10000 + d;
    if (sideSet.has(k)) return;
    sideSet.add(k);
    blockSides.push({ lbx: bxx, lbz: bzz, dir: d });
  };
  const bps = chunkSize >> 2; // 每侧块数（15）
  // 侧壁分区判据闭包：给定块局部 (bx4,bz4) 与方向，检查该 4m 边两侧 cell
  const edgeHasPatch = (bx4: number, bz4: number, dir: number): boolean => {
    for (let j = 0; j < 4; j++) {
      let ox: number, oz: number, nx: number, nz: number;
      if (dir === 0) { ox = bx4 * 4 + 3; oz = bz4 * 4 + j; nx = ox + 1; nz = oz; }
      else if (dir === 1) { ox = bx4 * 4; oz = bz4 * 4 + j; nx = ox - 1; nz = oz; }
      else if (dir === 2) { ox = bx4 * 4 + j; oz = bz4 * 4 + 3; nx = ox; nz = oz + 1; }
      else { ox = bx4 * 4 + j; oz = bz4 * 4; nx = ox; nz = oz - 1; }
      if (patchCellAt(levels, chunkSize, ox, oz) || patchCellAt(levels, chunkSize, nx, nz)) return true;
    }
    return false;
  };
  for (let bz4 = 0; bz4 < bps; bz4++) {
    for (let bx4 = 0; bx4 < bps; bx4++) {
      for (let dir = 0; dir < 4; dir++) {
        if (edgeHasPatch(bx4, bz4, dir)) includeSide(bx4, bz4, dir);
      }
    }
  }
  return { topCells, blockSides };
}
