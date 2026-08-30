// ============================================================
// Refinements —— 地形精修层（L6 定型段核心执行器，唯一地形几何真源）
// ============================================================
// 架构详见《精修层与定型快照架构.md》、《地形边缘裁决与视觉面架构.md》
// 《架构设计.md》§8.0「三阶段地形产出」+「edgeFinal 唯一执行器」。
//
// ★ 意志：本文件是【地形本体的唯一真源】——
//   1) 边裁决：块边界「硬过渡(cliff) vs 插值(weld)」判定执行权由本层全权执掌：
//      - 【插值 = 显式 opt-in】（2026-08-31 定版）：默认引擎恒 hard（cliff），
//        凡未显式 smooth 的边一律立墙；weld 只发生在 BlockSource.edgeFinal
//        显式钉死或 TileDef.edgePolicy:'smooth' 启用的边上。
//      - 消费者一律走 finalRuling/edgeOf，只读本层输出（第五铁律）。
//   2) 视觉面几何：角点高度 cornerCell、顶点缝合 vertexHeight、斜坡剖面
//      rampProfile、贴地采样 sampleSurface、面板底 baseHeightOf 的语义公式
//      全部并入本文件（2026-08-31：撕裂面+传导场两级合成模型，见
//      《精修层过渡模型重构设计.md》§3；2026-08-30 SurfaceRules 物理并入）。
//
// ★ 确定性/可重放：纯函数、逐位可复现（同种子同源同输出）。
//   零 three 依赖，主线程与 Worker 同一份代码。
// ============================================================

import { tileById } from "./Tiles";
import {
  hash2,
  CHUNK_SIZE,
  BLOCK_SIZE,
  BLOCKS_PER_SIDE,
} from "./ChunkGenerator";
import { hsl2rgb } from "./TerrainPalette";
import {
  applyGroupTintHsl,
  SEMANTIC_THEME_MIX,
  type GroupPalette,
} from "./TileGroups";
import { BAKE_SUN } from "./RefinementConstants";

// ============================================================
// 裁决结论与常量（精修层内部默认引擎；与移动层 stepHeight 同源）
// ============================================================

export type EdgeRuling = "weld" | "cliff";

/**
 * ★ 通高硬边界阈值（|Δh| ≤ 带宽 → 小台阶语义）。推导见《地形边缘裁决与
 * 视觉面架构.md》§2.2：各类型对 |Δh| 分布中 (0.30, 0.38) 是空隙带。
 * ★ 与移动层 stepHeight 是同一常量（CharacterBase 大落差阻挡）。
 * ★ 2026-08-31 起：edgeRuling 默认引擎已恒 cliff（插值=显式 opt-in），
 *   本常量不参与裁决（默认世界全硬边界）；仅供移动层阻挡阈值与未来
 *   smooth opt-in 高度差判断储备。
 */
export const EDGE_CLIFF_BAND = 0.35;

/**
 * ★ weld 斜坡带宽（整 cell 列数，默认 2m）。可配层级（由粗到细）：
 *   WELD_RAMP_CELLS（本常量） → TileDef.physics.edgePolicy（语义不变） →
 *   planRefinements 逐边 EdgeOverride.rampWidth（优先）。
 * 约束：w 必须能整除块宽（4 / w ∈ 整数）→ 只允许 1/2/4。
 * 坡面在此按 w 排 cell 线性摊平（有意简化，见《重构设计》§2.2/§3.3）。
 */
export const WELD_RAMP_CELLS = 2;

// ============================================================
// 块数据源（唯一抽象面：世界块坐标 → 块信息）
// ============================================================

/** 块信息：tileId（裁决用）+ 逻辑高度（L4 逐块恒定平面） */
export interface BlockInfo {
  id: number;
  h: number;
  /**
   * ★ 立面板底高度（可选，默认 = h）——精修层 hBase 双语义地基：
   *   h      = 顶面视觉面高度（渲染/碰撞/贴地/烘焙读它）
   *   hBase  = 该块“实体到哪儿为止”的面板底高（补墙/悬空/侵蚀安全读它）
   * weld 拉顶只改 h、hBase 不动 → 侧壁从 hBase 竖直升到 h，悬空消失；
   * 侵蚀切块溅 h 与 hBase 同厚度降 → 不悬空。undefined = 视为 h。
   */
  hBase?: number;
}

/** 面板底高的统一取值（未显式指定 = h，保证空精修 ≡ 旧世界） */
export function baseHeightOf(b: BlockInfo): number {
  return b.hBase ?? b.h;
}

/**
 * 世界块坐标 → 块信息；undefined = 数据不存在（按 0 号平地/0 高兜底）。
 */
export interface BlockSource {
  blockAt(bx: number, bz: number): BlockInfo | undefined;
  /**
   * ★ 精修层执行口（可选）：显式裁决覆写。返回 undefined = 用默认引擎
   *   edgeRuling。默认 4 个构造点不提供 → 空精修 ≡ 旧世界逐位不变。
   *   dir：0=+x 1=−x 2=+z 3=−z（与 edgeOf 一致）。
   */
  edgeFinal?(
    bx: number,
    bz: number,
    dir: 0 | 1 | 2 | 3,
  ): EdgeRuling | undefined;
  /**
   * ★ 逐边坡宽覆写（可选）：对给块/方向的边返回显式 rampWidth（米），
   *   undefined = 用全局 WELD_RAMP_CELLS。语义见 WELD_RAMP_CELLS 注释。
   */
  edgeRampWidth?(
    bx: number,
    bz: number,
    dir: 0 | 1 | 2 | 3,
  ): number | undefined;
}

