// ============================================================
// FaceBuild —— 表驱动的精修层几何构建（阶段 D，定稿）
//   架构权威文档：《地形表驱动管线重构设计.md》（定稿 2026-09-05）
// ============================================================
// 输入 FaceTable + src，直接产出顶面与侧壁几何：
//   · 顶面：coarse 1m（平面 + weld 坡进顶 + bevel 弧带下弯），
//     fine 0.125m 只落在 bevel 弧带与 weld 坡脚/角脊非线性 cell
//     （topFineCells 统一判定：顶面与侧壁共用同一张细分图）
//   · 侧壁：每边恒壁（表 depth = calc+保底）；壁顶沿节点列 = 顶网格
//     边界折线同列（fine cell 段 0.125m / 其余 1m）→ 壁顶与顶面逐段
//     同端点闭合，weld 坡脚/弧带处不再各自近似开口（2026-09-05 修）
// pit/crack 属后处理精细 pass（另行施加，不入本函数）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { type FaceTable, WALL_EPS, WALL_MIN_DEPTH } from "./FaceTable";
import { type BlockSource, surfaceHeightCore, rampWidthOf } from "./Refinements";
import { DEFAULT_PATCH_DECOR, type PatchDecorSpec } from "./PatchDecor";

const N = CHUNK_SIZE; // 60
const BPS = BLOCKS_PER_SIDE; // 15
const HALF = N / 2;
/** 弧带半径（与旧体系一致；精修层形态常量，后续收敛到 RefinementConstants） */
export const BEVEL_R = 0.3;

const DIRS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;

export interface FaceGeometry {
  vertices: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  shade?: Float32Array;
  /** ★ 补丁权重（逐顶点 0..1，= depthOf/PATCH_DEPTH；补丁装饰纹理的驱动通道） */
  patchW?: Float32Array;
  indices: Uint32Array;
  topTriCount: number;
}

// ------------------------------------------------------------
// 补丁覆盖层（§14.10 剔除+打补丁：子弹撞地 → 区域内统一补丁材质）
// ------------------------------------------------------------
// 语义（2026-09-05 用户定调）：
//   1) 区域内每个 1m coarse cell 的顶面按「补丁深度场」逐顶点下挖，**坑缘自带坡面插值**：
//      由补丁边界线（depth=0，与原地面连续）向内 1m smoothstep 坡降 → 坑内满深 PATCH_DEPTH；
//      坡面即坑的侧壁，材质=补丁。
//   2) 坑内隔断壁剔除：两侧都是补丁的壁段整个不生成（坑是一个连贯凹陷，无内部隔墙）。
//   3) 坑缘壁保留且顶沿=原地面（边界线深度 0 → 与坡面起点同高），坑底才落地不悬空；
//      坑缘壁仍用补丁色（坑的侧壁材质依旧属于补丁）。
//   4) 物理=视觉同源（布局不变，外壳保持水密）。
// ★ 顶点色语义 = 乘性染色开关：中性白(1,1,1) → 不变（原 tile 材质）；非中性色
//   （补丁焦土乘数，通道不相等以便 shader 区分）→ albedo/base 乘上该色 → 保留
//   原纹理细节的"烧焦"观感（非替换——替换会丢纹理成贴纸；非 0.16 级深乘——会全黑）。
export const PATCH_DEPTH = 0.2;      // 补丁下挖深度（§13.2 T2 轻量档）
// ★ 补丁染色 = 乘性焦土调（线性空间乘到 albedo 上；白(1,1,1)=原样）。
//   2026-09-05 两轮修正：①原值 [0.16,0.135,0.12] 作为乘数在线性空间把纹理压到近黑
//   （用户：全黑看不到颜色）；②改为"整块替换纯色"又丢了纹理细节（用户：像贴纸）。
//   定案：保留原纹理明暗/颗粒（乘性不破坏相对亮度），乘数取可见的烧焦褐调
//   （≈ 原亮度 55~65% + R>G>B 暖褐偏色），草地/沙地烧完深浅自然不同。
export const PATCH_COLOR: [number, number, number] = [0.62, 0.52, 0.42]; // 乘性焦土调（线性）
/** 补丁颜色层数封顶：颜色 = 焦土色^层数（幂）——每满 1 层深度染色再叠一次，
 *  小数层平滑过渡（坑越深越焦，坑口→坑心渐变）；封顶防无限修补全黑。 */
export const PATCH_COLOR_MAX_LAYERS = 5;
const PATCH_SLOPE_CELLS = 1;   // 坡面宽度（m，一个 coarse cell；坑缘平滑坡降距离）
const WALL_FLUSH_EPS = 0.002;  // 壁两侧表面视为等高的容差（m）。★ 只收浮点噪声级：
                               // 真实地形哪怕 3~5mm 的高台棱也是可见侧壁，剔除会使其消失
                               // （2026-09-05 用户：微小高差地面补丁后侧壁不应消失）。

export interface PatchOverlay {
  /** 1m coarse cell(lx,lz)（chunk 局部）是否处于补丁区 */
  isPatched(lx: number, lz: number): boolean;
  /** 世界坐标补丁深度（逐顶点采样；坑内 = PATCH_DEPTH，坑缘坡降 → 0） */
  depthOf(wx: number, wz: number): number;
  /** 补丁顶点色（线性 rgb；材质替换基准色 = 焦土色） */
  color: [number, number, number];
  /** ★ 装饰性纹理声明（坑洞/裂痕内部"坑坑洼洼"观感；见 PatchDecor.ts） */
  decor: PatchDecorSpec;
}

/**
 * 由补丁标记（1 = 补丁 cell）构造 PatchOverlay。
 * depthOf 为世界函数：坑内满深，深度场 = 到「最近共边未补丁 cell」边界线的距离
 * （四方向射线法，只沿 ±x/±z 共边穿越补丁格；对角只共享角点的未补丁格不泄压，
 * 否则小坑中心永远到不了满深 → 子弹坑不可见）。
 * 距离 < 坡面宽 1m 内 smoothstep 坡降 → 坑口线 = 0，与原地面连续；
 * 跨 chunk 边界视作未补丁 → seam 两侧各自收口 0（封死不悬空）。
 */
