// ============================================================
// FaceTable —— 地形地块标注表（表驱动管线阶段 B，v3）
// ============================================================
// 两遍创建：
//   Pass 1（单块可定，无需邻居查询）：role/h/hBase/材质 + 4 向 kind
//   Pass 2（全区 Pass1 后，用邻居边查询）：topEdgeY/depth/hasWall/
//          arcNeighbor/topWeldDirs
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
/** dir 的左右邻边方向（XOR2 = 90° 旋转 + 对侧取垂直两向） */
export const leftRightDirs = (dir: number): [number, number] => [dir ^ 2, (dir ^ 2) ^ 1];

/** 墙底相对墙顶的保底深度（有墙至少这么深，防 0 高墙/破面） */
export const WALL_MIN_DEPTH = 0.3;
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
  /** ★ 对侧（共享边另一边地块）的属性——两次标注成对：硬边,硬边 / 硬边,弧面 … */
  oppKind: SideKind;
  /** ★ 左端相接的垂直侧壁属性（本块 dir^2 向边；沿本边行进的左端） */
  leftKind: SideKind;
  /** ★ 右端相接的垂直侧壁属性（本块 (dir^2)^1 向边） */
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
    finalRuling(src, bx, bz, leftRightDirs(dir)[0] as 0 | 1 | 2 | 3) !== "weld" &&
    finalRuling(src, bx, bz, leftRightDirs(dir)[1] as 0 | 1 | 2 | 3) !== "weld"
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

      // ★ 左右端相接的垂直侧壁（同块垂直两向，全部 kind 已知后回填）
      for (let dir = 0; dir < 4; dir++) {
        const s = sides[dir as 0 | 1 | 2 | 3];
        s.leftKind = sides[leftRightDirs(dir)[0] as 0 | 1 | 2 | 3].kind;
        s.rightKind = sides[leftRightDirs(dir)[1] as 0 | 1 | 2 | 3].kind;
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

        // 弧邻接：本边左右邻边任一为 bevel（弧带伸入该边端点）
        const lr = leftRightDirs(dir);
        side.arcNeighbor =
          cell.sides[lr[0] as 0 | 1 | 2 | 3].kind === "bevel" ||
          cell.sides[lr[1] as 0 | 1 | 2 | 3].kind === "bevel";

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
      // 两侧组合（本侧,对侧）——两向都标（对侧视图查 oppKind）
      const pair = `${side.kind},${side.oppKind}`;
      stats.pairStats[pair] = (stats.pairStats[pair] ?? 0) + 1;
      const rpair = `${side.oppKind},${side.kind}`;
      if (!stats.pairStats[rpair]) stats.pairStats[rpair] = stats.pairStats[rpair] ?? 0;
      if (side.kind === "bevel") {
        stats.bevelCount++;
        const lr = leftRightDirs(dir);
        for (const d of lr) {
          if (cell.sides[d as 0 | 1 | 2 | 3].kind === "weld") {
            push(`弧边左右邻边为坡 (${table.cx * 15 + Math.floor(cell.idx % 15)},${table.cz * 15 + Math.floor(cell.idx / 15)}) d${dir} 邻d${d}`);
          }
        }
      }
      if (side.sideTileId !== cell.topTileId) {
        push(`材质不一致 块idx=${cell.idx} d${dir}`);
      }
    }
  }
  return { errors, stats };
}