/** 缺块兜底（0 号平地 / 0 高——与旧 heightAt 未加载回退逐位一致） */
export const MISSING_BLOCK: BlockInfo = { id: 0, h: 0 };

/**
 * ★ BlockSource 建源的最小 chunk 数据面（《重构设计》§6「三份收敛」）：
 * 统一输入面 = ChunkData（heights + blockTypes，groupKey 当前不参与几何）。
 * RasterMap.surfaceBlocks / ChunkSurface 邻域表 / 烘焙快照源三处自算路径
 * 删除，全部经由 makeChunkSource 闭包建源——块→chunk→局部索引换算只存一处。
 */
export interface ChunkDataLite {
  /** 每米高度（60×60；每块 4×4 米内绝对平整，取块角格值 = 块高） */
  heights: Float32Array;
  /** 块类型（15×15；存最终 TileDef.id） */
  blockTypes: Uint8Array;
  /** 本 chunk 生效的风格组（调色板查询用；几何不读，仅为语义完整性携带） */
  groupKey?: string;
}

/**
 * ★ 三份 BlockSource 的统一建源工厂（2026-08-31 收敛）：
 * 输入 = 按 chunk 坐标读 ChunkDataLite 的闭包。
 * 内部做唯一的「世界块坐标 → chunk 原点 → 局部块索引 → 局部米格索引」换算。
 * 消费者不得另建源、不得复刻此换算。
 * 返回 undefined 的 chunk = 数据不存在（MISSING_BLOCK 兜底，同旧回退）。
 * ★ 意图分置（2026-08-31 定）：
 *   本工厂产出【原始 BlockSource】（不做 refine）——它是无界共享源（RasterMap
 *   surfaceBlocks / 快照懒查），不绑定任何单一 chunk。per-chunk 意图由
 *   refineChunkSource 在【构建出口】应用（ChunkSurface / ChunkWalls 知道
 *   (cx,cz)），意图不被共享源携带。当前 planRefinements 恒空 → 无感知差异。
 */
export function makeChunkSource(
  readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
): BlockSource {
  return {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      const ccx = Math.floor(bx / BLOCKS_PER_SIDE);
      const ccz = Math.floor(bz / BLOCKS_PER_SIDE);
      const d = readChunk(ccx, ccz);
      if (!d) return undefined;
      const ibx = bx - ccx * BLOCKS_PER_SIDE;
      const ibz = bz - ccz * BLOCKS_PER_SIDE;
      const gi = ibz * BLOCK_SIZE * CHUNK_SIZE + ibx * BLOCK_SIZE;
      return {
        id: d.blockTypes[ibz * BLOCKS_PER_SIDE + ibx] ?? 0,
        h: d.heights[gi] ?? 0,
      };
    },
  };
}

/**
 * ★ per-chunk 意图应用（《重构设计》§8 第四步定版）：
 * 把意图 refine 到该 chunk 的构建源上。只应出现在知道 (cx,cz) 的构建出口
 * （ChunkSurface / ChunkWalls / Worker 快照装配），意图不进入共享源。
 * 空精修 → refine 恒透传原对象（回归基线不变）。
 */
export function refineChunkSource(
  src: BlockSource,
  seed: number,
  cx: number,
  cz: number,
): BlockSource {
  return refine(src, planRefinements(seed, cx, cz));
}

// ============================================================
// 边级裁决（插值 = 显式 opt-in；默认恒硬边界立墙）
// ============================================================

/**
 * ★ 边裁决（对称：edgeRuling(a,b) ≡ edgeRuling(b,a)）。
 * 2026-08-31 定版【插值 = 显式 opt-in；默认恒硬边界立墙】：
 *   - 任一侧 edgePolicy 'hard' → cliff
 *   - 任一侧 edgePolicy 'smooth'（且无 hard）→ weld
 *   - 其余一律 cliff。斜坡（weld）只出现在显式启用处：
 *       TileDef.edgePolicy:'smooth'，或 BlockSource.edgeFinal 显式钉死
 *       （planRefinements per-chunk 唯一入口）。
 */
export function edgeRuling(a: BlockInfo, b: BlockInfo): EdgeRuling {
  const ta = tileById(a.id);
  const tb = tileById(b.id);
  const pa = ta.physics.edgePolicy;
  const pb = tb.physics.edgePolicy;
  if (pa === "hard" || pb === "hard") return "cliff";
  if (pa === "smooth" || pb === "smooth") return "weld";
  return "cliff";
}

/**
 * ★ 精修层对外唯一执行口：块 (bx,bz) 与 dir 方向邻边的最终裁决。
 * 优先取 src.edgeFinal 显式覆写；否则回落默认引擎 edgeRuling。
 * 所有消费者一律改问本函数，禁止直接调 edgeRuling（唯一判点不变式）。
 */
export function finalRuling(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
): EdgeRuling {
  const ov = src.edgeFinal?.(bx, bz, dir);
  if (ov !== undefined) return ov;
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  return edgeRuling(
    src.blockAt(bx, bz) ?? MISSING_BLOCK,
    src.blockAt(bx + dx, bz + dz) ?? MISSING_BLOCK,
  );
}

