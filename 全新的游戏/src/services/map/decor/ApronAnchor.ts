// ============================================================
// ApronAnchor —— 石围裙锚点判定（共享常量 + 确定性哈希；零 three 依赖）
// ============================================================
// PlatformApron（装饰几何构建）与 Refinements.planRefinements（地形产坡
// 保护）必须对「某块是否围裙锚点」永远同判：
//   - 地形期：锚点相关块的周界边跳过 30% 产坡骰 → 围裙环边恒 cliff；
//   - 装饰期：锚点成环、并块、防叠环。
// 两侧只共享本文件（纯函数，主线程/Worker 同一份）。
// 掷点绑定【世界块坐标 + 种子】→ 相邻 chunk、两期构建恒同值。
// ============================================================

import { hash2 } from '../TerrainNoise';

/** 锚点概率（2026-09-06 调高：围裙用在 50% 的沙土高台上） */
export const APRON_ANCHOR_P = 0.50;

/** 锚点哈希盐（跨模块一致性关键，勿改） */
export const APRON_ANCHOR_SALT = 7717;

/**
 * 锚点掷点（世界块坐标确定性哈希）。
 * 锚点 = platform_sand 块 且 本值 < APRON_ANCHOR_P。
 */
export function apronAnchorRoll(wbx: number, wbz: number, seed: number): number {
  return hash2(wbx, wbz, seed + APRON_ANCHOR_SALT);
}