export function buildPatchOverlay(
  patched: Uint8Array,
  cx: number,
  cz: number,
  depth: number = PATCH_DEPTH,
  color: readonly [number, number, number] = PATCH_COLOR,
): PatchOverlay {
  const chunkSize = Math.round(Math.sqrt(patched.length));
  const ox = cx * chunkSize, oz = cz * chunkSize;
  const isPatched = (lx: number, lz: number): boolean =>
    lx >= 0 && lz >= 0 && lx < chunkSize && lz < chunkSize && patched[lz * chunkSize + lx] === 1;
  const depthOf = (wx: number, wz: number): number => {
    const px = wx - ox, pz = wz - oz;
    const lx = Math.floor(px), lz = Math.floor(pz);
    if (!isPatched(lx, lz)) return 0;
    // 四方向射线：沿 ±x / ±z 逐个 cell 外走，碰到未补丁/出界的 cell 即为坑口线，
    // 记录点到该 cell 内边界平面的距离（m），取四向最小 → 坑口线 0，向内满深
    let minD = Infinity;
    for (let k = 1; k <= chunkSize; k++) {
      // +x
      if (!isPatched(lx + k, lz)) { minD = Math.min(minD, lx + k - px); break; }
    }
    for (let k = 1; k <= chunkSize; k++) {
      // -x
      if (!isPatched(lx - k, lz)) { minD = Math.min(minD, px - (lx - k + 1)); break; }
    }
    for (let k = 1; k <= chunkSize; k++) {
      // +z
      if (!isPatched(lx, lz + k)) { minD = Math.min(minD, lz + k - pz); break; }
    }
    for (let k = 1; k <= chunkSize; k++) {
      // -z
      if (!isPatched(lx, lz - k)) { minD = Math.min(minD, pz - (lz - k + 1)); break; }
    }
    if (minD === Infinity) return depth; // 整 chunk 全补丁（理论不可达；兜底满深）
    const t = Math.min(minD / PATCH_SLOPE_CELLS, 1); // 0=坑口线 → 1=坑内满深
    const s = t * t * (3 - 2 * t);                   // smoothstep 坡面插值
    return depth * s;
  };
  return { isPatched, depthOf, color: color.slice() as [number, number, number], decor: { ...DEFAULT_PATCH_DECOR } };
}

// ------------------------------------------------------------
// ★ 层数覆盖（§14.11 无限修补）：逐 1m cell 深度计数 + 连续包络场
// ------------------------------------------------------------

/** 每层过渡宽度（m/层；§14.11.2 原型锁定默认 0.5） */
export const PATCH_LEVEL_WIDTH = 0.5;

/**
 * 包络场（原型定稿，chunk 局部）：
 * u(p) = min over 4 卡氏射线 r of min_{k≥0}[ N[j+k] + d_k(p) / W ]
 *   - j = p 所在 cell；k=0 项 = N_p（自身 cell 常数地板，diag 不上射线 → 不泄压）
 *   - d_k = p 到第 k 个 cell 最近边的轴距（+x = k−frac；−x = frac+(k−1)；z 同理）
 *   - 出 chunk 界视作层 0（seam 收口，几何与采样同规则）
 * 返回 u（层数，可为小数）；几何深度 = u × PATCH_DEPTH。
 */
export function envelopeLevelAt(
  levels: Uint8Array,
  chunkSize: number,
  cx: number,
  cz: number,
  x: number,
  z: number,
  W: number = PATCH_LEVEL_WIDTH,
): number {
  const px = x - cx * chunkSize, pz = z - cz * chunkSize;
  const lx = Math.floor(px), lz = Math.floor(pz);
  if (lx < 0 || lz < 0 || lx >= chunkSize || lz >= chunkSize) return 0;
  const fx = px - lx, fz = pz - lz;
  const own = levels[lz * chunkSize + lx];
  if (own === 0) return 0;
  let best = own;
  const edge = { px: chunkSize - px, nx: px, pz: chunkSize - pz, nz: pz };
  const ray = (
    cellIdx: (k: number) => number,   // 返回该方向第 k 个 cell 的线性下标；<0 = 已出界
    dOf: (k: number) => number,       // 到该 cell 最近边轴距（k≥1）
    edgeKey: 'px' | 'nx' | 'pz' | 'nz',
  ): void => {
    let v = best;
    for (let k = 1; ; k++) {
      const c = cellIdx(k);
      if (c < 0) {
        // ★ 出 chunk 界 = 虚拟层 0：到 chunk 边界平面距离收口（seam 语义）
        const cand = edge[edgeKey] / W;
        if (cand < v) v = cand;
        break;
      }
      const d = dOf(k);
      const cand = levels[c] + d / W;
      if (cand < v) { v = cand; if (v <= 0) break; }
      if (d / W >= v) break; // 后续轴距单调增 → 剪枝
    }
    if (v < best) best = v;
  };
  ray((k) => (lx + k < chunkSize ? lz * chunkSize + (lx + k) : -1), (k) => k - fx, 'px');
  ray((k) => (lx - k >= 0 ? lz * chunkSize + (lx - k) : -1), (k) => fx + (k - 1), 'nx');
  ray((k) => (lz + k < chunkSize ? (lz + k) * chunkSize + lx : -1), (k) => k - fz, 'pz');
  ray((k) => (lz - k >= 0 ? (lz - k) * chunkSize + lx : -1), (k) => fz + (k - 1), 'nz');
  return Math.max(0, best);
}

/**
 * 层数掩码 → PatchOverlay（isPatched = 层>0；depthOf = 包络场 u × depth）。
 * 渲染几何/高度采样共用同一函数（§14.11 单一真源）。
 */