/**
 * ★ 悬空补墙判定已废弃（2026-08-31 重写）：weld 斜坡带在低侧块内部成形，
 *   坡带深度精确落回 hL，无边墙；墙只在 cliff 撕裂面发（见 buildChunkWallBuffers）。
 */

// ============================================================
// 视觉面语义：撕裂面 + 传导场（同级采样）——《重构设计》§3
//   cornerCell(cell ∈ 块 B, 顶点 V) 唯一消费入口，三层判定：
//   1. V 处 B 有 cliff 边段 → B.h（硬边自持，撕裂优先）
//   2. V 落在 B 的 weld 斜坡带内（0<t<w，B 为低侧）→ 剖面采样 max
//   3. 其余 → vertexHeight(V)（顶点场缝合，base 无关）
// ============================================================

/** 米格 cell → 块坐标（4m 块；cell 恒属于唯一块） */
function blockCoordOfCell(cx: number, cz: number): { bx: number; bz: number } {
  return { bx: Math.floor(cx / 4), bz: Math.floor(cz / 4) };
}

/**
 * ★ 顶点场缝合值 vertexHeight(V)：base 无关——环绕 V 的至多 4 块里，
 *   所有"corner-open（在 V 处无 cliff 边段）"的块的高度，与所有 weld 边
 *   crest 高度，取 max。这是水密（watertight）的构造基础：谁查 V 都同值。
 *   对角块只有真斜坡传导（自身 open 或经 weld 边 crest）才抬角。
 */
export function vertexHeight(src: BlockSource, vx: number, vz: number): number {
  let best = -Infinity;
  const bs: { bx: number; bz: number }[] = [];
  const seen = new Set<number>();
  for (const [dx, dz] of [
    [0, 0],
    [0, -1],
    [-1, 0],
    [-1, -1],
  ] as const) {
    const p = blockCoordOfCell(vx + dx, vz + dz);
    const k = p.bx * 4096 + p.bz;
    if (seen.has(k)) continue;
    seen.add(k);
    bs.push(p);
  }
  for (const p of bs) {
    const B = src.blockAt(p.bx, p.bz) ?? MISSING_BLOCK;
    const dxs = p.bx * 4,
      dzs = p.bz * 4;
    const inX = vx === dxs || vx === dxs + 4;
    const inZ = vz === dzs || vz === dzs + 4;
    if (!inX && !inZ) {
      // V 在块内部：该块是周围唯一块，直接取自身高
      best = Math.max(best, B.h);
      continue;
    }
    let open = true;
    if (inX) {
      const dir = vx === dxs + 4 ? 0 : 1;
      if (finalRuling(src, p.bx, p.bz, dir) === "cliff") open = false;
    }
    if (inZ) {
      const dir = vz === dzs + 4 ? 2 : 3;
      if (finalRuling(src, p.bx, p.bz, dir) === "cliff") open = false;
    }
    if (open) best = Math.max(best, B.h);
  }
  // §3.4：max(候选集 ∪ {0})。{0} 只在候选为空（全 MISSING 或缺块）时兜底
  // ——水面（负高）顶点在四块都 present + corner-open 时应取自身 max（可为负）。
  return best === -Infinity ? 0 : best;
}

/**
 * ★ 斜坡剖面采样：低侧块 B 顶面的"蒙皮"沿深入方向 t∈[0,w] 线性降压。
 *  s(0)=hH（crest，贴齐高侧顶），s(w)=hL（精确落回低侧平地，无墙无痕）。
 *  w 可逐边 override（EdgeOverride.rampWidth → src.edgeFinal 已展开到 rampWidthOf）。
 */
/** ★ 斜坡带宽统一取值：逐边覆写优先，否则全局常量（WELD_RAMP_CELLS） */
export function rampWidthOf(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
): number {
  return src.edgeRampWidth?.(bx, bz, dir) ?? WELD_RAMP_CELLS;
}

/**
 * ★ 斜坡剖面采样：t=0 在低侧块该边的 crest，t=w 落到 hL（线性）。
 *   只沿单轴，返回 s(t) = hH − (hH − hL)·t/w。
 */
export function rampProfile(
  w: number,
  hH: number,
  hL: number,
  t: number,
): number {
  if (w <= 0) return hH;
  return hH - (hH - hL) * (t / w);
}

/**
 * ★ cornerCell(source, (bcx,bcz)=cell 归属块, 顶点 (vx,vz))——cell 角点取值。
 * 唯一消费入口；三层判定见文件头。返回 cell 该角的高度。
 */
