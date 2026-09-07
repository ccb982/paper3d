// ============================================================
// WaterSurface —— 水体管线：静止基面几何（共享纯函数，Worker/主线程同源）
// ============================================================
// 语义（《水体管线架构.md》§2.1/§3.1；2026-09-07 挖掘联动）：
//   · 水位默认世界 y=0（用户定调）。地形成形后读一次 FaceTable：
//       水 mask = cell.topTileId === TILE_WATER.id
//       水深   = 0 − 地形顶高（cell.h，负）
//       坑水交界 = 水 cell 邻 pit → 沿共享边下落水帘（唇沿=本池水位，帘底=挖后坑床）
//   · ★ 挖掘联动（patch 传入时）【增量连通分量 + 边界探针系统】：
//       ◆ 每个水体 = 一个连通分量（4m 块 4 邻域），状态随 dig 持续维护（不整块重解）：
//         - 每块连通分量持有「边界探针」：分量内每个水块的 4 条边各一支探针，
//           随分量拆池/干块动态创建、销毁（探针激活 ⟷ 其水块在分量内）。
//         - 探针分两型：
//           · 横向探针（水面扩张/水位约束）：探向邻【陆地】块，整面 5cm×5cm
//             点阵（80×80，逐块缓存；点距 <10cm 硬要求）取「挖后地面最低点」
//             = 唇位 → 分量水位 = min(各横向探针唇)；邻块被挖得更深 → 唇降 → 水面扩张下沉
//           · 竖向探针（触底/不悬空）：探向邻【坑】块，取「整条 4m 边切线 × 贴边
//             1m 进深带」5cm 点阵最低点 = 幕帘脚真接地；深挖 → 帘脚随坑床下降
//         - dig 事件 → 只对脏块邻近的探针重采样（网格缓存逐块失效）、只对受影响
//           分量重安定（拆池/干块级联）；其余探针/分量原样复用。
//       ◆ 缺口兜底 vs 非脏路径：状态含 levels 哈希 —— 外部以无 dirty 调本函数 =
//         强制全量重解（探针/测试同此语义）；哈希漂移（清库后重挖）也自动全量。
//       ◆ 平面向下的柱深仍逐 1m cell 3×3 采样（发射阶段，不改探针状态）。
//     no-patch 路径 = 全块默认水位 0 基线（回归锁定同公式；不建状态）。
//   · 几何随地形 chunk 一体装配，渲染期由 WaterMaterial 做 LOD/动画。
//   · 顶点为 chunk 局部坐标（与顶面同约定 lx − HALF，原点=chunk 中心）。
// 本文件不 import three —— Worker 依赖最小（与 PatchCompute 同哲学）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { TILE_PIT, TILE_WATER } from "./Tiles";
import type { FaceTable } from "./FaceTable";
import {
  baseHeightOf,
  surfaceHeightCore,
  type BlockSource,
} from "./Refinements";
import type { PatchOverlay } from "./FaceBuild";

const BPS = BLOCKS_PER_SIDE; // 15
const N = CHUNK_SIZE;        // 60
const HALF = CHUNK_SIZE / 2; // 30（几何局部坐标中心化，与 FaceBuild 同约定）
/** 水深钳制上限（着色器归一用；m） */
export const WATER_MAX_DEEP = 6;
/** 水帘贴墙内收（m，避坑侧壁 z-fight）；水面沿坑边外延同值，盖过幕布唇沿防交缝 */
const FALL_INSET = 0.1;
/** 水帘最小落差（m；过浅不生成） */
const FALL_MIN = 0.2;
/** 平面剔除容差：水块地形顶高于 0+ε 视为干地，不铺水面 */
const PLANE_Y_EPS = 0.05;
/** 边界向下采样间距（m；硬要求 <10cm → 取 5cm；4m 块 = 80×80 点阵，逐块缓存一次） */
export const LIP_STRIDE = 0.05;
/** 平面向下柱深采样：1m cell 内 3×3 点阵（{0.25,0.5,0.75} 偏移） */
const CELL_BED_OFFSETS = [0.25, 0.5, 0.75];
/** 幕帘脚向坑内进深的贴边带（m，0.05 步长采样到该深度；水沿挖坡下行即止于此） */
const CURTAIN_REACH = 1.0;
/** 幕帘 / 唇沿 向下采样网格尺寸（= 4m / 0.05m） */
const BED_GRID = Math.round(4 / LIP_STRIDE);
/** 每块 5cm 床面点阵行/列的采样起止索引（1m cell 3×3 柱深 = 行偏移 0.25/0.5/0.75 → 索引 5/10/15） */

