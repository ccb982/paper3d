// ============================================================
// Refinements —— 地形精修层（L6 定型段核心执行器，唯一地形几何真源）
// ============================================================
// 权威架构文档：《地图架构.md》（硬边界基础 + 两插值/边角融合 + 墙与裁决解耦）。
//
// ★ 意志：本文件是【地形本体的唯一真源】——
//   1) 边裁决：块边界「硬过渡(cliff) vs 插值(weld)」判定执行权由本层全权执掌：
//      - 【插值 = 显式 opt-in】（2026-08-31 定版）：默认引擎恒 hard（cliff），
//        凡未显式 smooth 的边一律立墙；weld 只发生在 BlockSource.edgeFinal
//        显式钉死或 TileDef.edgePolicy:'smooth' 启用的边上。
//      - 消费者一律走 finalRuling/edgeOf，只读本层输出（第五铁律）。
//   2) 视觉面几何：角点高度 cornerCell、边插值 interpEdge、斜坡剖面
//      rampProfile、贴地采样 sampleSurface、面板底 baseHeightOf 的语义公式
//      全部并入本文件（2026-08-30 SurfaceRules 物理并入）。角无独立插值，
//      由两条触及 weld 边在 t=0 的 crest 汇合（《地图架构.md》§4.3）。
//
// ★ 确定性/可重放：纯函数、逐位可复现（同种子同源同输出）。
//   零 three 依赖，主线程与 Worker 同一份代码。
// ============================================================

import { tileById, type TileGenRole } from "./Tiles";
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
import { BAKE_SUN, CAST_MIN_DEPTH } from "./RefinementConstants";

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
 * ★ weld 斜坡带宽（米，默认 = 块宽 1/3）。可配层级（由粗到细）：
 *   WELD_RAMP_CELLS（本常量） → TileDef.physics.edgePolicy（语义不变） →
 *   planRefinements 逐边 EdgeOverride.rampWidth（优先）。
 * 取块宽 1/3：对向两条 weld 坡各自占 1/3，中间留 1/3 平地（坡+平地+坡），
 * 两坡不重叠 → 无 V/U 凹谷；且边与角用同一梯度（角=两坡平面汇合引致 crest）。
 */
export const WELD_RAMP_CELLS = BLOCK_SIZE / 3;

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
  return refine(src, planRefinements(seed, cx, cz, src));
}

// ============================================================
// 边级裁决（插值 = 显式 opt-in；默认恒硬边界立墙）
// ============================================================

/**
 * ★ 边裁决（对称：edgeRuling(a,b,dir) ≡ edgeRuling(b,a,dir^1)——dir 与 dir^1
 *   是同一条共享边，两侧查询必须同值，否则撕裂）。
 * 2026-08-31 定版【插值 = 显式 opt-in；默认恒硬边界立墙】：
 *   - 任一侧 edgePolicy 'hard' → cliff
 *   - 任一侧 edgePolicy 'smooth'（且无 hard）→ weld
 *   - 任一侧 smoothDirs 声明该共享边（本侧 dir 或对侧 dir^1）→ weld
 *   - 其余一律 cliff。斜坡（weld）只出现在显式启用处。
 *
 * @param dir 方向 0=+x 1=-x 2=+z 3=-z（与 finalRuling 对齐；缺省跳过方向判定）
 */
export function edgeRuling(
  a: BlockInfo,
  b: BlockInfo,
  dir?: number,
): EdgeRuling {
  const ta = tileById(a.id);
  const tb = tileById(b.id);
  const pa = ta.physics.edgePolicy;
  const pb = tb.physics.edgePolicy;
  // ★ 水/坑洞一律焊（2026-08-31 用户确认：水/坑无条件向周围插值，覆盖 hard）。
  //   水已全向 smoothDirs；坑默认 cliff → 此行使坑也向平地/高台缓坡入坑。
  const ra = ta.genRole;
  const rb = tb.genRole;
  if (ra === "liquid" || ra === "pit" || rb === "liquid" || rb === "pit")
    return "weld";
  if (pa === "hard" || pb === "hard") return "cliff";
  if (pa === "smooth" || pb === "smooth") return "weld";
  if (dir !== undefined) {
    const opp = dir ^ 1; // 0↔1、2↔3：同一条共享边的对侧方向
    const sa = ta.physics.smoothDirs;
    const sb = tb.physics.smoothDirs;
    if (
      (sa && (sa.includes(dir) || sa.includes(opp))) ||
      (sb && (sb.includes(dir) || sb.includes(opp)))
    )
      return "weld";
  }
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
    dir,
  );
}