export function buildLevelOverlay(
  levels: Uint8Array,
  cx: number,
  cz: number,
  depth: number = PATCH_DEPTH,
  color: readonly [number, number, number] = PATCH_COLOR,
): PatchOverlay {
  const chunkSize = Math.round(Math.sqrt(levels.length));
  const isPatched = (lx: number, lz: number): boolean =>
    lx >= 0 && lz >= 0 && lx < chunkSize && lz < chunkSize && levels[lz * chunkSize + lx] > 0;
  const depthOf = (wx: number, wz: number): number =>
    envelopeLevelAt(levels, chunkSize, cx, cz, wx, wz) * depth;
  return { isPatched, depthOf, color: color.slice() as [number, number, number], decor: { ...DEFAULT_PATCH_DECOR } };
}

// ------------------------------------------------------------
// 顶面高度（视觉面 + bevel 弧带下弯）
// ------------------------------------------------------------

/**
 * 指定视角块下的顶面高度（世界坐标，f64）：
 * base = 精修视觉面（该视角块的 weld 边插值/坡进顶）
 * 叠 bevel 弧带（该视角块的 bevel 棱带内下沉）。
 * ★ 视角块必须显式传入——块边界角点/墙顶线归属哪块就传哪块，
 *   不能用格点 floor 自推（否则取到邻块视角 → 地块边缘不平）。
 */
export function topYView(
  table: FaceTable,
  src: BlockSource,
  viewBx: number,
  viewBz: number,
  x: number,
  z: number,
): number {
  const base = surfaceHeightCore(src, viewBx, viewBz, x, z);
  const ccx = Math.floor(viewBx / BPS);
  const ccz = Math.floor(viewBz / BPS);
  const cell =
    ccx === table.cx && ccz === table.cz
      ? table.cells[(viewBz - ccz * BPS) * BPS + (viewBx - ccx * BPS)]
      : null;
  if (!cell) return base;
  let dMin = Infinity;
  for (let dir = 0; dir < 4; dir++) {
    if (cell.sides[dir as 0 | 1 | 2 | 3].kind !== "bevel") continue;
    let d: number;
    if (dir === 0) d = (viewBx + 1) * 4 - x;
    else if (dir === 1) d = x - viewBx * 4;
    else if (dir === 2) d = (viewBz + 1) * 4 - z;
    else d = z - viewBz * 4;
    if (d < dMin) dMin = d;
  }
  if (dMin >= BEVEL_R) return base;
  return base - (BEVEL_R - Math.sqrt(Math.max(0, 2 * BEVEL_R * dMin - dMin * dMin)));
}

/** 按点所属块视角的顶面高度（查询用；几何构建请用 topYView 显式视角） */
export function topYAt(
  table: FaceTable,
  src: BlockSource,
  x: number,
  z: number,
): number {
  return topYView(table, src, Math.floor(x / 4), Math.floor(z / 4), x, z);
}

// ------------------------------------------------------------
// 顶面网格（coarse 1m + fine 0.125m 拼 bevel 弧 / weld 坡脚角脊；坑/裂已废弃）
// ------------------------------------------------------------
const FINE_D = 3; // 2^3 = 0.125m
const FINE_S = 1 << FINE_D;

/** weld 坡顶面非线性判据：cell 内网格边(1m 直线)与真实坡面的允许偏差（m） */
const WELD_FINE_EPS = 0.03;

/** cell(lx,lz)（视角=所属块）是否落在 bevel 弧带影响区（需 fine） */
function cellBevelFine(table: FaceTable, src: BlockSource, lx: number, lz: number): boolean {
  const ox = table.cx * N, oz = table.cz * N;
  const vbx = table.cx * BPS + Math.floor(lx / 4);
  const vbz = table.cz * BPS + Math.floor(lz / 4);
  const ccx = Math.floor(vbx / BPS), ccz = Math.floor(vbz / BPS);
  if (ccx !== table.cx || ccz !== table.cz) return false;
  const cell = table.cells[(vbz - ccz * BPS) * BPS + (vbx - ccx * BPS)];
  for (let dir = 0; dir < 4; dir++) {
    if (cell.sides[dir as 0 | 1 | 2 | 3].kind !== "bevel") continue;
    // 该 bevel 棱到 cell 的最小距离（垂直方向）
    const wx0 = ox + lx, wz0 = oz + lz;
    let d: number;
    if (dir === 0) d = (vbx + 1) * 4 - wx0 - 1; // 东棱：cell 东边界到棱=0 → 带内
    else if (dir === 1) d = wx0 - vbx * 4;
    else if (dir === 2) d = (vbz + 1) * 4 - wz0 - 1;
    else d = wz0 - vbz * 4;
    // cell 覆盖 [0,1)，棱到 cell 近端/远端距离：带相交判 cell 距棱 < R
    const near = Math.max(0, d); // 简化：cell 起点距棱
    const far = near + 1;
    void far;
    if (near < BEVEL_R && near > -1) return true;
  }
  return false;
}

/**
 * ★ weld 坡面非线性检测（坡脚棱/双坡角脊跨过 cell 内部时，1m 直线网格边会
 *   悬离真实坡面可达 ~1m → 该 cell 必须进 fine 细分）。
 * 判据：cell 内 4 边中点 + 中心的真实顶面高度，与按网格三角形（对角剖分
 * 01-10）线性预测值之差 > WELD_FINE_EPS → 非线性。
 * 只需测「本块视角」；而视角面只被本块自己的 weld 边 ± 坡带宽影响 → 候选
 * = cell 与本块 weld 棱距离 < 坡带宽的格（跨棱 0 起算）。
 */