/** 水顶点方向常量 */
const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;
/** 各向期望外法线（WaterSurface 产出；顶点序反推用） */
const DIR_NORMALS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface WaterSurfaceRaw {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 逐顶点：平面 = 水深（0..WATER_MAX_DEEP）；水帘 = -1 / 斜边 = -3 哨兵 */
  deep: Float32Array;
  /** 逐顶点旋转参数(angularSpeed, phase)：标准水全 0；boss4D 水幕 = 4D 自转/漂浮 */
  spin: Float32Array;
  indices: Uint32Array;
  /** 诊断：平面 quad 数 + 水帘 quad 数 */
  quads: number;
}

/** 世界 4m 块坐标 key（整数合成，非负；池解粒度 = 4m 块 */ 
export function worldBlockKey(bx: number, bz: number): number {
  return (bx + 4096) * 8192 + (bz + 4096);
}
function blockX(k: number): number {
  return Math.floor(k / 8192) - 4096;
}
function blockZ(k: number): number {
  return (k % 8192) - 4096;
}
function chunkKey(cx: number, cz: number): number {
  return worldBlockKey(cx, cz);
}
/** 边界探针边 id = 水块 key*4 + 方向 */
function edgeKey(bk: number, dir: number): number {
  return bk * 4 + dir;
}
function edgeBlock(e: number): number {
  return e >> 2;
}
function edgeDir(e: number): number {
  return e & 3;
}

/** levels 层数表（60×60）的轻量哈希 —— 增量状态有效性守卫（清库重挖后自愈） */
export function levelsHash(levels: Uint8Array): number {
  let h = 0;
  for (let i = 0; i < levels.length; i++) h = (h + levels[i] * (i + 1) + i) & 0x7fffffff;
  return h;
}

// ============================================================
// ★ 增量状态（模块级；Worker/主线程各持一份，逐 chunk）：
//   每个水体区域 = 一个连通分量；每块连通分量携带边界探针，dig 只重采样脏块
//   邻近探针、只重安定受影响分量 —— 探针/分量随拆池、干块动态创建与销毁。
// ============================================================

/** 探针邻块类型：0=越界/缺数据，1=水，2=坑，3=陆地 */
const enum PKind { OUT = 0, WATER = 1, PIT = 2, LAND = 3 }

/** 单支边界探针（水块一侧 → 邻块） */
interface EdgeProbe {
  /** 邻块（世界 4m 块） */
  nbx: number;
  nbz: number;
  kind: PKind;
  /** 横向探针值：邻【陆】块整面 5cm 点阵最低点（唇位）；坑/水/外 = +∞（不约束平面） */
  doorMin: number;
  /** 竖向探针值：邻【坑】块「整条 4m 边 × 进深 1m 带」5cm 网格最低点（幕帘脚） */
  botY: number;
  /** 有效标志（dig 失效后惰性重采样） */
  valid: boolean;
}

/** 连通分量：当前淹没什么水块（探针激活集 = 分量水块的边界边） */
interface WComp {
  blocks: Set<number>;
}

/** 单个 4m 水块（静态成员；level/deep 由分量安定写入） */
interface WBlock {
  level: number;
  deep: number;
}

interface ChunkWater {
  key: number;
  cx: number;
  cz: number;
  /** 静态水块成员（本 chunk 内所有 TILE_WATER 块；地形不变则恒） */
  blocks: Map<number, WBlock>;
  /** 现在淹没什么块（干块摘除） */
  occ: Set<number>;
  /** 连通分量表：compId → {blocks} */
  comps: Map<number, WComp>;
  /** 水块 → 所属分量 id */
  compOf: Map<number, number>;
  nextComp: number;
  /** 全部边界探针（edgeKey → probe；激活 ⟷ 该水块 ∈ occ） */
  probes: Map<number, EdgeProbe>;
  /** 反向索引：邻块 key → 指向它的边 id[]（dig 失效查询用） */
  rev: Map<number, number[]>;
  /** 邻块的 5cm 床面点阵缓存（横向/竖向探针的数据源，逐块 du在 dig 失效） */
  grids: Map<number, Float32Array>;
  gridMins: Map<number, number>;
  /** 增量状态对应 levelsHash；drift → 全量重解 */
  hash: number;
  /** 已初始化过（occ/分量结构就绪；未 init 时即便有 dirty 也要先全量） */
  inited: boolean;
}