/**
 * ★ 墙生成（2026-08-31 定版：墙与裁决解耦）：任何两侧块高有落差的边都发墙
 *   —— cliff 墙 = 撕裂面本身；weld 墙 = 坡面背后的贴坡背墙（封闭坡带下方
 *   空腔）。斜坡蒙皮只是附加在墙前低侧块上的额外面（见 buildChunkWallBuffers）。
 */

// ============================================================
// ★ 视觉面几何：硬边界基础 + 边插值后修正（§4）
//   架构：《地图架构.md》§4（2026-08-31 后修正+角边融合）
//   插值 = 硬边界流水线完成后的后修正；一次只处理一个边/一个点。
//   唯一控制函数 surfaceHeightCore 编排一切（决定哪些边进入插值、max 合成）。
//   interpEdge 是最小化纯函数（只算本边、只对本点取剖面）。
//   角点 = 两条触及 weld 边在 t=0 的 crest 自然汇合（边角同坡，无独立平顶）。
// ============================================================

/**
 * ★ 斜坡带宽统一取值：逐边覆写优先，否则全局常量（WELD_RAMP_CELLS）。
 */
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
 * ★ 检查两个 genRole 是否允许插值（地块属性校验）。同类型对默认不插值，
 *   例外：高台↔高台（platform↔platform）允许——2026-08-31 用户确认
 *   「高台间高差大时 30% 概率产坡」，需同角色插值才能成坡。
 */
function canInterpolateByType(role1: TileGenRole, role2: TileGenRole): boolean {
  if (role1 === role2) return role1 === "platform"; // 仅高台↔高台同角色可插
  // 对 genRole 排序，确保 key 唯一
  const [a, b] = role1 < role2 ? [role1, role2] : [role2, role1];
  // 允许的交叉对
  const ALLOWED: Record<string, boolean> = {
    "ground↔platform": true,
    "ground↔liquid": true,
    "ground↔pit": true,
    "liquid↔platform": true,
    "pit↔platform": true,
  };
  return ALLOWED[a + "↔" + b] ?? false;
}

/**
 * ★ 边插值（§4.2，最小化：一次只处理【一条边】在【一个点】的坡带高度）。
 * 返回该 weld 边在 V(x,z) 处的坡带高度，未命中（含该边不是 weld / 类型不容 /
 * 本块非低侧 / V 在坡带外）返回 undefined。
 *
 * 仅发生在本块的这一条 dir 边；不读、不算、不改其他边/角/地块。
 * @param B 以块视角 (bx,bz) 为低侧块（若 B 非低侧 → 前置闸 c 拒绝）
 */
export function interpEdge(
  src: BlockSource,
  bx: number,
  bz: number,
  dir: 0 | 1 | 2 | 3,
  x: number,
  z: number,
): number | undefined {
  const B = src.blockAt(bx, bz) ?? MISSING_BLOCK;
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  const nb = src.blockAt(bx + dx, bz + dz) ?? MISSING_BLOCK;

  // a. 类型对可插值（同类型对永不插值）
  if (!canInterpolateByType(tileById(B.id).genRole, tileById(nb.id).genRole))
    return undefined;
  // b. 裁决必须 weld（cliff 一律拒绝）
  if (finalRuling(src, bx, bz, dir) !== "weld") return undefined;
  // c. 低侧：B 是低侧块（hH > hL），只向高侧攀爬
  const hH = Math.max(B.h, nb.h);
  const hL = Math.min(B.h, nb.h);
  if (B.h > nb.h) return undefined; // B 是高侧 → 由低侧块一方插值
  if (hH === hL) return undefined; // 等高 → 无坡
  // d. 坡带内：t = V 到 B 在 dir 方向边界的米距，须 t ∈ [0, w]
  const w = rampWidthOf(src, bx, bz, dir);
  const bx0 = bx * 4,
    bz0 = bz * 4;
  let t = 0;
  switch (dir) {
    case 0:
      t = bx0 + 4 - x;
      break; // 右边界 (bx+1)*4
    case 1:
      t = x - bx0;
      break; // 左边界 bx*4
    case 2:
      t = bz0 + 4 - z;
      break; // 上边界 (bz+1)*4
    case 3:
      t = z - bz0;
      break; // 下边界 bz*4
  }
  if (t < 0 || t > w) return undefined;
  return rampProfile(w, hH, hL, t);
}