function cellWeldCurvFine(
  table: FaceTable,
  src: BlockSource,
  lbx: number, // 块局部列 0..14
  lbz: number,
  lx: number,  // chunk 局部米格 0..N
  lz: number,
): boolean {
  const wx0 = table.cx * N + lx, wz0 = table.cz * N + lz;
  const bx = table.cx * BPS + lbx, bz = table.cz * BPS + lbz;
  // cell 近端距棱（东 x=(bx+1)*4、西 x=bx*4、南 z=(bz+1)*4、北 z=bz*4；
  // cell 覆盖 [0,1)，距棱 = 近端与棱的差，< 0 表示跨棱/在棱带内 → 0）
  const nearD = [
    Math.max(0, (bx + 1) * 4 - wx0 - 1),
    Math.max(0, wx0 - bx * 4),
    Math.max(0, (bz + 1) * 4 - wz0 - 1),
    Math.max(0, wz0 - bz * 4),
  ];
  let hit = false;
  for (let dir = 0; dir < 4; dir++) {
    const s = table.cells[lbz * BPS + lbx].sides[dir as 0 | 1 | 2 | 3];
    if (s.kind !== "weld") continue;
    // weld 棱伸入 cell：cell 任一部分落在坡带（近端 < 坡带宽）
    if (nearD[dir] < rampWidthOf(src, bx, bz, dir as 0 | 1 | 2 | 3)) hit = true;
  }
  if (!hit) return false;
  // 顶面 4 角 + 4 边中点 + 中心（网格剖分线性预测对照；视角 = 本块）
  const y00 = topYView(table, src, bx, bz, wx0, wz0);
  const y10 = topYView(table, src, bx, bz, wx0 + 1, wz0);
  const y11 = topYView(table, src, bx, bz, wx0 + 1, wz0 + 1);
  const y01 = topYView(table, src, bx, bz, wx0, wz0 + 1);
  const dev = (p: number, e: number) => Math.abs(p - e) > WELD_FINE_EPS;
  // 中心与 4 边中点各对照所属网格边（对角剖分 01-10，同 buildTopGeometry 绕序）
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 0.5), (y01 + y10) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0), (y00 + y10) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 1), (y01 + y11) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0, wz0 + 0.5), (y00 + y01) / 2)) return true;
  if (dev(topYView(table, src, bx, bz, wx0 + 1, wz0 + 0.5), (y10 + y11) / 2)) return true;
  return false;
}

/**
 * ★ 顶面 fine 细分图（N×N，1 = 该 1m cell 用 0.125m 子网格）：
 *   bevel 弧带 cell ∪ weld 非线性 cell（坡脚/角脊），外扩 1 格保水密
 *   （coarse/fine 之间不出现共享边 = 无 T 结）。
 *   顶面与侧壁共用同一张图 → 壁顶沿按同一节点列采样，闭合一致。
 */
const fineCache = new WeakMap<FaceTable, Uint8Array>();

export function topFineCells(table: FaceTable, src: BlockSource): Uint8Array {
  const cached = fineCache.get(table);
  if (cached) return cached;
  if (cached) return cached;
  const weldFine = new Uint8Array(N * N);
  const bevelFine = new Uint8Array(N * N);
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      // 该块是否有 weld 边（无则其视角面恒平面，跳过曲率检测）
      let weld = false;
      for (let dir = 0; dir < 4; dir++) {
        if (table.cells[lbz * BPS + lbx].sides[dir as 0 | 1 | 2 | 3].kind === "weld") { weld = true; break; }
      }
      const b0x = lbx * 4, b0z = lbz * 4;
      for (let jz = 0; jz < 4; jz++) {
        for (let jx = 0; jx < 4; jx++) {
          const lx = b0x + jx, lz = b0z + jz;
          // ★ bevel：弧带圆角边界可能在 cell 边 → 外扩 1 格保水密（历史方案）
          if (cellBevelFine(table, src, lx, lz)) { bevelFine[lz * N + lx] = 1; continue; }
          // ★ weld：坡脚/角脊（含双坡交汇）跨过 cell 内部/边界 → 非线性 cell
          if (weld && cellWeldCurvFine(table, src, lbx, lbz, lx, lz)) { weldFine[lz * N + lx] = 1; }
        }
      }
    }
  }
  // bevel 外扩 1 格（coarse/fine 边界隔一格，无 T 结）——必须写独立数组，
  // 否则原地扩散会级联传染整片区域
  const bevelOut = new Uint8Array(N * N);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!bevelFine[lz * N + lx]) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx2 = lx + dx, nz2 = lz + dz;
          if (nx2 >= 0 && nz2 >= 0 && nx2 < N && nz2 < N) bevelOut[nz2 * N + nx2] = 1;
        }
      }
    }
  }
  // ★ 逐边扩张（代替整格外扩）：fine/coarse 共享边若在 fine 节点处偏离
  //   直线 > SLIT_EPS → 该 coarse cell 并入 fine（角脊弯曲贴近共享边端点的
  //   漏判区正是细缝源）。迭代至稳定；块边界/chunk 边界的边由墙封，跳过。
  //   并入 cell 的新边可能又弯曲 → 下一轮再查；弯曲集群有限，轮数小。
  const wFine = weldOut(table, src, weldFine);
  const out = new Uint8Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = wFine[i] | bevelOut[i];
  fineCache.set(table, out);
  return out;
}

/**
 * 补丁感知的 fine 掩码：基座 fine（bevel+weld 集群）∪ 补丁 cell ∪ 补丁外扩 1 圈。
 * ★ 防 T 结细缝（2026-09-05 用户实测：补丁坡面内部 & 与原面交界出现缝隙）：
 * 补丁深度场给原本平坦的 coarse 区引入 smoothstep 曲率——若补丁 cell 保持 coarse
 * （1m 单 quad 拉直线弦），与相邻 fine 格共享的边在曲率区会弦≠曲线 → 楔形开口；
 * 同理坑口外第一圈未补丁 cell 若为 coarse，其弦线与补丁 fine 沿（可能微弯的）边界线
 * 不符 → 交界开口。把「补丁 cell + 外扩 1 圈」全部并入 fine 后，坑内坡面与坑口交界
 * 全细分、粗细分界只落在深度/表面恒直的边上 → 弦与曲线重合，无缝隙。
 */