/** 增量状态表（LRU 上限；超出驱逐最旧 chunk —— 恢复正常由 levelsHash 守卫） */
const waterStates = new Map<number, ChunkWater>();
const WATER_STATE_MAX = 32;
function waterStateFor(cx: number, cz: number): ChunkWater {
  const key = chunkKey(cx, cz);
  let s = waterStates.get(key);
  if (!s) {
    s = { key, cx, cz, blocks: new Map(), occ: new Set(), comps: new Map(), compOf: new Map(), nextComp: 1, probes: new Map(), rev: new Map(), grids: new Map(), gridMins: new Map(), hash: 0, inited: false };
    waterStates.set(key, s);
    if (waterStates.size > WATER_STATE_MAX) {
      const first = waterStates.keys().next().value as number | undefined;
      if (first !== undefined) waterStates.delete(first);
    }
  }
  return s;
}

/** 反向索引登记：邻块 key → 指向它的边 id[]（dig 失效查询用） */
function revAdd(s: ChunkWater, e: number): void {
  const probe = s.probes.get(e);
  if (!probe) return;
  const nk = worldBlockKey(probe.nbx, probe.nbz);
  let list = s.rev.get(nk);
  if (!list) { list = []; s.rev.set(nk, list); }
  if (!list.includes(e)) list.push(e);
}
/** 反向索引全量重建（全量重解时用） */
function indexRev(s: ChunkWater): void {
  s.rev.clear();
  for (const [e, p] of s.probes) {
    if (p.kind === PKind.LAND || p.kind === PKind.PIT) revAdd(s, e);
  }
}

/** 建/复用水块的边界探针（4 支；含反向索引登记） */
function buildEdges(s: ChunkWater, bx: number, bz: number, src: BlockSource): void {
  const bk = worldBlockKey(bx, bz);
  for (let dir = 0; dir < 4; dir++) {
    const nx = bx + DIR4[dir].dx, nz = bz + DIR4[dir].dz;
    const nb = src.blockAt(nx, nz);
    const kind = !nb ? PKind.OUT : nb.id === TILE_PIT.id ? PKind.PIT : nb.id === TILE_WATER.id ? PKind.WATER : PKind.LAND;
    const e = edgeKey(bk, dir);
    const probe: EdgeProbe = { nbx: nx, nbz: nz, kind, doorMin: Infinity, botY: Infinity, valid: false };
    s.probes.set(e, probe);
    if (kind === PKind.LAND || kind === PKind.PIT) revAdd(s, e);
  }
}

/** 建静态水块成员（幂等；地形变时补增） */
function ensureBlocks(s: ChunkWater, table: FaceTable, src: BlockSource): void {
  const { cx, cz } = table;
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const depth = 0 - cell.h;
      if (depth < -PLANE_Y_EPS) continue;
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const bk = worldBlockKey(bx, bz);
      if (!s.blocks.has(bk)) {
        s.blocks.set(bk, { level: 0, deep: Math.min(Math.max(depth, 0), WATER_MAX_DEEP) });
        buildEdges(s, bx, bz, src);
      }
    }
  }
}

/** 挖后床面单点（不发缓存；探针触底/柱深用） */
function digTopOf(src: BlockSource, patch: PatchOverlay, bx: number, bz: number, x: number, z: number): number {
  return surfaceHeightCore(src, bx, bz, x, z) - patch.depthOf(x, z);
}
/** 块中心挖后床面（干湿判定 / 池深基准） */
function bedOf(src: BlockSource, patch: PatchOverlay, bx: number, bz: number): number {
  return digTopOf(src, patch, bx, bz, bx * 4 + 2, bz * 4 + 2);
}

