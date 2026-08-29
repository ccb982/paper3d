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

import type { BlockSource, EdgeRuling } from './SurfaceRules';

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

/** 精修意图：块 (bx,bz) 上四条边的显式裁决表 */
export interface Refinements {
  /** 确定性精修索引：世界块坐标 → 该块四条边的显式裁决 */
  edgeOverrides: Map<string, EdgeOverride>;
}

/** 空精修（恒透传，≡ 旧世界） */
export const EMPTY_REFINEMENTS: Refinements = { edgeOverrides: new Map() };

function edgeKey(bx: number, bz: number, dir: 0 | 1 | 2 | 3): string {
  return `${bx},${bz},${dir}`;
}

/** ★ 依据 seed 生成精修意图（当前为空实现 = 恒空；未来在这里铺精修规则） */
export function planRefinements(_seed: number): Refinements {
  return EMPTY_REFINEMENTS;
}

/**
 * ★ 精修层核心：把一块 BlockSource 包装为「精修后的 BlockSource」。
 *  - 空精修：不设 edgeFinal → finalRuling 落回默认引擎 → 与旧地形逐位一致。
 *  - 有精修：edgeFinal 对显式条目返回钉死裁决，其余回落默认引擎。
 * 主线程（RasterMap.surfaceBlocks 等）与 Worker（makeSnapshotSource）
 * 用同一函数包装 → 逐位同源自构造保证。
 */
export function refine(src: BlockSource, ref: Refinements): BlockSource {
  if (ref.edgeOverrides.size === 0) return src;
  return {
    ...src,
    edgeFinal(bx: number, bz: number, dir: 0 | 1 | 2 | 3): EdgeRuling | undefined {
      return ref.edgeOverrides.get(edgeKey(bx, bz, dir))?.ruling;
    },
  };
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
  return { edgeOverrides: next };
}