export function cornerCell(
  src: BlockSource,
  bcx: number,
  bcz: number,
  vx: number,
  vz: number,
): number {
  const B = src.blockAt(bcx, bcz) ?? MISSING_BLOCK;
  const dxs = bcx * 4,
    dzs = bcz * 4;

  // 规则 1：B 在 V 处有 cliff 边段 → 撕裂自持
  const bx0 = dxs,
    bx1 = dxs + 4,
    bz0 = dzs,
    bz1 = dzs + 4;
  const selfHold =
    (vx === bx1 &&
      vz >= bz0 &&
      vz <= bz1 &&
      finalRuling(src, bcx, bcz, 0) === "cliff") ||
    (vx === bx0 &&
      vz >= bz0 &&
      vz <= bz1 &&
      finalRuling(src, bcx, bcz, 1) === "cliff") ||
    (vz === bz1 &&
      vx >= bx0 &&
      vx <= bx1 &&
      finalRuling(src, bcx, bcz, 2) === "cliff") ||
    (vz === bz0 &&
      vx >= bx0 &&
      vx <= bx1 &&
      finalRuling(src, bcx, bcz, 3) === "cliff");
  if (selfHold) return B.h;

  // 规则 2：V 落在 B 的 weld 斜坡带内（B 为其低侧，0 < t < w）
  // 沿 +x/-x/+z/-z 四向检查
  let bandBest = -Infinity;
  const dirs: [0 | 1 | 2 | 3, number, number][] = [
    [0, 1, 0],
    [1, -1, 0],
    [2, 0, 1],
    [3, 0, -1],
  ];
  for (const [dir, ndx, ndz] of dirs) {
    if (finalRuling(src, bcx, bcz, dir) !== "weld") continue;
    const H = src.blockAt(bcx + ndx, bcz + ndz) ?? MISSING_BLOCK;
    const hH = H.h,
      hL = B.h;
    if (hH <= hL) continue; // 需 B 为低侧
    const w = rampWidthOf(src, bcx, bcz, dir);
    // 深入方向 t：0 在共享边，w 到坡脚
    let t: number;
    if (dir === 0) t = bx1 - vx;
    else if (dir === 1) t = vx - bx0;
    else if (dir === 2) t = bz1 - vz;
    else t = vz - bz0;
    // 沿边坐标 i：只对"本块垂直于该边的范围内"（i∈[0,4]）采样
    const i = dir === 0 || dir === 1 ? vz - bz0 : vx - bx0;
    if (t > 0 && t < w && i >= 0 && i <= 4) {
      bandBest = Math.max(bandBest, rampProfile(w, hH, hL, t));
    }
  }
  if (bandBest > -Infinity) return bandBest;

  // 规则 3：顶点场缝合
  return vertexHeight(src, vx, vz);
}

/**
 * ★ 视觉面一致采样（文档 §3.1）：查询点所在 cell 的四角按【块归属】取高后
 * 三角形插值——与网格渲染逐位一致。对角线 (lx,lz+1)-(lx+1,lz)，
 * fx+fz≤1 取 T1=△(h00,h01,h10)（PlaneGeometry 真实剖分，勿改）。
 */
export function sampleSurface(src: BlockSource, x: number, z: number): number {
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  const fx = x - gx;
  const fz = z - gz;
  const { bx, bz } = blockCoordOfCell(gx, gz);
  const h00 = cornerCell(src, bx, bz, gx, gz);
  const h10 = cornerCell(src, bx, bz, gx + 1, gz);
  const h01 = cornerCell(src, bx, bz, gx, gz + 1);
  const h11 = cornerCell(src, bx, bz, gx + 1, gz + 1);
  if (fx + fz <= 1) {
    return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  }
  return h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
}

// ============================================================
// 边信息（墙生成 / 可遍历性消费）
// ============================================================

export interface EdgeInfo {
  /** 裁决结论 */
  ruling: EdgeRuling;
  /** 落差 = 高侧 − 低侧（≥ 0） */
  drop: number;
  /** 高侧块（drop=0 时 = low） */
  high: BlockInfo;
  /** 低侧块 */
  low: BlockInfo;
}

/**
 * 块 (bx,bz) 与 (dir 方向邻块) 的边信息。
 * dir：0=+x 1=−x 2=+z 3=−z（与 ChunkWalls 扫描方向表对应）。
 */
export function edgeOf(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
): EdgeInfo {
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  const a = src.blockAt(bx, bz) ?? MISSING_BLOCK;
  const b = src.blockAt(bx + dx, bz + dz) ?? MISSING_BLOCK;
  const drop = a.h - b.h;
  const high = drop >= 0 ? a : b;
  const low = drop >= 0 ? b : a;
  return {
    ruling: finalRuling(src, bx, bz, dir),
    drop: Math.abs(drop),
    high,
    low,
  };
}

// ============================================================
// 精修意图类型（setHeight / overrideEdge …）
// ============================================================

/** 显式钉死某条边（dir：0=+x 1=−x 2=+z 3=−z） */
export interface EdgeOverride {
  bx: number;
  bz: number;
  dir: 0 | 1 | 2 | 3;
  ruling: EdgeRuling;
  /** weld 斜坡带宽（米，可选；缺省 = WELD_RAMP_CELLS） */
  rampWidth?: number;
}

/** 块属性改写（hBase 双语义的地形成形原语）：改 h = 顶面高；hBase = 面板底 */
export interface HeightPatch {
  bx: number;
  bz: number;
  h: number;
  /** 缺省 = h（保持厚度，不悬空） */
  hBase?: number;
}

/** 精修意图：块 (bx,bz) 上的显式边裁决 + 显式高度/底高改写 */
export interface Refinements {
  /** 确定性精修索引：世界块坐标 → 该块四条边的显式裁决 */
  edgeOverrides: Map<string, EdgeOverride>;
  /** 确定性高度改写：块坐标 → 块属性补丁（改 h，hBase 缺省 = h） */
  heights: Map<string, HeightPatch>;
}

/** 空精修（回归对照：空精修 ≡ C-D 基线；连同「恒透传=旧世界逐位一致」基线
 *  已在《重构设计》§1.1 作废，原因：与根除对角拉起互斥） */
export const EMPTY_REFINEMENTS: Refinements = {
  edgeOverrides: new Map(),
  heights: new Map(),
};