/** 邻块 5cm 床面点阵（逐块缓存；dig 失效后重填） */
function bedGridOf(s: ChunkWater, src: BlockSource, patch: PatchOverlay, bx: number, bz: number): Float32Array {
  const bk = worldBlockKey(bx, bz);
  let g = s.grids.get(bk);
  if (!g) {
    g = new Float32Array(BED_GRID * BED_GRID);
    for (let i = 0; i < BED_GRID; i++) {
      for (let j = 0; j < BED_GRID; j++) {
        g[i * BED_GRID + j] = digTopOf(src, patch, bx, bz, bx * 4 + (i + 0.5) * LIP_STRIDE, bz * 4 + (j + 0.5) * LIP_STRIDE);
      }
    }
    s.grids.set(bk, g);
  }
  return g;
}
/** 邻块整面最低点（横向探针 = 唇位；整面 5cm min） */
function blockBedMinOf(s: ChunkWater, src: BlockSource, patch: PatchOverlay, bx: number, bz: number): number {
  const bk = worldBlockKey(bx, bz);
  let m = s.gridMins.get(bk);
  if (m === undefined) {
    const g = bedGridOf(s, src, patch, bx, bz);
    m = Infinity;
    for (let k = 0; k < BED_GRID * BED_GRID; k++) if (g[k] < m) m = g[k];
    s.gridMins.set(bk, m);
  }
  return m;
}
/** 竖向探针 = 幕帘脚：邻【坑】块「整条 4m 边切线 × 贴边进深 1m 带」5cm 点阵最低点 */
function curtainBotOf(s: ChunkWater, src: BlockSource, patch: PatchOverlay, nbx: number, nbz: number, dir: number): number {
  const g = bedGridOf(s, src, patch, nbx, nbz);
  const reachRows = Math.round(CURTAIN_REACH / LIP_STRIDE); // 20
  const dr = DIR4[dir];
  const rFrom = dr.dx === -1 || dr.dz === -1 ? BED_GRID - reachRows : 0;
  const nb = src.blockAt(nbx, nbz);
  let m = nb ? baseHeightOf(nb) : Infinity;
  for (let r = rFrom; r < rFrom + reachRows; r++) {
    for (let c = 0; c < BED_GRID; c++) { // 整条 4m 边全部切线列
      const k = dir === 0 || dir === 1 ? r * BED_GRID + c : c * BED_GRID + r;
      const h = g[k];
      if (h < m) m = h;
    }
  }
  return m;
}

/** 惰性重采样边界探针（脏边/首采） */
function ensureProbe(s: ChunkWater, src: BlockSource, patch: PatchOverlay, e: number): EdgeProbe | null {
  const p = s.probes.get(e);
  if (!p || p.valid) return p ?? null;
  if (p.kind === PKind.LAND) {
    p.doorMin = blockBedMinOf(s, src, patch, p.nbx, p.nbz);
  } else if (p.kind === PKind.PIT) {
    p.botY = curtainBotOf(s, src, patch, p.nbx, p.nbz, edgeDir(e));
  }
  p.valid = true;
  return p;
}