function topFineCellsFor(table: FaceTable, src: BlockSource, patch?: PatchOverlay): Uint8Array {
  const base = topFineCells(table, src);
  if (!patch) return base;
  const out = new Uint8Array(base);
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!patch.isPatched(lx, lz)) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx2 = lx + dx, nz2 = lz + dz;
          if (nx2 >= 0 && nz2 >= 0 && nx2 < N && nz2 < N) out[nz2 * N + nx2] = 1;
        }
      }
    }
  }
  return out;
}

/** 混合边偏离直线阈值（m）：低于此的折线/弦差不可见 */
const SLIT_EPS = 0.004;

/** weld fine 集 → 逐边扩张至无弯曲混合边 */
function weldOut(
  table: FaceTable,
  src: BlockSource,
  seed: Uint8Array,
): Uint8Array {
  const f = seed.slice();
  const N2 = N;
  const at = (lx: number, lz: number) =>
    lx >= 0 && lz >= 0 && lx < N2 && lz < N2 && f[lz * N2 + lx] === 1;
  // 视角块 = 共享边两侧 cell 的公共块（仅块内边才有公共块）
  const sameViewEdgeFine = (lx: number, lz: number, dir: number): boolean => {
    // dir 0/1 = 东/西邻（竖边），2/3 = 南/北邻（横边）
    if (dir === 0) return (lx + 1) % 4 !== 0 && at(lx + 1, lz);
    if (dir === 1) return lx % 4 !== 0 && at(lx - 1, lz);
    if (dir === 2) return (lz + 1) % 4 !== 0 && at(lx, lz + 1);
    return lz % 4 !== 0 && at(lx, lz - 1);
  };
  const edgeDeviation = (lx: number, lz: number, dir: number): number => {
    // 本 cell(coarse) 视角；共享边两 cell 同块 → 同视角
    const vbx = table.cx * BPS + Math.floor(lx / 4);
    const vbz = table.cz * BPS + Math.floor(lz / 4);
    const wx0 = table.cx * N2 + lx, wz0 = table.cz * N2 + lz;
    let ax: number, az: number, bx2: number, bz2: number;
    if (dir === 0) { ax = wx0 + 1; az = wz0; bx2 = wx0 + 1; bz2 = wz0 + 1; }
    else if (dir === 1) { ax = wx0; az = wz0; bx2 = wx0; bz2 = wz0 + 1; }
    else if (dir === 2) { ax = wx0; az = wz0 + 1; bx2 = wx0 + 1; bz2 = wz0 + 1; }
    else { ax = wx0; az = wz0; bx2 = wx0 + 1; bz2 = wz0; }
    const yA = topYView(table, src, vbx, vbz, ax, az);
    const yB = topYView(table, src, vbx, vbz, bx2, bz2);
    let worst = 0;
    for (let k = 1; k < FINE_S; k++) {
      const t = k / FINE_S;
      const yE = topYView(table, src, vbx, vbz,
        ax + (bx2 - ax) * t, az + (bz2 - az) * t);
      worst = Math.max(worst, Math.abs(yE - (yA + (yB - yA) * t)));
    }
    return worst;
  };
  for (let iter = 0; iter < 16; iter++) {
    let changed = false;
    for (let lz = 0; lz < N2; lz++) {
      for (let lx = 0; lx < N2; lx++) {
        if (at(lx, lz)) continue;
        for (let dir = 0; dir < 4; dir++) {
          if (!sameViewEdgeFine(lx, lz, dir)) continue;
          if (edgeDeviation(lx, lz, dir) > SLIT_EPS) {
            f[lz * N2 + lx] = 1;
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
  return f;
}

/**
 * ★ 侧壁沿边节点列取用的本块侧 fine 标记：dir 边沿 4 个 1m span，
 * 每个 span 对应一块本块侧 1m cell（该 cell 的边界段 = 顶网格边界折线段）。
 * dir0(+x)/dir1(-x) 沿 z → 本块侧 cell 列固定（lbx*4+3 / lbx*4），行随 span；
 * dir2(+z)/dir3(-z) 沿 x → 行固定（lbz*4+3 / lbz*4），列随 span。
 */
function dirEdgeCells(dir: number, lbx: number, lbz: number, fineE: Uint8Array): Uint8Array {
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

export function buildTopGeometry(
  table: FaceTable,
  src: BlockSource,
  patch?: PatchOverlay,
): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const pw: number[] = [];   // ★ 补丁权重（装饰纹理驱动通道）
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  const W = [1, 1, 1];
  let vi = 0;

  // ① fine 标记（bevel 带 + weld 坡脚/角脊 cell + 补丁 cell；已外扩/并入防 T 结细缝）
  const fineE = topFineCellsFor(table, src, patch);

  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = ox + lx, wz0 = oz + lz;
      const vbx = table.cx * BPS + Math.floor(lx / 4);
      const vbz = table.cz * BPS + Math.floor(lz / 4);
      const x0 = lx - HALF, z0 = lz - HALF;
      const base = vi;
      if (!fineE[lz * N + lx]) {
        // ★ 补丁 coarse cell：四角按深度场逐顶点下挖（坑缘坡降 0→depth）+ 补丁顶点色
        //   补丁色权重 = 深度场归一（0=坑口/坑外正常材质 → 1=坑内满深焦土）：
        //   颜色渐变与几何坡降同源同位（都是 depthOf），交界处"先变色后下凹"的
        //   硬色边消失（2026-09-05 用户：补丁与地面材质交界渲染不好看）。
        const pcell = patch && patch.isPatched(lx, lz);
        const cc = pcell ? patch!.color : W;
        const tint = (d: number): [number, number, number] => {
          const u = Math.min(d / PATCH_DEPTH, PATCH_COLOR_MAX_LAYERS);
          return [Math.pow(cc[0], u), Math.pow(cc[1], u), Math.pow(cc[2], u)];
        };
        const d00 = patch ? patch.depthOf(wx0, wz0) : 0;
        const d10 = patch ? patch.depthOf(wx0 + 1, wz0) : 0;
        const d11 = patch ? patch.depthOf(wx0 + 1, wz0 + 1) : 0;
        const d01 = patch ? patch.depthOf(wx0, wz0 + 1) : 0;
        const h00 = topYView(table, src, vbx, vbz, wx0, wz0) - d00;
        const h10 = topYView(table, src, vbx, vbz, wx0 + 1, wz0) - d10;
        const h11 = topYView(table, src, vbx, vbz, wx0 + 1, wz0 + 1) - d11;
        const h01 = topYView(table, src, vbx, vbz, wx0, wz0 + 1) - d01;
        pos.push(x0, h00, z0, x0 + 1, h10, z0, x0 + 1, h11, z0 + 1, x0, h01, z0 + 1);
        const c00 = tint(d00), c10 = tint(d10), c11 = tint(d11), c01 = tint(d01);
        nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        col.push(c00[0], c00[1], c00[2], c10[0], c10[1], c10[2], c11[0], c11[1], c11[2], c01[0], c01[1], c01[2]);
        pw.push(Math.min(1, d00 / PATCH_DEPTH), Math.min(1, d10 / PATCH_DEPTH),
          Math.min(1, d11 / PATCH_DEPTH), Math.min(1, d01 / PATCH_DEPTH));
        uv.push(lx / N, lz / N, (lx + 1) / N, lz / N, (lx + 1) / N, (lz + 1) / N, lx / N, (lz + 1) / N);
        idx.push(vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1);
        vi += 4;
      } else {
        // ★ 补丁 fine cell：逐顶点深度场下挖 + 补丁色（细分不变 → 无 T 结）
        const pcell = patch && patch.isPatched(lx, lz);
        const cc = pcell ? patch!.color : W;
        // fine：0.125m 网格，顶点 y = topYView − depthOf，法线用中差
        const G = FINE_S + 1; // 9
        const yt = new Float64Array(G * G);
        const dv = new Float64Array(G * G); // 深度场（补丁色权重同源）
        for (let gy = 0; gy < G; gy++) {
          for (let gx = 0; gx < G; gx++) {
            const wx = wx0 + gx / FINE_S;
            const wz = wz0 + gy / FINE_S;
            const dV = patch ? patch.depthOf(wx, wz) : 0;
            dv[gy * G + gx] = dV;
            yt[gy * G + gx] = topYView(table, src, vbx, vbz, wx, wz) - dV;
            const lxx = wx - ox - HALF;
            const lzz = wz - oz - HALF;
            pos.push(lxx, yt[gy * G + gx], lzz);
            uv.push((wx - ox) / N, (wz - oz) / N);
            const u = Math.min(dV / PATCH_DEPTH, PATCH_COLOR_MAX_LAYERS);
            col.push(Math.pow(cc[0], u), Math.pow(cc[1], u), Math.pow(cc[2], u));
            pw.push(Math.min(1, dV / PATCH_DEPTH));
          }
        }
        // 顶点先占位法线，后差分
        for (let c = 0; c < G * G; c++) nor.push(0, 0, 0);
        const step = 1 / FINE_S;
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
            const io = (base + gy * G + gx) * 3;
            nor[io] = nx2 * il;
            nor[io + 1] = ny * il;
            nor[io + 2] = nz2 * il;
          }
        }
        for (let jz = 0; jz < FINE_S; jz++) {
          for (let jx = 0; jx < FINE_S; jx++) {
            const v00 = base + jz * G + jx;
            const v10 = v00 + 1;
            const v01 = v00 + G;
            const v11 = v01 + 1;
            idx.push(v00, v01, v10, v01, v11, v10);
          }
        }
        vi += G * G;
      }
    }
  }
  return {
    vertices: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    patchW: new Float32Array(pw),
    indices: new Uint32Array(idx),
    topTriCount: idx.length / 3,
  };
}

// ------------------------------------------------------------
// 侧壁（每边恒壁：顶沿采样贴顶面，深度 = 表 calc+保底）
// ------------------------------------------------------------

export function buildWallGeometry(
  table: FaceTable,
  src: BlockSource,
  patch?: PatchOverlay,
): FaceGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const shd: number[] = [];
  const pw: number[] = [];   // ★ 补丁权重（坑壁满强度碎屑装饰）
  const idx: number[] = [];
  const ox = table.cx * N, oz = table.cz * N;
  const fineE = topFineCellsFor(table, src, patch);
  let vi = 0;

  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      const bx = table.cx * BPS + lbx;
      const bz = table.cz * BPS + lbz;
      // 该块局部 tile 中心 uv（默认侧壁材质 = 本块 tile）
      const uU = (lbx + 0.5) / 15;
      const uV = (lbz + 0.5) / 15;
      for (let dir = 0; dir < 4; dir++) {
        const nbx = bx + DIRS[dir].dx;
        const nbz = bz + DIRS[dir].dz;
        // ★ 沿边节点列：按本块侧 4 个 1m cell 的 fine 标记定 0.125m/1m 步长。
        //   顶网格边界折线在 fine cell 上是 0.125m 折线、coarse cell 上是
        //   1m 直线 —— 壁顶沿取同一节点列 → 每段与顶网格边界段同端点，
        //   weld 坡脚/弧带处不再各自近似（否则壁顶低于网格边 = 开口）。
        const rowCells = dirEdgeCells(dir, lbx, lbz, fineE);
        const nodes: number[] = [];
        for (let span = 0; span < 4; span++) {
          const sub = rowCells[span] ? FINE_S : 1;
          for (let k = 0; k < sub; k++) nodes.push(span + k / sub);
        }
        nodes.push(4);
        const x0 = bx * 4, z0 = bz * 4;
        let ax: number, az: number, bx2: number, bz2: number;
        if (dir === 0) { ax = x0 + 4; az = z0; bx2 = x0 + 4; bz2 = z0 + 4; }
        else if (dir === 1) { ax = x0; az = z0; bx2 = x0; bz2 = z0 + 4; }
        else if (dir === 2) { ax = x0; az = z0 + 4; bx2 = x0 + 4; bz2 = z0 + 4; }
        else { ax = x0; az = z0; bx2 = x0 + 4; bz2 = z0; }
        const nrm = DIRS[dir];
        // ★ 补丁感知：本边每段(span)两侧 coarse cell 的状态（§14.10）。
        //   坑缘壁顶沿 = 原地面（边界线 depth 0，与坡面起点同高 → 坑底落地不悬空）；
        //   两侧都补丁 → 坑内隔断壁整段剔除（坑是一个连贯凹陷，无内部隔墙）；
        //   某一侧补丁 → 该壁换补丁色（坑的侧壁材质 = 补丁）。
        const P = patch;
        const spanCellsOf = (j: number): { own: { lx: number; lz: number }; nb: { lx: number; lz: number } } => {
          let own: { lx: number; lz: number }, nb: { lx: number; lz: number };
          if (dir === 0) { own = { lx: lbx * 4 + 3, lz: lbz * 4 + j }; nb = { lx: lbx * 4 + 4, lz: lbz * 4 + j }; }
          else if (dir === 1) { own = { lx: lbx * 4, lz: lbz * 4 + j }; nb = { lx: lbx * 4 - 1, lz: lbz * 4 + j }; }
          else if (dir === 2) { own = { lx: lbx * 4 + j, lz: lbz * 4 + 3 }; nb = { lx: lbx * 4 + j, lz: lbz * 4 + 4 }; }
          else { own = { lx: lbx * 4 + j, lz: lbz * 4 }; nb = { lx: lbx * 4 + j, lz: lbz * 4 - 1 }; }
          return { own, nb };
        };
        const patchedOwn = (s: number): boolean => {
          if (!P) return false;
          const { own } = spanCellsOf(Math.min(3, Math.floor(s)));
          return own.lx >= 0 && own.lz >= 0 && own.lx < N && own.lz < N && P.isPatched(own.lx, own.lz);
        };
        const patchedNb = (s: number): boolean => {
          if (!P) return false;
          const { nb } = spanCellsOf(Math.min(3, Math.floor(s)));
          // 跨 chunk 的邻 cell 状态未知 → 视为未补丁（另一 chunk 自带状态）
          return nb.lx < 0 || nb.lz < 0 || nb.lx >= N || nb.lz >= N ? false : P.isPatched(nb.lx, nb.lz);
        };
        // 低侧基底（旧裙墙语义 lowBase = min(邻视觉顶, 两侧 hBase)）
        const nbH0 = src.blockAt(nbx, nbz)?.h ?? 0;
        const nbBase0 = src.blockAt(nbx, nbz)?.hBase ?? nbH0;
        const m = nodes.length;
        const topV = new Array<number>(m);
        const lowV = new Array<number>(m);
        const lxV = new Array<number>(m);
        const lzV = new Array<number>(m);
        // ★ 壁线深度比（depthOf/PATCH_DEPTH，封顶 MAX_LAYERS）：补丁墙顶沿的
        //   材质染色指数与装饰权重取值（2026-09-05 用户：侧壁材质渲染要过渡）——
        //   坑缘线=0（与坑外原地面同白无缝）、坑内台阶线=邻顶面同值（交界无缝）；
        //   底沿恒满染。GPU 逐像素插值 → 墙面焦土染色/碎屑噪点沿高度渐入。
        const wallU = new Array<number>(m);
        for (let i = 0; i < m; i++) {
          const s = nodes[i];
          const gx = ax + (bx2 - ax) * (s / 4);
          const gz = az + (bz2 - az) * (s / 4);
          // 墙顶沿采样：视角 = 本墙所属块（bx,bz）——weld 边在坡顶棱 crest；
          //   ★ 顶 = 原顶面 − 深度场（世界函数：坑缘壁线处=0 → 顶沿=原地面不悬空；
          //   坑内保留的台阶壁两侧同减 → 台阶差保持，轮廓完整不空洞）
          const top = topYView(table, src, bx, bz, gx, gz)
            - (P ? P.depthOf(gx, gz) : 0);
          // 邻视角（节点 + 下一节点 max，供本段底沿用）
          const nx2 = i < m - 1 ? nodes[i + 1] : s;
          const ngx2 = ax + (bx2 - ax) * (nx2 / 4), ngz2 = az + (bz2 - az) * (nx2 / 4);
          // ★ 底沿参照 = 深度场修正后的最终面：邻侧若是补丁坑内，原面已被压低 depth，
          //   若仍用原面定底，"埋入地下防破面"的预防性保底长度（WALL_EPS+WALL_MIN_DEPTH）
          //   会相对新坑底被吃掉 → 坑底接缝可能露线/渗光（2026-09-05 用户：补丁侧壁
          //   也要留预防性侧壁长度）。两节点同减 depthOf（世界函数；坑外=0 不变）。
          const nbTop = Math.max(
            surfaceHeightCore(src, nbx, nbz, gx, gz) - (P ? P.depthOf(gx, gz) : 0),
            surfaceHeightCore(src, nbx, nbz, ngx2, ngz2) - (P ? P.depthOf(ngx2, ngz2) : 0),
          );
          topV[i] = top;
          lowV[i] = Math.min(nbTop, cell.hBase, nbBase0);
          lxV[i] = gx - ox - HALF;
          lzV[i] = gz - oz - HALF;
          wallU[i] = P ? Math.min(P.depthOf(gx, gz) / PATCH_DEPTH, PATCH_COLOR_MAX_LAYERS) : 0;
        }
        // ★ 坑内隔断壁剔除：两侧都补丁 **且两侧表面在壁线处几乎等高（flush，埋在土里
        //   看不见的平隔断）** 才剔除 → 连贯凹陷；若两侧存在台阶（可见崖壁/墙），壁段
        //   必须保留并补丁化（顶沿随深度场下移），否则抽掉崖壁 = 打出空洞（void）。
        for (let i = 0; i < m - 1; i++) {
          // 段起点/终点的世界坐标（flush 判定用）
            const sa = nodes[i], sb = nodes[i + 1];
            const gxa = ax + (bx2 - ax) * (sa / 4), gza = az + (bz2 - az) * (sa / 4);
            const gxb = ax + (bx2 - ax) * (sb / 4), gzb = az + (bz2 - az) * (sb / 4);
            if (P && patchedOwn(sa) && patchedNb(sa)) {
              const fa = Math.abs(
                topYView(table, src, bx, bz, gxa, gza) - topYView(table, src, nbx, nbz, gxa, gza),
              );
              const fb = Math.abs(
                topYView(table, src, bx, bz, gxb, gzb) - topYView(table, src, nbx, nbz, gxb, gzb),
              );
              if (fa < WALL_FLUSH_EPS && fb < WALL_FLUSH_EPS) continue; // flush 平隔断 → 剔除
              // 否则保留（台阶壁；顶沿已随深度场下移，轮廓完整）
            }
            // ★ 底 = 低侧基底 − EPS − 保底（埋入地下防破面）；
            //   weld 边全高：顶在坡顶棱 crest，底到低侧基底 → 坡面侧壁完整贴坡
            const botA = Math.min(topV[i], lowV[i] - WALL_EPS - WALL_MIN_DEPTH);
            const botB = Math.min(topV[i + 1], lowV[i + 1] - WALL_EPS - WALL_MIN_DEPTH);
            pos.push(lxV[i], topV[i], lzV[i], lxV[i + 1], topV[i + 1], lzV[i + 1],
              lxV[i + 1], botB, lzV[i + 1], lxV[i], botA, lzV[i]);
            const ownP2 = patchedOwn(sa);
            const nbP2 = patchedNb(sa);
            const pc = P && (ownP2 || nbP2) ? P.color : null;
            for (let c = 0; c < 4; c++) {
              nor.push(nrm.dx, 0, nrm.dz);
              uv.push(uU, uV);
              shd.push(1);
            }
            if (pc) {
              // ★ 补丁墙材质/装饰权重沿高度渐变（2026-09-05 用户：坑底已有过渡，
              //   侧壁没有——墙面原为恒定满染，与坑外原地面交界处硬跳）。顶沿取
              //   壁线深度比（wallU：坑缘线=0 同白、台阶线=邻面同值 → 无缝），
              //   底沿满染（埋地不可见）。顶点序 = 0顶A / 1顶B / 2底B / 3底A。
              const uA = wallU[i], uB = wallU[i + 1];
              col.push(Math.pow(pc[0], uA), Math.pow(pc[1], uA), Math.pow(pc[2], uA));
              col.push(Math.pow(pc[0], uB), Math.pow(pc[1], uB), Math.pow(pc[2], uB));
              col.push(pc[0], pc[1], pc[2], pc[0], pc[1], pc[2]);
              pw.push(Math.min(1, uA), Math.min(1, uB), 1, 1);
            } else {
              // 中性白：顶点色=材质替换开关（不染色不装饰）
              col.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
              pw.push(0, 0, 0, 0);
            }
            // ★ 绕序朝外（正面可见）：dir1/-x 与 dir2/+z 的墙法线因采样方向
            //   朝内，翻转索引；dir0/dir3 保持（2026-09-04 修正）
            if (dir === 1 || dir === 2) {
              idx.push(vi, vi + 3, vi + 2, vi, vi + 2, vi + 1);
            } else {
              idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
            }
            vi += 4;
          }
      }
    }
  }
  return {
    vertices: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    shade: new Float32Array(shd),
    patchW: new Float32Array(pw),
    indices: new Uint32Array(idx),
    topTriCount: 0,
  };
}