function edgeKey(bx: number, bz: number, dir: 0 | 1 | 2 | 3): string {
  return `${bx},${bz},${dir}`;
}
function blockKey(bx: number, bz: number): string {
  return `${bx},${bz}`;
}

/**
 * ★ 依据 seed 与 chunk 坐标生成精修意图（per-chunk：《重构设计》§8 第四步）。
 * 当前恒空——理由（2026-08-31 定版，用户确认）：地形 = 全方块模型，地块高度
 * （ground/platform/pit/water 及各 physics）已在 L4 assignHeights 全部定死，
 * 精修层只做块间过渡（weld 斜坡 / cliff 断崖 / 墙），不碰地块几何高度。
 * 《重构设计》§5 早期设想的 setHeight 削顶/垫底（厚板/薄壳/下沉台）是无对应
 * 需求的臆想内容，故定为恒空；未来若出现真实 per-chunk 规则（如逐边坡宽、
 * 显式边裁决），在此按 hash2(seed, cx, cz) 确定性铺，签名已就位。
 */
export function planRefinements(
  _seed: number,
  _cx: number,
  _cz: number,
): Refinements {
  return EMPTY_REFINEMENTS;
}

/**
 * ★ 精修层核心：把一块 BlockSource 包装为「精修后的 BlockSource」。
 *  - 空精修：不设 edgeFinal、不提高度 → finalRuling/blockAt 落回默认引擎
 *    （回归 C-D 对照；「恒透传 ≡ 旧世界」基线见《重构设计》§1.1，已作废）。
 *  - 有精修：edgeFinal 对显式条目返回钉死裁决；blockAt 对显式高度/底高
 *    补丁返回改写后的块信息，其余回落默认。
 */
export function refine(src: BlockSource, ref: Refinements): BlockSource {
  const hasEdges = ref.edgeOverrides.size > 0;
  const hasHeights = ref.heights.size > 0;
  if (!hasEdges && !hasHeights) return src;
  const out: BlockSource = { ...src };
  if (hasEdges) {
    out.edgeFinal = (
      bx: number,
      bz: number,
      dir: 0 | 1 | 2 | 3,
    ): EdgeRuling | undefined =>
      ref.edgeOverrides.get(edgeKey(bx, bz, dir))?.ruling;
    out.edgeRampWidth = (
      bx: number,
      bz: number,
      dir: 0 | 1 | 2 | 3,
    ): number | undefined =>
      ref.edgeOverrides.get(edgeKey(bx, bz, dir))?.rampWidth;
  }
  if (hasHeights) {
    const base = src.blockAt.bind(src);
    out.blockAt = (bx: number, bz: number) => {
      const p = ref.heights.get(blockKey(bx, bz));
      const b = base(bx, bz);
      if (!p || !b) return b;
      return {
        id: b.id,
        h: p.h,
        ...(p.hBase !== undefined ? { hBase: p.hBase } : { hBase: b.hBase }),
      };
    };
  }
  return out;
}

/** 便捷：给某条边显式钉死裁决（inherit = 从表里删除，回落默认引擎）。
 *  rampWidth 可选：weld 斜坡带宽（米），缺省 = 全局 WELD_RAMP_CELLS。 */
export function overrideEdge(
  ref: Refinements,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
  ruling: EdgeRuling | "inherit",
  rampWidth?: number,
): Refinements {
  const next = new Map(ref.edgeOverrides);
  const key = edgeKey(bx, bz, dir);
  if (ruling === "inherit") next.delete(key);
  else
    next.set(key, {
      bx,
      bz,
      dir,
      ruling,
      ...(rampWidth !== undefined ? { rampWidth } : {}),
    });
  return { edgeOverrides: next, heights: new Map(ref.heights) };
}

/** 便捷：给某块改写高度。断言 hBase 缺省 = h（保持厚度、不悬空）。 */
export function setHeight(
  ref: Refinements,
  bx: number,
  bz: number,
  h: number,
  hBase?: number,
): Refinements {
  const next = new Map(ref.heights);
  next.set(blockKey(bx, bz), {
    bx,
    bz,
    h,
    ...(hBase !== undefined ? { hBase } : {}),
  });
  return { edgeOverrides: new Map(ref.edgeOverrides), heights: next };
}

// ============================================================
// 确定性侵蚀（连续、克制；默认关闭——构建器不被 planRefinements 自动引用）
// ============================================================
export type BlockReader = (bx: number, bz: number) => BlockInfo | undefined;

export interface CarveOpts {
  maxBlocks?: number;
  maxDepth?: number;
  maxSteps?: number;
}

/**
 * ① 低处沟壑（梯度切蚀）：确定性撒少量种子块，BFS 沿更低邻块下行压深。
 *    因沿高度梯度向低处蔓延 → 成连续条带沟壑，而非孤立坑。
 */