/** 全量重解：occ/分量从零重建（幂等；用「脏块 BFS 重拆 + 探针 min」== 旧 settle） */
function initSolve(s: ChunkWater, table: FaceTable, src: BlockSource, patch: PatchOverlay, hash: number): void {
  ensureBlocks(s, table, src);
  s.hash = hash;
  s.inited = true;
  // 点阵/探针全部失效 + 反向索引/分量清空（几何全量重解；与增量同一数据源）
  s.grids.clear();
  s.gridMins.clear();
  indexRev(s);
  for (const p of s.probes.values()) p.valid = false;
  // occ = 全部静块；逐分量安定（连通 = 4 邻域）
  s.occ.clear();
  for (const bk of s.blocks.keys()) s.occ.add(bk);
  s.comps.clear();
  s.compOf.clear();
  s.nextComp = 1;
  const visited = new Set<number>();
  for (const seed of s.blocks.keys()) {
    if (visited.has(seed)) continue;
    const part = new Set<number>();
    const stack = [seed];
    visited.add(seed);
    while (stack.length > 0) {
      const k = stack.pop()!;
      part.add(k);
      const bx = blockX(k), bz = blockZ(k);
      for (let dir = 0; dir < 4; dir++) {
        const nk = worldBlockKey(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
        if (s.occ.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          stack.push(nk);
        }
      }
    }
    const cid = s.nextComp++;
    s.comps.set(cid, { blocks: part });
    for (const bk of part) s.compOf.set(bk, cid);
  }
  for (const [cid, comp] of s.comps) settleComp(s, cid, comp, src, patch, s.blocks);
  warmPitProbes(s, src, patch);
}

/** 分量安定：L = min(0, 各横向探针唇)；床≥L 的块摘出（干块）→ 递归拆池（4m 连通） */
function settleComp(
  s: ChunkWater,
  cid: number,
  comp: WComp,
  src: BlockSource,
  patch: PatchOverlay,
  members: Map<number, WBlock>,
): void {
  for (;;) {
    let L = 0;
    for (const k of comp.blocks) {
      const bx = blockX(k), bz = blockZ(k);
      for (let dir = 0; dir < 4; dir++) {
        const p = ensureProbe(s, src, patch, edgeKey(k, dir));
        if (p && p.kind === PKind.LAND && p.doorMin < L) L = p.doorMin;
      }
    }
    const dried: number[] = [];
    for (const k of comp.blocks) {
      if (bedOf(src, patch, blockX(k), blockZ(k)) >= L - 1e-3) dried.push(k);
    }
    if (dried.length === 0) {
      for (const k of comp.blocks) {
        const w = members.get(k)!;
        w.level = L;
        w.deep = Math.min(Math.max(L - bedOf(src, patch, blockX(k), blockZ(k)), 0), WATER_MAX_DEEP);
      }
      return;
    }
    // 干块摘除：探针随水块出池而销毁（激活 ⟷ occ）；分量缩水
    for (const k of dried) {
      s.occ.delete(k);
      comp.blocks.delete(k);
      s.compOf.delete(k);
    }
    if (comp.blocks.size === 0) {
      s.comps.delete(cid);
      return;
    }
    // 大池按 4m 连通性拆成多个子池 → 各自安定
    const visited = new Set<number>();
    let first = true;
    for (const seed of comp.blocks) {
      if (visited.has(seed)) continue;
      const part = new Set<number>();
      const stack = [seed];
      visited.add(seed);
      while (stack.length > 0) {
        const k = stack.pop()!;
        part.add(k);
        const bx = blockX(k), bz = blockZ(k);
        for (let dir = 0; dir < 4; dir++) {
          const nk = worldBlockKey(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
          if (comp.blocks.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            stack.push(nk);
          }
        }
      }
      if (first) {
        first = false;
        comp.blocks = part;
        for (const bk of part) s.compOf.set(bk, cid);
        settleComp(s, cid, comp, src, patch, members);
      } else {
        const ncid = s.nextComp++;
        const nc: WComp = { blocks: part };
        s.comps.set(ncid, nc);
        for (const bk of part) s.compOf.set(bk, ncid);
        settleComp(s, ncid, nc, src, patch, members);
      }
    }
    return;
  }
}

/** 安定后：把所有激活（∈occ）水块的竖向探针（坑帘脚）惰性采样就绪 */
function warmPitProbes(s: ChunkWater, src: BlockSource, patch: PatchOverlay): void {
  for (const bk of s.occ) {
    for (let dir = 0; dir < 4; dir++) {
      ensureProbe(s, src, patch, edgeKey(bk, dir));
    }
  }
}

/**
 * 增量更新：dig 事件 → 只重采样脏块邻近探针、只重安定受影响分量。
 * @param dirty 本次 dig 直接挖到的 4m 块集合（世界块 key）；undefined 由外部触发全量。
 */
function updateSolve(s: ChunkWater, table: FaceTable, src: BlockSource, patch: PatchOverlay, dirty: number[]): void {
  ensureBlocks(s, table, src);
  // 1) 脏块点阵失效（横向/竖向探针数据源）
  for (const bk of dirty) {
    s.grids.delete(bk);
    s.gridMins.delete(bk);
  }
  // 2) 指向脏块的探针失效（唇/帘脚重采样）→ 记录受影响分量
  const affected = new Set<number>();
  for (const bk of dirty) {
    const list = s.rev.get(bk);
    if (!list) continue;
    for (const e of list) {
      const p = s.probes.get(e);
      if (!p || !p.valid) continue;
      p.valid = false;
      const cid = s.compOf.get(edgeBlock(e));
      if (cid !== undefined) affected.add(cid);
    }
  }
  // 3) 只重安定受影响分量（可能干块摘除 / 拆池级联）
  for (const cid of affected) {
    const comp = s.comps.get(cid);
    if (comp) settleComp(s, cid, comp, src, patch, s.blocks);
  }
  // 4) 幕帘脚随新床面重采样（竖向往深挖的坑）
  warmPitProbes(s, src, patch);
}

// ============================================================
// ①③ 几何发射（平面 + 坑水交界幕帘）
// ============================================================

function emitWater(
  table: FaceTable,
  src: BlockSource,
  patch: PatchOverlay | undefined,
  occ: Map<number, { level: number; deep: number }>,
  probes: Map<number, EdgeProbe> | undefined,
): WaterSurfaceRaw {
  const { cx, cz } = table;
  const verts: number[] = [];
  const nors: number[] = [];
  const uvs: number[] = [];
  const deps: number[] = [];
  const idx: number[] = [];
  let quads = 0;
  const CH = CHUNK_SIZE;

  /** 1m cell 的向下床底面最低点（挖后；{0.25,0.5,0.75} 3×3 采样 → 柱深/干湿用） */
  const cellBedMin = (wx: number, wz: number): number => {
    let m = Infinity;
    for (const a of CELL_BED_OFFSETS) {
      for (const b of CELL_BED_OFFSETS) {
        const h = digTopOf(src, patch as PatchOverlay, Math.floor(wx / 4), Math.floor(wz / 4), wx + a, wz + b);
        if (h < m) m = h;
      }
    }
    return m;
  };

  // ============ ① 水面平面：单一索引网格（四角顶点跨格共用；透明 AA 无缝） ============
  //    no-patch：顶点 y=0，deep=max(邻块)。patch：y=池水位，key 含水位（跨池不混点）。
  const filled = new Uint8Array((N + 1) * (N + 1));
  const cX = new Map<number, number>();
  const cZ = new Map<number, number>();
  const PIT_INC = FALL_INSET;
  for (let lz = 0; lz < N; lz++) {
    const lbz = lz >> 2;
    for (let lx = 0; lx < N; lx++) {
      const cell = table.cells[lbz * BPS + (lx >> 2)];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const lbx = lx >> 2;
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const o = occ.get(worldBlockKey(bx, bz));
      if (!o) continue; // 干块（patch 拆池）→ 不铺平面
      filled[lz * (N + 1) + lx] = 1;
      const isPit = (dx: number, dz: number): boolean => {
        const b = src.blockAt(bx + dx, bz + dz);
        return !!b && b.id === TILE_PIT.id;
      };
      const pushDisp = (k: number, dx: number, dz: number) => {
        const ox = cX.get(k) ?? 0, oz = cZ.get(k) ?? 0;
        if (dx !== 0) cX.set(k, ox !== 0 && Math.sign(ox) === Math.sign(dx) ? ox : ox + dx);
        if (dz !== 0) cZ.set(k, oz !== 0 && Math.sign(oz) === Math.sign(dz) ? oz : oz + dz);
      };
      const pitDisp = (x: number, z: number, dx: number, dz: number) =>
        pushDisp(x * 128 + z, dx, dz);
      // ★ 坑邻边外延 FALL_INSET：水面顶到幕帘顶，避免"水纹理与幕墙间隔"
      if (isPit(1, 0)) { pitDisp(lx + 1, lz, PIT_INC, 0); pitDisp(lx + 1, lz + 1, PIT_INC, 0); }
      if (isPit(-1, 0)) { pitDisp(lx, lz, -PIT_INC, 0); pitDisp(lx, lz + 1, -PIT_INC, 0); }
      if (isPit(0, 1)) { pitDisp(lx, lz + 1, 0, PIT_INC); pitDisp(lx + 1, lz + 1, 0, PIT_INC); }
      if (isPit(0, -1)) { pitDisp(lx, lz, 0, -PIT_INC); pitDisp(lx + 1, lz, 0, -PIT_INC); }
    }
  }
  const cornerOf = new Map<number, number>();
  const cornerKey = (x: number, z: number, level: number): number =>
    patch ? x * 262144 + z * 64 + Math.round((level + 4) * 512) : x * 128 + z;
  const vertexAt = (x: number, z: number, level: number): number => {
    const k = cornerKey(x, z, level);
    let vi = cornerOf.get(k);
    if (vi === undefined) {
      vi = verts.length / 3;
      cornerOf.set(k, vi);
      verts.push(x - HALF + (cX.get(x * 128 + z) ?? 0), level, z - HALF + (cZ.get(x * 128 + z) ?? 0));
      nors.push(0, 1, 0);
      uvs.push(x / N, z / N);
      // 角深（向下的柱深，1m cell 级 3×3 采样聚合；无 patch = 块级 occ deep 基线）
      let dmax = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const ccx = x + dx, ccz = z + dz;
        if (ccx < 0 || ccz < 0 || ccx >= N || ccz >= N) continue;
        const wx = cx * CH + ccx, wz = cz * CH + ccz;
        const o = occ.get(worldBlockKey(cx * BPS + (ccx >> 2), cz * BPS + (ccz >> 2)));
        if (!o || Math.abs(o.level - level) >= 1e-4) continue;
        const d = patch
          ? Math.min(Math.max(level - cellBedMin(wx, wz), 0), WATER_MAX_DEEP)
          : o.deep;
        if (d > dmax) dmax = d;
      }
      deps.push(dmax);
    }
    return vi;
  };
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!filled[lz * (N + 1) + lx]) continue;
      const o = occ.get(worldBlockKey(cx * BPS + (lx >> 2), cz * BPS + (lz >> 2)))!;
      const level = o.level;
      const a = vertexAt(lx, lz, level), b = vertexAt(lx + 1, lz, level),
        c = vertexAt(lx + 1, lz + 1, level), d = vertexAt(lx, lz + 1, level);
      idx.push(a, d, b, b, d, c); // +Y 外法线（a→d→b / b→d→c）
      quads++;
    }
  }

  // ============ ② 坑水交界 —— 下落水帘（4m 整边一条；patch 时帘脚 = 竖向探针 5cm 采样接挖后坑床） ============
  const probeFor = (bk: number, dir: number): EdgeProbe | undefined => probes?.get(edgeKey(bk, dir));
  for (let lbz = 0; lbz < BPS; lbz++) {
    const z0 = lbz * 4 - HALF;              // 块局部 z 起点
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const bx = cx * BPS + lbx, bz = cz * BPS + lbz;
      const o = occ.get(worldBlockKey(bx, bz));
      if (!o) continue; // 干块 → 无幕帘
      const x0 = lbx * 4 - HALF;            // 块局部 x 起点
      for (let dir = 0; dir < 4; dir++) {
        const dx = DIR4[dir].dx, dz = DIR4[dir].dz;
        const n = src.blockAt(bx + dx, bz + dz);
        if (!n || n.id !== TILE_PIT.id) continue;
        const want = DIR_NORMALS[dir];
        const lipY = o.level; // 唇沿 = 本池水位（patch 已下沉）
        // ★ 竖向探针：挖后坑床（向外+向下，5cm 点阵缓存复用）→ 底脚值
        let botY = baseHeightOf(n);
        const p = probeFor(worldBlockKey(bx, bz), dir);
        if (patch && p) botY = p.botY;
        const fallLen = lipY - botY;
        if (fallLen < FALL_MIN) continue; // 落差过浅不生成（连斜边也不出）

        // 壁轴与切线（整条 4m 边）
        const axisX = dir === 0 || dir === 1;
        const fixed = axisX
          ? (dir === 0 ? x0 + 4 + FALL_INSET : x0 - FALL_INSET)
          : (dir === 2 ? z0 + 4 + FALL_INSET : z0 - FALL_INSET);
        const rev = dir === 1 || dir === 3;
        const pt = (t: number, y: number): [number, number, number] => {
          const u = rev ? 1 - t : t;
          return axisX ? [fixed, y, z0 + u * 4] : [x0 + u * 4, y, fixed];
        };
        const a = pt(0, botY), b = pt(0, lipY), c = pt(1, lipY), d = pt(1, botY);
        // 校验/修正绕序：外法线 = cross(b−a, c−a)；不符则翻面
        const ax0 = a[0], az0 = a[2];
        const dx1 = b[0] - ax0, dy1 = b[1] - a[1], dz1 = b[2] - az0;
        const dx2 = c[0] - ax0, dy2 = c[1] - a[1], dz2 = c[2] - az0;
        const nx = dy1 * dz2 - dz1 * dy2;
        const ny = dz1 * dx2 - dx1 * dz2;
        const nz = dx1 * dy2 - dy1 * dx2;
        const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
        const pts = flip ? [a, d, c, b] : [a, b, c, d];
        const vi = verts.length / 3;
        for (let k = 0; k < 4; k++) {
          const [px, py, pz] = pts[k];
          verts.push(px, py, pz);
          nors.push(want[0], want[1], want[2]);
          // uv：x = 沿帘切线 0..1（整条边归一）；y = 落差 0(唇)..1(坑底)
          const tU = axisX ? (pz - z0) / 4 : (px - x0) / 4;
          uvs.push(tU, (lipY - py) / fallLen);
          deps.push(-1);
        }
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        quads++;
        // ★ 保护性斜边（仅 patch 时；罩住 90° 交界深缝，唇沿向水侧倒 45°；整条边一条）
        if (patch) {
          const ROOF = 0.14;
          const ROOF_DROP = 0.2; // 斜边下探：稳定覆盖水面波动全程（波幅约 ±0.09）
          const wnx = -dx, wnz = -dz; // 水侧法向 = 坑反方向
          const tA = pt(0, lipY), tB = pt(1, lipY); // 唇沿两角（y=lipY）
          const r0: [number, number, number] = [tA[0] + wnx * ROOF, lipY - ROOF_DROP, tA[2] + wnz * ROOF];
          const r1: [number, number, number] = [tB[0] + wnx * ROOF, lipY - ROOF_DROP, tB[2] + wnz * ROOF];
          // 法向：低 N.y（<0.5 → fragment 走幕布分支，唇沿水色）；略偏水侧
          const rn: [number, number, number] = [wnx * 0.7, 0.3, wnz * 0.7];
          const rp0: [number, number, number] = tA;
          const rp1: [number, number, number] = r0;
          const rp2: [number, number, number] = r1;
          const rp3: [number, number, number] = tB;
          const rax = rp0[0], raz = rp0[2];
          const rv1 = [rp1[0] - rax, rp1[1] - rp0[1], rp1[2] - raz];
          const rv2 = [rp2[0] - rax, rp2[1] - rp0[1], rp2[2] - raz];
          const rnx = rv1[1] * rv2[2] - rv1[2] * rv2[1];
          const rny = rv1[2] * rv2[0] - rv1[0] * rv2[2];
          const rnz = rv1[0] * rv2[1] - rv1[1] * rv2[0];
          const roofPts = [rp0, rp1, rp2, rp3];
          if (rnx * rn[0] + rny * rn[1] + rnz * rn[2] < 0) roofPts.reverse();
          const rvi = verts.length / 3;
          for (let k = 0; k < 4; k++) {
            const [px, py, pz] = roofPts[k];
            verts.push(px, py, pz);
            nors.push(rn[0], rn[1], rn[2]);
            uvs.push(0.5, 0.0); // uv.y=0 → 唇沿水色
            deps.push(-3);      // 斜边哨兵：fragment 用极浅 alpha 遮缝
          }
          idx.push(rvi, rvi + 1, rvi + 2, rvi, rvi + 2, rvi + 3);
          quads++;
        }
      }
    }
  }

  return {
    vertices: Float32Array.from(verts),
    normals: Float32Array.from(nors),
    uvs: Float32Array.from(uvs),
    deep: Float32Array.from(deps),
    spin: new Float32Array((verts.length / 3) * 2), // 标准水静止 → 旋速/相位全 0
    indices: Uint32Array.from(idx),
    quads,
  };
}

