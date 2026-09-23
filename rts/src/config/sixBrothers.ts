// ============================================================
// sixBrothers.ts —— 六区兄弟（六种基础合成材料）配置
// ============================================================
// 六区兄弟 = 六种最基础的合成材料，同源打包在
// src/assets/textures/六区兄弟.ftx3.gz（6 帧，帧序即下表 frame）。
// id/name 与 items.json 一一对应；此处是唯一的「id ↔ 帧序」映射表，
// 供图标系统（BasicMaterialsIcons）与开荒种子（Session）复用。
// ============================================================

export interface SixBrotherMaterial {
  id: string;
  name: string;
  /** 六区兄弟.ftx3.gz 中的帧索引 */
  frame: number;
}

export const SIX_BROTHERS: SixBrotherMaterial[] = [
  { id: 'raw_rock',   name: '固原岩', frame: 0 },
  { id: 'polyester',  name: '聚酸酯', frame: 1 },
  { id: 'sugar',      name: '糖',     frame: 2 },
  { id: 'iron_grain', name: '异铁',   frame: 3 },
  { id: 'ketone',     name: '酮凝集', frame: 4 },
  { id: 'device',     name: '装置',   frame: 5 },
];

export const SIX_BROTHER_MATERIAL_IDS = SIX_BROTHERS.map((b) => b.id);