export function carveGradientErosion(
  seed: number,
  read: BlockReader,
  opts: CarveOpts = {},
): Refinements {
  const maxBlocks = opts.maxBlocks ?? 24;
  const maxDepth = opts.maxDepth ?? 0.5;
  const maxSteps = opts.maxSteps ?? 8;
  const half = 32;
  let ref: Refinements = EMPTY_REFINEMENTS;
  const seedCount = 2 + (Math.abs(seed) % 3);
  let carved = 0;
  const nbr = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let s = 0; s < seedCount && carved < maxBlocks; s++) {
    const u = pseudo(s, seed);
    const v = pseudo(s * 7 + 13, seed);
    const sx = Math.floor(u * (half * 2) - half);
    const sz = Math.floor(v * (half * 2) - half);
    const start = read(sx, sz);
    if (!start) continue;
    if (pseudo(s + 99, seed) > 0.35) continue;
    const queue: [number, number, number][] = [[sx, sz, 0]];
    const seen = new Set<number>([sx * 4096 + sz]);
    while (queue.length > 0 && carved < maxBlocks) {
      const [cx, cz, step] = queue.shift()!;
      if (step > maxSteps) break;
      const b = read(cx, cz);
      if (!b) continue;
      ref = setHeight(ref, cx, cz, b.h - maxDepth, b.h - maxDepth);
      carved++;
      const lower = nbr
        .map(([dx, dz]) => read(cx + dx, cz + dz))
        .map((bb, k) => ({ bb, dx: nbr[k][0], dz: nbr[k][1] }))
        .filter(({ bb }) => bb && bb.h <= b.h + 1e-9)
        .sort((x, y) => x.bb!.h - y.bb!.h);
      for (const { bb, dx, dz } of lower) {
        const k = (cx + dx) * 4096 + (cz + dz);
        if (bb && !seen.has(k)) {
          seen.add(k);
          queue.push([cx + dx, cz + dz, step + 1]);
        }
      }
    }
  }
  return ref;
}

function pseudo(i: number, seed: number): number {
  let x = (i + 1) * 31 + seed * 2654435761;
  x = (x ^ (x >>> 16)) * 0x45d9f3b;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// ============================================================
// ★ 定型快照（per-chunk 单产物，精修层统一输出）
// 语义见《精修层与定型快照架构.md》§3/§4：精修层对每个 chunk 产出一份
// 唯一定型产物，下游（顶面网格/墙/地形物理/贴地）一律只读它，零自算。
// 全部 raw 数组、零 three 依赖——主线程与 Worker 同一份代码。
// ============================================================

export interface ChunkFinal {
  /** chunk 边长（米） */
  size: number;
  cx: number;
  cz: number;
  /**
   * ★ 定型角点高度场：每米格四角（c00 c10 c11 c01），布局 (lz*N+lx)*4+k。
   * 已按精修裁决（weld = 2×2 max / cliff = 自持）定型——顶面网格与贴地
   * 采样的唯一权威，一次算好、处处读同一份。
   */
  cornerH: Float32Array;
  /** 顶面几何（局部坐标，中心原点，与旧 ChunkSurface 逐位同约定） */
  top: {
    vertices: Float32Array; // 4 顶点/格 × 3
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array; // 2 三角/格 × 3
  };
}

/**
 * ★ 构建一个 chunk 的定型快照（精修层统一产出）。
 * 输入 = 精修后的 BlockSource src（精修层包装原始块数据后的查询源；
 * 消费方用它统一建源，取代各自逐角拼）。
 * 顶面几何产物与【撕裂面+传导场】模型【逐位一致】（《重构设计》§1.1 不变式
 * ① 顶点一致：任意顶点视觉高只由 cornerCell 一元决定）。
 * 纯函数；cornerH 一次算好，顶面/贴地/烘焙都读它。
 */
export function buildChunkFinal(
  src: BlockSource,
  cx: number,
  cz: number,
  size: number,
): ChunkFinal {
  const N = size;
  const cells = N * N;
  const cornerH = new Float32Array(cells * 4);
  const positions = new Float32Array(cells * 4 * 3);
  const normals = new Float32Array(cells * 4 * 3);
  const uvs = new Float32Array(cells * 4 * 2);
  const indices = new Uint32Array(cells * 6);
  const HALF = N / 2;
  const wx0 = cx * N;
  const wz0 = cz * N;
  let vp = 0,
    up = 0,
    ip = 0,
    vi = 0;

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx = wx0 + lx;
      const wz = wz0 + lz;
      const bbx = Math.floor(wx / 4),
        bbz = Math.floor(wz / 4);
      const h00 = cornerCell(src, bbx, bbz, wx, wz);
      const h10 = cornerCell(src, bbx, bbz, wx + 1, wz);
      const h11 = cornerCell(src, bbx, bbz, wx + 1, wz + 1);
      const h01 = cornerCell(src, bbx, bbz, wx, wz + 1);
      const ci = (lz * N + lx) * 4;
      cornerH[ci] = h00;
      cornerH[ci + 1] = h10;
      cornerH[ci + 2] = h11;
      cornerH[ci + 3] = h01;

      const x00 = lx - HALF,
        z00 = lz - HALF;
      positions[vp] = x00;
      positions[vp + 1] = h00;
      positions[vp + 2] = z00;
      positions[vp + 3] = x00 + 1;
      positions[vp + 4] = h10;
      positions[vp + 5] = z00;
      positions[vp + 6] = x00 + 1;
      positions[vp + 7] = h11;
      positions[vp + 8] = z00 + 1;
      positions[vp + 9] = x00;
      positions[vp + 10] = h01;
      positions[vp + 11] = z00 + 1;
      for (let k = 0; k < 4; k++) normals[vp + k * 3 + 1] = 1;
      uvs[up] = lx / N;
      uvs[up + 1] = lz / N;
      uvs[up + 2] = (lx + 1) / N;
      uvs[up + 3] = lz / N;
      uvs[up + 4] = (lx + 1) / N;
      uvs[up + 5] = (lz + 1) / N;
      uvs[up + 6] = lx / N;
      uvs[up + 7] = (lz + 1) / N;
      indices[ip] = vi;
      indices[ip + 1] = vi + 3;
      indices[ip + 2] = vi + 1;
      indices[ip + 3] = vi + 3;
      indices[ip + 4] = vi + 2;
      indices[ip + 5] = vi + 1;
      vp += 12;
      up += 8;
      ip += 6;
      vi += 4;
    }
  }

  return {
    size: N,
    cx,
    cz,
    cornerH,
    top: { vertices: positions, normals, uvs, indices },
  };
}