// ============================================================
// 公共入口
// ============================================================

export interface WaterBuildOpts {
  /** 本次 dig 直接挖到的 4m 块（世界块 key）；缺省 = 强制全量重解（探针/回退语义） */
  dirty?: number[] | Set<number> | null;
  /** 层数表轻量哈希（水位状态有效性守卫；与 levels 同步传入） */
  layersHash?: number;
}

/**
 * 给定 chunk 表 → 静止基面几何字节（局部坐标；无水位/起伏，起伏由 shader 做）。
 * @param table  该 chunk 的 FaceTable（Pass1 已定型：topTileId/h）
 * @param src    邻域源（跨 chunk 边判 pit 邻接用）
 * @param patch  可选：子弹命中补丁覆盖层。传入时走「增量连通分量 + 边界探针」；
 *               缺省 = 基线（不建状态，回归锁定）。
 * @param opts   增量更新参数（dirty 缺省 → 强制全量重解）
 */
export function buildWaterSurface(
  table: FaceTable,
  src: BlockSource,
  patch?: PatchOverlay,
  opts?: WaterBuildOpts,
): WaterSurfaceRaw {
  const { cx, cz } = table;
  if (!patch) {
    // ============ 0) no-patch 基线池（全块水平面 0 = 0−h；不建状态） ============
    const occ = new Map<number, { level: number; deep: number }>();
    for (let lbz = 0; lbz < BPS; lbz++) {
      for (let lbx = 0; lbx < BPS; lbx++) {
        const cell = table.cells[lbz * BPS + lbx];
        if (cell.topTileId !== TILE_WATER.id) continue;
        const depth = 0 - cell.h;
        if (depth < -PLANE_Y_EPS) continue; // 干地防穿面
        const key = worldBlockKey(cx * BPS + lbx, cz * BPS + lbz);
        if (!occ.has(key))
          occ.set(key, { level: 0, deep: Math.min(Math.max(depth, 0), WATER_MAX_DEEP) });
      }
    }
    return emitWater(table, src, undefined, occ, undefined);
  }

  const s = waterStateFor(cx, cz);
  const hasDirty = opts?.dirty !== undefined && opts?.dirty !== null;
  const dirtyList = hasDirty
    ? Array.isArray(opts!.dirty)
      ? opts!.dirty as number[]
      : [...(opts!.dirty as Set<number>)]
    : [];
  const hash = opts?.layersHash ?? 0;
  // 未初始化 / 无增量信息 / levels 哈希漂移（清库重挖） → 全量重解
  if (!s.inited || !hasDirty || (opts!.layersHash !== undefined && s.hash !== hash)) {
    initSolve(s, table, src, patch, hash);
  } else {
    updateSolve(s, table, src, patch, dirtyList);
    s.hash = hash;
  }
  // 发射（occ/探针驱动；全部读状态）
  const occ = new Map<number, { level: number; deep: number }>();
  for (const bk of s.occ) {
    const w = s.blocks.get(bk)!;
    occ.set(bk, { level: w.level, deep: w.deep });
  }
  return emitWater(table, src, patch, occ, s.probes);
}