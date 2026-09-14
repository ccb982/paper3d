// ============================================================
// CollectibleProps.ts —— 可采集植被（草丛/花丛/浆果丛/小树）
// ============================================================
// 2026-09-14 新增：地图里的采集元素。
//   · 声明走 MapEntityDecorBase 既有管线（planChunkProps 确定性散布 +
//     buildPropLayer 实例化渲染）——注册即自动接入 chunk 加载/卸载/挖坑重贴。
//   · ★ 全部无 physics：不建 rapier 刚体、不进 StaticObstacleRegistry；
//     可查询性由 ChunkManager.createDecorColliders 的"全量 propRegistry 登记"提供。
//   · 采集交互（E 键）见 WorldMode.nearbyCollectible：就近查询 → 入包 + 标记已采。
//   · 掉落表（COLLECTIBLE_DROPS）是唯一内容出口：加新采集物 = 注册 + 加一行。
//
// 密度口径（2026-09-14 修正后）：出现判定按【本格可用池】的 perCellProb 求和，
// 抽中谁按各自 perCellProb 加权 → 每种装饰的期望密度 = 自身 perCellProb。
// 花草只长在 ground 角色，晶簇 ground+platform 兼得 → 晶簇出现率不受花草影响
// （高台格可用池只有晶簇 → 仍为 0.5%/格，与加花草前完全一致）。
// 本文件总密度 ≈ 0.103/ground 格 → 平均每 chunk 约 40 株植被。
// ============================================================

import { FOUNDATION_PROP_GROUP, MapEntityDecorBase, registerMapDecor } from './MapEntityDecorBase';

/** 采集掉落：itemId + 数量区间（采集时掷） */
export interface CollectibleDrop {
  itemId: string;
  min: number;
  max: number;
}

/** 采集物显示名（提示文案用） */
export const COLLECTIBLE_LABELS: Record<string, string> = {
  herb_grass: '药草丛',
  flower_bloom: '野花',
  berry_bush: '浆果丛',
  young_tree: '小树',
};

/** 采集掉落表（key → 产出） */
export const COLLECTIBLE_DROPS: Record<string, CollectibleDrop> = {
  herb_grass: { itemId: 'herb', min: 1, max: 2 },
  flower_bloom: { itemId: 'herb', min: 1, max: 1 },
  berry_bush: { itemId: 'berry', min: 1, max: 2 },
  young_tree: { itemId: 'wood', min: 1, max: 3 },
};

export function isCollectibleKey(key: string): boolean {
  return key in COLLECTIBLE_DROPS;
}

export function collectibleDropOf(key: string): CollectibleDrop | null {
  return COLLECTIBLE_DROPS[key] ?? null;
}

export function collectibleLabelOf(key: string): string {
  return COLLECTIBLE_LABELS[key] ?? key;
}

// ============================================================
// 植被声明（全部 foundation 组 = 任意风格 chunk 都可出现；只长在地面角色）
// ============================================================

/** 药草丛：最常见，低矮细叶 */
registerMapDecor(new MapEntityDecorBase({
  key: 'herb_grass', label: '药草丛', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground'], perCellProb: 0.050,
    scaleRange: [0.8, 1.5], sinkRange: [0.02, 0.06],
  },
  render: 'instanced', shadow: 'none',
  variantCount: 1,
  lod: true,
  geometry: { type: 'grass', params: { vertexColors: 1, doubleSide: 1 } },
}));

/** 野花：花茎 + 彩色花冠（每 key 共享材质色，顶点色描述花瓣/茎干） */
registerMapDecor(new MapEntityDecorBase({
  key: 'flower_bloom', label: '野花', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground'], perCellProb: 0.030,
    scaleRange: [0.8, 1.25], sinkRange: [0.02, 0.05],
  },
  render: 'instanced', shadow: 'none',
  variantCount: 2,
  lod: true,
  geometry: { type: 'flower', params: { vertexColors: 1, doubleSide: 1, color2: 0xdb7099 } },
}));

/** 浆果丛：低矮叶球 + 红果 */
registerMapDecor(new MapEntityDecorBase({
  key: 'berry_bush', label: '浆果丛', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground'], perCellProb: 0.015,
    scaleRange: [0.9, 1.4], sinkRange: [0.03, 0.08],
  },
  render: 'instanced', shadow: 'none',
  variantCount: 2,
  lod: true,
  geometry: { type: 'bush', params: { vertexColors: 1, doubleSide: 1, color2: 0xc23b2e } },
}));

/** 小树：树干 + 三层锥冠（稀疏，地标感） */
registerMapDecor(new MapEntityDecorBase({
  key: 'young_tree', label: '小树', groups: [FOUNDATION_PROP_GROUP],
  placement: {
    hostRole: ['ground'], perCellProb: 0.008,
    scaleRange: [0.9, 1.6], sinkRange: [0.04, 0.10],
  },
  render: 'instanced', shadow: 'none',
  variantCount: 3,
  lod: true,
  geometry: { type: 'tree', params: { vertexColors: 1, doubleSide: 1 } },
}));