// ------------------------------------------------------------
// ★ 补丁圆覆盖判定（§14.10 剔除+打补丁；纯函数，可测）
// ------------------------------------------------------------

/**
 * 水平圆覆盖的 coarse cell 标记（AABB 中心最近点法判交）。
 * 返回每个 1m cell 的 chunk 坐标 (cx,cz) 与块内下标 (lx,lz)；
 * 越界 cell（块的整数除法边界之外）自动丢弃。
 */
export function circleCells(
  px: number,
  pz: number,
  r: number,
  chunkSize: number,
): { cx: number; cz: number; lx: number; lz: number }[] {
  const out: { cx: number; cz: number; lx: number; lz: number }[] = [];
  const l0x = Math.floor(px - r), l1x = Math.floor(px + r);
  const l0z = Math.floor(pz - r), l1z = Math.floor(pz + r);
  for (let wx = l0x; wx <= l1x; wx++) {
    for (let wz = l0z; wz <= l1z; wz++) {
      // cell AABB [wx,wx+1]×[wz,wz+1] 与水平圆（中心最近点法）
      const cox = Math.max(wx, Math.min(px, wx + 1));
      const coz = Math.max(wz, Math.min(pz, wz + 1));
      if ((cox - px) * (cox - px) + (coz - pz) * (coz - pz) > r * r) continue;
      const ccx = Math.floor(wx / chunkSize);
      const cra = Math.floor(wz / chunkSize);
      const lx = wx - ccx * chunkSize;
      const lz = wz - cra * chunkSize;
      if (lx < 0 || lx >= chunkSize || lz < 0 || lz >= chunkSize) continue;
      out.push({ cx: ccx, cz: cra, lx, lz });
    }
  }
  return out;
}
