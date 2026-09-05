// ============================================================
// Refinements —— 地形高度场与裁决基源（表驱动管线消费它；定稿 2026-09-05）
//   权威架构文档：《地形表驱动管线重构设计.md》（定稿 2026-09-05）
// ============================================================
// ★ 本文件在表驱动管线中的角色 = 唯一高度场/裁决基源：
//   FaceTable（kind 判定/Pass2 顶高）与 FaceBuild（顶面/壁顶沿采样）都经
//   surfaceHeightCore/cornerCell/finalRuling/interpEdge 读本层输出；
//   旧《地图架构.md》描述的「定型快照 + 墙缓冲」几何链（buildChunkFinal /
//   buildChunkWallBuffers / mergeTerrainPhysics）已被表驱动取代，仅残留在
//   __PP_TABLE_BUILD=false 回退路径（退役拆分见架构文档 §7.3/§12）。
//
// ★ 保留的核心语义（原《地图架构.md》收敛而来，规则不变）：
//   1) 边裁决：块边界「硬过渡(cliff) vs 插值(weld)」判定执行权由本层全权执掌：
//      - 【插值 = 显式 opt-in】（2026-08-31 定版）：默认引擎恒 hard（cliff），
//        凡未显式 smooth 的边一律立墙；weld 只发生在 BlockSource.edgeFinal
//        显式钉死或 TileDef.edgePolicy:'smooth' 启用的边上。
//      - 消费者一律走 finalRuling/edgeOf，只读本层输出（第五铁律）。
//   2) 视觉面几何：角点高度 cornerCell、边插值 interpEdge、斜坡剖面
//      rampProfile、贴地采样 sampleSurface、面板底 baseHeightOf 的语义公式
//      全部并入本文件（2026-08-30 SurfaceRules 物理并入）。角无独立插值，
//      由两条触及 weld 边在 t=0 的 crest 汇合（表驱动文档 §6.1）。
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
import { APRON_ANCHOR_P, apronAnchorRoll } from "./decor/ApronAnchor";

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
 *   - ★ 石围裙保护（用户 2026-09-05：围裙四条边不要有坡面）：围裙相关块
 *     （沙土高台锚点 / 其东·南潜在被并块）的周界边一律跳过产坡骰，保持
 *     cliff——石环压边只能落在垂直坎上。判定与装饰期共享（decor/ApronAnchor，
 *     世界块坐标+种子绑定）→ 主线程/Worker、相邻 chunk 恒同判，
 *     finalRuling 对称性不破坏。保守扩大：潜在被并块即使最终未配对也压坡，
 *     无副作用。
 *   - 概率：对【无向】共享边做确定性 hash(seed, A, B) → 30% 掷点，命中 → weld。
 *   - 对称：对同一条共享边，本块与邻块各自补各自方向的 override（同一 hash
 *     保证两侧同判）+ 一个 weld 方向只在本 chunk 的构建 src 里生效 →
 *     finalRuling 天然对称（唯一判点不变式不破坏）。
 *   - 确定性：hash 只依赖 seed 与两块的(世界块坐标)，主线程/Worker 快照同源。
 */

/**
 * 该块是否围裙锚点（platform_sand + 共享掷点命中）。
 */
function isApronAnchorBlock(
  src: BlockSource,
  wbx: number,
  wbz: number,
  seed: number,
): boolean {
  const b = src.blockAt(wbx, wbz);
  if (!b || tileById(b.id).key !== "platform_sand") return false;
  return apronAnchorRoll(wbx, wbz, seed) < APRON_ANCHOR_P;
}

/**
 * 该块是否「围裙相关」（周界边必须保持 cliff）：
 * 自身是锚点，或自身是 platform_sand 且西/北邻是锚点（锚点并块只向东/南）。
 */
function apronGuarded(
  src: BlockSource,
  wbx: number,
  wbz: number,
  seed: number,
): boolean {
  const b = src.blockAt(wbx, wbz);
  if (!b || tileById(b.id).key !== "platform_sand") return false;
  if (isApronAnchorBlock(src, wbx, wbz, seed)) return true;
  return (
    isApronAnchorBlock(src, wbx - 1, wbz, seed) ||
    isApronAnchorBlock(src, wbx, wbz - 1, seed)
  );
}

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
        // ★ 石围裙保护：围裙相关块（锚点/潜在被并块）的边保持 cliff
        if (
          apronGuarded(src, bx, bz, seed) ||
          apronGuarded(src, bx + dx, bz + dz, seed)
        )
          continue;
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
// ★ 旧渲染管线（定型快照/墙缓冲/地形物理合并）已于 2026-09-05 整段移除：
//   buildChunkFinal / buildChunkWallBuffers / mergeTerrainPhysics 及 ChunkFinal /
//   ChunkWallBuffers —— 下游 ChunkSurface/ChunkWalls/PostProcess/BlockFaceIndex
//   已删，标准 chunk 只走表驱动（ChunkManager.finishStandardChunkTable）。
//   保留本文件核心：makeChunkSource / refineChunkSource / edgeRuling /
//   finalRuling / surfaceHeightCore / cornerCell（高度采样与烘焙仍消费）。
// ============================================================