/**
 * ★ 唯一控制/编排函数（§4.2）：任意查询点 V(x,z) 的视觉面高度。
 * 以块视角 (bx,bz) 为「所属块 B」——同一 V 从不同块视角查可得不同值，
 * 这正是表达撕裂角（cliff 四块各持各高）的唯一途径。
 *
 * 流程（硬边界先行，边插值作为后修正；一次一个边/一个点）：
 *   ① 硬边界基面 h = hB
 *   ② 逐条 weld 边 interpEdge → max 合成（undefined 忽略回落 hB）
 *   ③ 返回 h（hB ≤ h ≤ 触及最高 crest）
 *
 * ★ 角与边融合（2026-08-31 新设计）：
 *   角点不再独立抬成平顶——低侧块在格点角处，其两条触及 weld 边的
 *   interpEdge 都在 t=0 取 crest（块边界），max 后即得共享 crest；
 *   角到两边的区域由两坡平面自然汇合（同一梯度，边角坡度一致）。
 *   对向两 weld：各自占块宽 1/3 坡 + 中部 1/3 平地（坡+平地+坡，无 V/U）。
 *   故不再需要独立 interpCorner / collectCornerCandidates。
 */
export function surfaceHeightCore(
  src: BlockSource,
  bx: number,
  bz: number,
  x: number,
  z: number,
): number {
  const B = src.blockAt(bx, bz) ?? MISSING_BLOCK;
  let h = B.h; // ① 硬边界基面 h = hB（先导完整硬边界）
  // ② 边插值：遍历 4 条边，一条边一个点（含格点角处 t=0 → crest，融合）
  for (let dir = 0; dir < 4; dir++) {
    const d = dir as 0 | 1 | 2 | 3;
    const e = interpEdge(src, bx, bz, d, x, z);
    if (e !== undefined) h = Math.max(h, e);
  }
  // ③ 返回 h（hB ≤ h ≤ 触及最高 crest；hB 即 B.h 已为初值）
  return h;
}

/**
 * ★ cornerCell —— 网格顶点取值（块视角）。
 * = surfaceHeightCore(src, bx, bz, x, z)。
 * 以调用方块视角 (bx,bz) 为 B——同一顶点从不同块视角可不同值 → 撕裂角正确
 * 表达（每个 cell 传自己所属块）。
 */
export function cornerCell(
  src: BlockSource,
  bx: number,
  bz: number,
  x: number,
  z: number,
): number {
  return surfaceHeightCore(src, bx, bz, x, z);
}

/**
 * ★ 贴地/物理采样 —— 以【视觉网格形状】为准（2026-08-31 修正）。
 * 查询点所在米格的 4 角按【块归属】(cell 所属块) 经 cornerCell 取高，
 * 再做三角形插值 —— 与 buildChunkFinal 顶面网格逐位一致（渲染 = 查询同源）。
 * 对角剖分与网格相同：对角线 (gx,gz+1)-(gx+1,gz)，fx+fz≤1 取 T1。
 *  ★ 不用双线性（非平面米格偏差可达米级 → 角色悬浮/影子切入地形）。
 *  ★ 不用 surfaceHeightCore 解析面（max-over-edges 与网格剖面分叉，
 *    在坡底部 / 角上部造成物理与视觉不统一；旧公式逐位对齐网格）。
 */