// ============================================================
// ★ 断崖墙几何 + 地形物理合并（精修层统一产出，raw 缓冲、零 three 依赖）
// 语义见《精修层与定型快照架构.md》§3/§4：断崖墙与「地形物理数据」都由
// 精修层产出一份；实体/装饰碰撞是下游管理器的第二层产出（不进本快照）。
// 与历史 ChunkWalls 网格【逐位一致】——只搬位不搬逻辑（装配成 THREE 仍
// 由 ChunkWalls 薄壳完成）。纯函数、确定性、主线程与 Worker 可共用。
// ============================================================

/** 墙底延伸（防与地面共面闪烁） */
const WALL_EPS = 0.05;

/**
 * ★ 断崖墙生成（2026-08-31 重写：《重构设计》§4）。
 * 发墙判据只有一条：相邻两块交界裁决 == 'cliff'，且两侧块【逻辑高】确有落差
 * （bCur.h − bNb.h > CLIFF_EPS；等高块的 cliff 裁决 → drop=0 → 不发墙，§3.3
 * 「块逻辑高判发墙」/设计 §4.1 退化保护）。weld 斜坡带永不发墙（坡带在低侧
 * 块内部成形、坡脚精确落回 hL——共享 weld 边零落差是契约，任何 weld 边触发
 * 发墙 = 回归失败，见回归脚本）。
 * 墙顶随该边的视觉面（cliff 侧各自自持 → 高侧顶 = 高侧块视觉面值，未随
 * 斜坡抬高；等高块即使遇垂直 weld 坡也不发幽灵墙）。
 * 墙底 = 两侧面板底之更浅者 − WALL_EPS（堵死不悬空）。
 */
const CLIFF_EPS = 0;

export function buildChunkWallBuffers(
  src: BlockSource,
  cx: number,
  cz: number,
  size: number,
  ctx: WallBuildCtx,
): ChunkWallBuffers {
  const N = size;
  const ox = cx * N;
  const oz = cz * N;
  const { seed } = ctx;
  const palette = ctx.palette;

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let vi = 0;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const bxC = Math.floor((ox + i + 0.5) / 4),
        bzC = Math.floor((oz + j + 0.5) / 4);
      const bCur = src.blockAt(bxC, bzC) ?? MISSING_BLOCK;
      for (let d = 0; d < 4; d++) {
        const dir = DIRS[d];
        const ni = i + dir.dx,
          nj = j + dir.dz;
        const bxN = Math.floor((ox + ni + 0.5) / 4),
          bzN = Math.floor((oz + nj + 0.5) / 4);
        const bNb = src.blockAt(bxN, bzN) ?? MISSING_BLOCK;

        // ★ 唯一判据：裁决 cliff 且两侧块逻辑高确有落差（§4.1「真断崖」）。
        //   weld 永不发墙（weld 边触发发墙 = 回归失败）。
        //   退化保护：等高块（|hCur−hNb|=0）→ drop=0 → 不发（§3.3「块逻辑高差」、
        //   设计 §4.1 127 行）。墙顶只随 cornerCell 走顶面，落差判定用块高。
        const dR = d as 0 | 1 | 2 | 3;
        if (finalRuling(src, bxC, bzC, dR) !== "cliff") continue;
        // 去重：仅从中心块更高的那侧发墙（每条边界只发一次，法线朝低处）
        if (bCur.h <= bNb.h) continue;
        const topHigh = Math.max(
          blockVisualTop(src, bxC, bzC, ox + i + dir.ax, oz + j + dir.az),
          blockVisualTop(src, bxC, bzC, ox + i + dir.bx, oz + j + dir.bz),
        );
        const lowBase = Math.min(baseHeightOf(bCur), baseHeightOf(bNb));

        const drop = topHigh - lowBase;
        const yB = lowBase - WALL_EPS;

        const td = ctx.tileDefAt(
          ox + i + 0.5 + dir.dx * 0.5,
          oz + j + 0.5 + dir.dz * 0.5,
        );
        const thM = td.isDepression ? SEMANTIC_THEME_MIX : 1;
        const th = applyGroupTintHsl(td.visual.baseHsl, palette, thM);
        let [r, g, b] = hsl2rgb(th.h, th.s, th.l);
        const facing = Math.max(0, dir.dx * SUN_HX + dir.dz * SUN_HZ);
        const k =
          wallShade(ctx.heightAt, seed, ox + i, oz + j, drop, facing) / 255;

        const xA = i + dir.ax - N / 2,
          zA = j + dir.az - N / 2;
        const xB = i + dir.bx - N / 2,
          zB = j + dir.bz - N / 2;

        const topA = blockVisualTop(
          src,
          bxC,
          bzC,
          ox + i + dir.ax,
          oz + j + dir.az,
        );
        const topB = blockVisualTop(
          src,
          bxC,
          bzC,
          ox + i + dir.bx,
          oz + j + dir.bz,
        );

        pos.push(xA, topA, zA, xB, topB, zB, xB, yB, zB, xA, yB, zA);
        for (let c = 0; c < 4; c++) {
          nor.push(dir.dx, 0, dir.dz);
          col.push(r * k, g * k, b * k);
        }
        idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
        vi += 4;
      }
    }
  }

  return {
    vertices: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
  };
}

