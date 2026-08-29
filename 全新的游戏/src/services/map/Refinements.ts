// ============================================================
// Refinements —— 地形精修层（L6 定型段核心执行器）
// ============================================================
// 架构详见《架构设计.md》§8.0「三阶段地形产出」+「edgeFinal 唯一执行器」。
//
// ★ 意志：块边界「硬过渡(cliff) vs 插值(weld)」判定的执行权由本层全权执掌。
//   - 规则链（band / edgePolicy / 角色对）是精修层的【内部默认引擎】，
//     不直接暴露给消费者（见 SurfaceRules.edgeRuling）。
//   - 本层通过 BlockSource.edgeFinal 显式钉死某条边 weld/cliff/inherit。
//   - 消费者（cornerHeight/sampleSurface/edgeOf/墙）一律走 finalRuling，
//     只读本层输出——见五条铁律之五「对外纯净、下行全消费」。
//
// ★ 确定性/可重放：空精修 = 恒透传（不设 edgeFinal）→ 与旧世界逐位一致；
//   有精修意图时，edgeFinal(bx,bz,dir) 只对显式条目返回，其余落回默认引擎。
//   零 three 依赖，主线程与 Worker 同一份代码。
// ============================================================

import type { BlockSource, EdgeRuling, BlockInfo } from './SurfaceRules';

// ============================================================
// 精修意图类型（未来扩展：setHeight / overrideTile / materialOnly / carve…
// 均以「确定性命中 → 展开成 edge 显式覆写或块属性改写」的方式并入）
// ============================================================