export function sampleSurface(src: BlockSource, x: number, z: number): number {
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  const fx = x - gx;
  const fz = z - gz;
  const bcx = Math.floor(gx / 4);
  const bcz = Math.floor(gz / 4);
  const h00 = cornerCell(src, bcx, bcz, gx, gz);
  const h10 = cornerCell(src, bcx, bcz, gx + 1, gz);
  const h01 = cornerCell(src, bcx, bcz, gx, gz + 1);
  const h11 = cornerCell(src, bcx, bcz, gx + 1, gz + 1);
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

/** 空精修（回归对照：无任何显式边/高度覆写） */
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
 * ★ 依据 seed 与 chunk 坐标生成精修意图（per-chunk：《地图架构.md》§3.3）。
 * 只做【边裁决】优化（30% 大落差产坡），不碰地块几何高度。
 */
/**
 * ★ 依据 seed 与 chunk 坐标生成精修意图（per-chunk：《重构设计》§8 第四步）。
 * 2026-08-31 重构：只做【边裁决】优化（30% 大落差产坡），不碰地块几何高度
 * ——高度仍由 L4 assignHeights 定死；此处仅把合格边的裁决从默认 cliff 提升为
 * weld（产生坡，方便角色跳/踏上高台）。
 *
 * 规则（用户 2026-08-31 定版）：
 *   - 作用边：两端 genRole 均 ∈ {ground, platform}，且默认 edgeRuling 为
 *     cliff 的非 hard 边（「只在默认 cliff 边掷骰」）；hard/已 smooth 边跳过。
 *   - 高差门槛：|hH − hL| > 0.5（配合角色空格跳跃高度 0.6 → 可跳上）。
 *   - 概率：对【无向】共享边做确定性 hash(seed, A, B) → 30% 掷点，命中 → weld。
 *   - 对称：对同一条共享边，本块与邻块各自补各自方向的 override（同一 hash
 *     保证两侧同判）+ 一个 weld 方向只在本 chunk 的构建 src 里生效 →
 *     finalRuling 天然对称（唯一判点不变式不破坏）。
 *   - 确定性：hash 只依赖 seed 与两块的(世界块坐标)，主线程/Worker 快照同源。
 */
export function planRefinements(
  seed: number,
  cx: number,
  cz: number,
  src: BlockSource,
): Refinements {
  let ref: Refinements = EMPTY_REFINEMENTS;
  const bx0 = cx * BLOCKS_PER_SIDE;
  const bz0 = cz * BLOCKS_PER_SIDE;
  const dirs: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
  for (let ibx = 0; ibx < BLOCKS_PER_SIDE; ibx++) {
    for (let ibz = 0; ibz < BLOCKS_PER_SIDE; ibz++) {
      const bx = bx0 + ibx;
      const bz = bz0 + ibz;
      for (const dir of dirs) {
        const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
        const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
        const nb = src.blockAt(bx + dx, bz + dz);
        const a = src.blockAt(bx, bz);
        if (!a || !nb) continue; // 邻块缺数据 → 由邻块场景处理
        const ta = tileById(a.id);
        const tnb = tileById(nb.id);
        // 端角色须均为 ground/platform
        const ra = ta.genRole;
        const rb = tnb.genRole;
        const inSet = (r: TileGenRole) => r === "ground" || r === "platform";
        if (!inSet(ra) || !inSet(rb)) continue;
        // 默认裁决非 cliff，或任一侧 hard → 不掷骰（只在默认 cliff 边）
        if (edgeRuling(a, nb, dir) !== "cliff") continue;
        if (
          ta.physics.edgePolicy === "hard" ||
          tnb.physics.edgePolicy === "hard"
        )
          continue;
        // 高差门槛
        const gap = Math.abs(a.h - nb.h);
        if (gap <= 0.5) continue;
        // 确定性 30% 掷点（无向共享边 hash → 两侧同判）
        if (edgeHash(seed, bx, bz, bx + dx, bz + dz) >= 0.3) continue;
        ref = overrideEdge(ref, bx, bz, dir, "weld");
      }
    }
  }
  return ref;
}

/** 无向共享边的确定性 hash（对两块坐标排序 → 主/worker、两侧块同值） */
function edgeHash(
  seed: number,
  b1x: number,
  b1z: number,
  b2x: number,
  b2z: number,
): number {
  let ax = b1x,
    az = b1z,
    bx = b2x,
    bz = b2z;
  if (ax > bx || (ax === bx && az > bz)) {
    const tx = ax,
      tz = az;
    ax = bx;
    az = bz;
    bx = tx;
    bz = tz;
  }
  let x = seed ^ (ax * 73856093) ^ (az * 19349663) ^ (bx * 83492791) ^ (bz * 22468219);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * ★ 精修层核心：把一块 BlockSource 包装为「精修后的 BlockSource」。
 *  - 空精修：不设 edgeFinal、不提高度 → 透传原对象，finalRuling/blockAt 落回
 *    默认引擎。
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
// 语义见《地图架构.md》§6：精修层对每个 chunk 产出一份唯一定型产物，
// 下游（顶面网格/墙/地形物理/贴地）一律只读它，零自算。
// 全部 raw 数组、零 three 依赖——主线程与 Worker 同一份代码。
// ============================================================

export interface ChunkFinal {
  /** chunk 边长（米） */
  size: number;
  cx: number;
  cz: number;
  /**
   * ★ 定型角点高度场：每米格四角（c00 c10 c11 c01），布局 (lz*N+lx)*4+k。
   * 已按精修后的视觉面（cornerCell = surfaceHeightCore 硬边界基面 + max-over-edges
   * 边插值）定型——顶面网格与贴地采样的唯一权威，一次算好、处处读同一份。
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
 * 顶面几何产物与视觉面模型【逐位一致】（《地图架构.md》§4.5 不变式
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
      // ★ 视觉面几何后修正：cell 4 顶点各按自身坐标经 cornerCell（块视角）
      //   取高度——块内同一硬边界平面，但 weld 坡带使靠近高侧的角更陡。
      //   撕裂角自持由 cornerCell 块视角语义锁住（Phase D/F）。
      const bxcb = cx * BLOCKS_PER_SIDE + Math.floor(lx / BLOCK_SIZE);
      const bzcb = cz * BLOCKS_PER_SIDE + Math.floor(lz / BLOCK_SIZE);
      const h00 = cornerCell(src, bxcb, bzcb, wx, wz);
      const h10 = cornerCell(src, bxcb, bzcb, wx + 1, wz);
      const h11 = cornerCell(src, bxcb, bzcb, wx + 1, wz + 1);
      const h01 = cornerCell(src, bxcb, bzcb, wx, wz + 1);
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
// 语义见《地图架构.md》§5/§6：断崖墙与「地形物理数据」都由精修层产出一份；
// 实体/装饰碰撞是下游管理器的第二层产出（不进本快照）。
// 与历史 ChunkWalls 网格【逐位一致】——只搬位不搬逻辑（装配成 THREE 仍
// 由 ChunkWalls 薄壳完成）。纯函数、确定性、主线程与 Worker 可共用。
// ============================================================

/** 墙底延伸（防与地面共面闪烁） */
const WALL_EPS = 0.05;

/**
 * ★ 断崖墙生成（2026-08-31 定版：墙与裁决解耦，见《地图架构.md》§5）。
 * 发墙判据 = 相邻两块【块逻辑高】有落差（bCur.h > bNb.h，背墙/撕裂面）
 * 【或】【视觉面高】有落差（curSide > nbSide + WALL_EPS，坡侧裙墙）。
 * 墙与裁决无关：cliff 墙 = 撕裂面本身；weld 墙 = 坡面背后的贴坡背墙 +
 * 坡侧裙墙（低块插值面高于邻块面 → 也发墙，堵住坡侧看穿/露斜草皮）。
 * 斜坡只是附加在墙前低侧块上的额外面，墙永远在，任何视角看不到地形内部。
 * 去重：每条边界只从【视觉面更高】那侧发一次（法线朝低处）。
 * 等高块（drop=0 且无视觉面落差）→ 不发（退化保护）。
 * 墙顶随该边视觉面 = cornerCell（高侧 crest；weld 共享边两侧同值不撕裂）。
 * 墙底 = 两侧面板底之更浅者 − WALL_EPS（堵死不悬空）。
 */

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
  const shd: number[] = [];
  const uvx: number[] = [];
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

        // ★ 防御裙墙：发墙判据 = 视觉面高落差（非块逻辑高）。cliff 墙 = 撕裂面
        //   本身；weld 墙 = 坡面背后贴坡背墙 + 坡侧裙墙（低块插值面高于邻块
        //   面 → 也发墙堵漏，杜绝坡侧看穿/露斜草皮）。斜坡只是附加蒙皮，墙永在。
        // 去重：每条边界只从【视觉面更高】那侧发一次（法线朝低处）。
        const topA = wallTop(
          ctx,
          src,
          bxC,
          bzC,
          ox + i + dir.ax,
          oz + j + dir.az,
        );
        const topB = wallTop(
          ctx,
          src,
          bxC,
          bzC,
          ox + i + dir.bx,
          oz + j + dir.bz,
        );
        const nbTopA = wallTop(
          ctx,
          src,
          bxN,
          bzN,
          ox + i + dir.ax,
          oz + j + dir.az,
        );
        const nbTopB = wallTop(
          ctx,
          src,
          bxN,
          bzN,
          ox + i + dir.bx,
          oz + j + dir.bz,
        );
        const curSide = Math.max(topA, topB);
        const nbSide = Math.max(nbTopA, nbTopB);
        // ★ 发墙：块逻辑高有落差（背墙/撕裂面）【或】视觉面高有落差（坡侧裙墙）
        //   本侧必须更高才发（去重；法线朝低处）。
        const logicalDrop = bCur.h > bNb.h;
        const visualDrop = curSide > nbSide + WALL_EPS;
        if (!logicalDrop && !visualDrop) continue;

        const lowBase = Math.min(
          nbSide,
          baseHeightOf(bCur),
          baseHeightOf(bNb),
        );
        const drop = curSide - lowBase;
        const yB = lowBase - WALL_EPS;

        const td = ctx.tileDefAt(
          ox + i + 0.5 + dir.dx * 0.5,
          oz + j + 0.5 + dir.dz * 0.5,
        );
        const thM = td.isDepression ? SEMANTIC_THEME_MIX : 1;
        const th = applyGroupTintHsl(td.visual.baseHsl, palette, thM);
        let [r, g, b] = hsl2rgb(th.h, th.s, th.l);
        const facing = Math.max(0, dir.dx * SUN_HX + dir.dz * SUN_HZ);
        // wallShade 本身是 0..1 明暗系数（0.14~0.82）；colors 走 0..255 通道
        // 需 /255,shade 直接用原值（⊥ 全黑回归：2026-09-01 WallMaterial 复用）。
        const k0 =
          wallShade(ctx.heightAt, seed, ox + i, oz + j, drop, facing);
        const k = k0 / 255;

        // ★ 墙所属地块 uv：外墙贴"本侧地块"纹理，定位到 uTileIds 该 tile
        //   的 texel 中心（(tileIdx + 0.5)/15，Nearest 采样必命中，不会落在块边界）。
        //   chunk 局部 tile 索引 = 世界块索引 - chunk 块原点（cx*15）。
        const tblX = Math.max(0, Math.min(14, bxC - cx * 15));
        const tblZ = Math.max(0, Math.min(14, bzC - cz * 15));
        const uvU = (tblX + 0.5) / 15;
        const uvV = (tblZ + 0.5) / 15;

        const xA = i + dir.ax - N / 2,
          zA = j + dir.az - N / 2;
        const xB = i + dir.bx - N / 2,
          zB = j + dir.bz - N / 2;

        pos.push(xA, topA, zA, xB, topB, zB, xB, yB, zB, xA, yB, zA);
        for (let c = 0; c < 4; c++) {
          nor.push(dir.dx, 0, dir.dz);
          col.push(r * k, g * k, b * k);
          shd.push(k0);
          uvx.push(uvU, uvV);
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
    shade: new Float32Array(shd),
    uvs: new Float32Array(uvx),
    indices: new Uint32Array(idx),
  };
}

/**
 * 块 (bx,bz) 在 (wx,wz) 的视觉面顶（= cornerCell 块视角）。墙顶随该视觉面取值。
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

/**
 * 墙顶高度读取：缺省取视觉面 crest（blockVisualTop）；当装配方注入 topAt
 * （后处理圆滑后的最终面）时改取其值，使墙顶沿圆角底部下弯（水密闭合）。
 */
function wallTop(
  ctx: WallBuildCtx,
  src: BlockSource,
  bcx: number,
  bcz: number,
  wx: number,
  wz: number,
): number {
  return ctx.topAt ? ctx.topAt(wx, wz) : blockVisualTop(src, bcx, bcz, wx, wz);
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
  colors: Float32Array; // 顶点色 ×3（已乘明暗 + 地块底色；兼容旧 MeshBasicMaterial）
  shade: Float32Array; // 纯烘焙明暗 ×1（0..1；≈上一帧 MeshBasic.color.scalar 的前身，供 WallMaterial 复用 OKLab 纹理）
  uvs: Float32Array; // 地块中心 uv ×2（采样 uTileIds 得所属 tile id，与顶面同约定）
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
  /** 墙顶高度源（世界坐标）。缺省 = 视觉面 crest（blockVisualTop/cornerCell）；
   *  后处理开启时由装配方注入圆滑后的最终面（ppSurfaceHeight），使墙顶贴合
   *  圆角底部、棱处水密（顶面与墙同源下弯，杜绝墙顶从圆角顶部探出）。 */
  topAt?: (x: number, z: number) => number;
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