/**
 * 判断在块 (bx,bz) 一条边沿某方向（dir 映射见 DIRS）的那条边界，其顶点处于
 * 撕裂（cliff）时只是 h(B)；否则走视觉面采样。这里用于墙顶的落点：
 * 只处理 cliff 边，墙顶应取两侧块中视觉面较高者的表面值。
 */
function blockVisualTop(
  src: BlockSource,
  bcx: number,
  bcz: number,
  wx: number,
  wz: number,
): number {
  return cornerCell(src, bcx, bcz, wx, wz);
}

// ---- 侧壁明暗调参（集中此处；全部确定性，同种子必复现）----
const WALL_K_BACK = 0.22;
const WALL_K_LIT = 0.82;
const WALL_DEPTH_DARKEN = 0.16;
const WALL_SKY_DIM = 0.22;
const WALL_JITTER = 0.1;

// 烘焙太阳水平方向：唯一权威来源 = bakeCompute.BAKE_SUN（import，勿手抄）
const SUN_HX = BAKE_SUN.hx;
const SUN_HZ = BAKE_SUN.hz;

/**
 * 单面墙的显示空间亮度乘数（与 ChunkWalls.wallShade 逐位一致，原位搬运）。
 * 变化来源（由强到弱）：朝向 × 太阳 > 落差深度 > 天空可见度 > 位置抖动。
 */
function wallShade(
  heightAt: (x: number, z: number) => number,
  seed: number,
  wi: number,
  wj: number, // 墙所属格（世界格坐标，抖动种子用）
  drop: number, // 落差（米）
  facing: number, // 朝阳度 0..1（外法线·太阳水平方向）
): number {
  let k = WALL_K_BACK + (WALL_K_LIT - WALL_K_BACK) * facing;
  k -= Math.min(1, drop / 4) * WALL_DEPTH_DARKEN;
  const wx = wi + 0.5,
    wz = wj + 0.5;
  const hTop = heightAt(wx, wz) + 0.6;
  let open = 0;
  for (let n = 0; n < 8; n++) {
    const ang = (n / 8) * Math.PI * 2;
    if (heightAt(wx + Math.cos(ang) * 2.5, wz + Math.sin(ang) * 2.5) <= hTop)
      open++;
  }
  const openF = open / 8;
  k *= 1 - WALL_SKY_DIM * (1 - openF);
  k *= 1 + (hash2(wi, wj, seed + 7717) - 0.5) * 2 * WALL_JITTER;
  return Math.max(0.14, k);
}

/** 四向断崖绕序表（法线朝低处外侧）。edgeOf 方向参数映射：DIRS 索引即 dir。 */
const DIRS = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
];

/** 墙构建产物（raw 缓冲；局部坐标，与顶面同约定可合并建 trimesh） */
export interface ChunkWallBuffers {
  vertices: Float32Array; // 位置 ×3
  normals: Float32Array; // 法线 ×3
  colors: Float32Array; // 顶点色 ×3（已乘明暗）
  indices: Uint32Array;
}

export interface WallBuildCtx {
  seed: number;
  /** 本 chunk 所属组的调色板（缺省 = 中性，组外观调制用） */
  palette?: GroupPalette;
  /** 逻辑高度（与 RasterMap.heightAt 同语义：矮区未加载返回 0） */
  heightAt(x: number, z: number): number;
  /** 块定义查询（与 RasterMap.tileDefAt 同语义；墙/坑侧壁取地块底色） */
  tileDefAt(
    x: number,
    z: number,
  ): {
    visual: { baseHsl: { h: number; s: number; l: number } };
    isDepression: boolean;
  };
}

/**
 * ★ 地形物理合并（精修层统一产出）：顶面 + 墙合并成一份可直接建 trimesh
 * 的数据体（局部坐标）。物理 trimesh 无体积，cliff 边无墙面低侧物体会水平
 * 穿入高板体内侧坠落——故墙三角形必须并入（碰撞=所见不变式）。
 * 这是架构文档 §3 的「地形物理数据（第一次产出）」，不含实体/装饰碰撞。
 */
export function mergeTerrainPhysics(
  top: { vertices: Float32Array; indices: Uint32Array },
  walls: ChunkWallBuffers,
): { vertices: Float32Array; indices: Uint32Array } {
  if (walls.indices.length === 0)
    return { vertices: top.vertices, indices: top.indices };
  const vertices = new Float32Array(
    top.vertices.length + walls.vertices.length,
  );
  vertices.set(top.vertices, 0);
  vertices.set(walls.vertices, top.vertices.length);
  const indices = new Uint32Array(top.indices.length + walls.indices.length);
  indices.set(top.indices, 0);
  const vOff = top.vertices.length / 3;
  for (let k = 0; k < walls.indices.length; k++) {
    indices[top.indices.length + k] = walls.indices[k] + vOff;
  }
  return { vertices, indices };
}