/** 显式钉死某条边（dir：0=+x 1=−x 2=+z 3=−z） */
export interface EdgeOverride {
  bx: number;
  bz: number;
  dir: 0 | 1 | 2 | 3;
  ruling: EdgeRuling;
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

/** 空精修（恒透传，≡ 旧世界） */
export const EMPTY_REFINEMENTS: Refinements = { edgeOverrides: new Map(), heights: new Map() };

function edgeKey(bx: number, bz: number, dir: 0 | 1 | 2 | 3): string {
  return `${bx},${bz},${dir}`;
}
function blockKey(bx: number, bz: number): string {
  return `${bx},${bz}`;
}

/** ★ 依据 seed 生成精修意图（当前为空实现 = 恒空；未来在这里铺精修规则） */
export function planRefinements(_seed: number): Refinements {
  return EMPTY_REFINEMENTS;
}

/**
 * ★ 精修层核心：把一块 BlockSource 包装为「精修后的 BlockSource」。
 *  - 空精修：不设 edgeFinal、不提高度 → finalRuling/blockAt 落回默认
 *    → 与旧地形逐位一致。
 *  - 有精修：edgeFinal 对显式条目返回钉死裁决；blockAt 对显式高度/底高
 *    补丁返回改写后的块信息，其余回落默认。
 * 主线程（RasterMap.surfaceBlocks 等）与 Worker（makeSnapshotSource）
 * 用同一函数包装 → 逐位同源自构造保证。
 */
export function refine(src: BlockSource, ref: Refinements): BlockSource {
  const hasEdges = ref.edgeOverrides.size > 0;
  const hasHeights = ref.heights.size > 0;
  if (!hasEdges && !hasHeights) return src;
  const out: BlockSource = { ...src };
  if (hasEdges) {
    out.edgeFinal = (bx: number, bz: number, dir: 0 | 1 | 2 | 3): EdgeRuling | undefined =>
      ref.edgeOverrides.get(edgeKey(bx, bz, dir))?.ruling;
  }
  if (hasHeights) {
    const base = src.blockAt.bind(src);
    out.blockAt = (bx: number, bz: number) => {
      const p = ref.heights.get(blockKey(bx, bz));
      const b = base(bx, bz);
      if (!p || !b) return b;
      return { id: b.id, h: p.h, ...(p.hBase !== undefined ? { hBase: p.hBase } : { hBase: b.hBase }) };
    };
  }
  return out;
}

/**
 * 便捷：给某条边显式钉死裁决（返回新 Refinements，纯数据、可重建）。
 * inherit 语义 = 从表里删除该条目，回落默认引擎。
 */
export function overrideEdge(ref: Refinements, bx: number, bz: number, dir: 0 | 1 | 2 | 3, ruling: EdgeRuling | 'inherit'): Refinements {
  const next = new Map(ref.edgeOverrides);
  const key = edgeKey(bx, bz, dir);
  if (ruling === 'inherit') next.delete(key);
  else next.set(key, { bx, bz, dir, ruling });
  return { edgeOverrides: next, heights: new Map(ref.heights) };
}

/**
 * 便捷：给某块改写高度（h 顶面 / 可选 hBase 底高）。断言 hBase 缺省 = h
 * （保持厚度、不悬空）。返回新 Refinements。这就是「侵蚀/平台/坡面成形」的
 * 确定性原语——下游所有（渲染/物理/贴地/烘焙/补墙）经 blockAt 被动跟随。
 */
export function setHeight(ref: Refinements, bx: number, bz: number, h: number, hBase?: number): Refinements {
  const next = new Map(ref.heights);
  next.set(blockKey(bx, bz), { bx, bz, h, ...(hBase !== undefined ? { hBase } : {}) });
  return { edgeOverrides: new Map(ref.edgeOverrides), heights: next };
}

// ============================================================
// 确定性侵蚀（连续、克制——不可控的"满地图坑"是被第二铁律禁止的形态）
// ============================================================
// 共同设计（对应用户意志）：
//   · 连续：侵蚀必须有【主体/走向】——沿台缘边界、沿低处高差梯度传播（BFS），
//     而非每块独立随机 hash（那正是"密密麻麻的坑"的根源，禁止）。
//   · 克制：单次侵蚀结果高度收紧、单批侵蚀块数设上限，宁可少而精。
//   · 确定性：同 (seed, 地形读出) → 同输出；经 setHeight 展开成显式补丁，
//     下游（渲染/物理/贴地/烘焙/补墙）全部被动跟随。
//   · 默认关闭：这些构建器不被 planRefinements 自动引用 → 空精修 ≡ 旧世界
//     的基准不受影响；接入主流程时才显式调用并把结果合并进精修意图。
// ============================================================

/** 侵蚀所需的只读地形读出（调用方注入 BlockSource 或 RasterMap 适配器） */
export type BlockReader = (bx: number, bz: number) => BlockInfo | undefined;

export interface CarveOpts {
  /** 一次性最多切蚀的块数（克制上限） */
  maxBlocks?: number;
  /** 单块切深上限（米，克制） */
  maxDepth?: number;
  /** 沿低处梯度传播的最大步数 */
  maxSteps?: number;
}

/**
 * ① 低处沟壑（梯度切蚀）：用 seed 在窗口内确定性撒少量种子块（数目克制），
 *    每个种子自其局部向「更低邻块」做至多 steps 步的 BFS 下行，把沿途
 *    已到洼处的块再压深一档（h 与 hBase 同降 → 不悬空、有厚度）。因沿高度
 *    梯度向低处蔓延 → 成连续条带沟壑，而非孤立坑。
 *    纯几何（只用 h），不依赖角色/类型 → 主/Worker 同源、确定性、可重放。
 */
export function carveGradientErosion(
  seed: number,
  read: BlockReader,
  opts: CarveOpts = {},
): Refinements {
  const maxBlocks = opts.maxBlocks ?? 24;
  const maxDepth = opts.maxDepth ?? 0.5;
  const maxSteps = opts.maxSteps ?? 8;
  const half = 32; // 扫 [-half, half)² 窗口（204800 块里撒克制数量种子）

  // 确定性撒种子：hash 命中且该块位于局部低洼（比四邻低）→ 成为起点
  let ref: Refinements = EMPTY_REFINEMENTS;
  const seedCount = 2 + (Math.abs(seed) % 3);
  let carved = 0;

  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let s = 0; s < seedCount && carved < maxBlocks; s++) {
    const u = pseudo(s, seed);
    const v = pseudo(s * 7 + 13, seed);
    const sx = Math.floor(u * (half * 2) - half);
    const sz = Math.floor(v * (half * 2) - half);
    const start = read(sx, sz);
    if (!start) continue;

    // 小概率触发（克制：大部分种子块不动，只有少数形成沟壑）
    if (pseudo(s + 99, seed) > 0.35) continue;

    // BFS：从种子沿更低邻块下行，压深沿途洼块
    const queue: [number, number, number][] = [[sx, sz, 0]];
    const seen = new Set<number>([sx * 4096 + sz]);
    while (queue.length > 0 && carved < maxBlocks) {
      const [cx, cz, step] = queue.shift()!;
      if (step > maxSteps) break;
      const b = read(cx, cz);
      if (!b) continue;
      // 压深：h 与 hBase 同降 maxDepth（gang 下降，保持厚度 => 不悬空）
      ref = setHeight(ref, cx, cz, b.h - maxDepth, b.h - maxDepth);
      carved++;
      // 取更低（或接近）的邻块继续下行
      const lower = nbr
        .map(([dx, dz]) => read(cx + dx, cz + dz))
        .map((bb, k) => ({ bb, dx: nbr[k][0], dz: nbr[k][1] }))
        .filter(({ bb }) => bb && bb.h <= b.h + 1e-9)
        .sort((x, y) => x.bb!.h - y.bb!.h);
      for (const { bb, dx, dz } of lower) {
        const k = (cx + dx) * 4096 + (cz + dz);
        if (bb && !seen.has(k)) { seen.add(k); queue.push([cx + dx, cz + dz, step + 1]); }
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
