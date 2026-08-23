// ============================================================
// TerrainPalette —— 地形基础调色板（唯一权威来源）
// ============================================================
// 基准色由美术拍板（2026-08-23）：
//   地面   RGB(154,114,72)  = HSL(0.0854, 0.3628, 0.4431)
//   高台顶 RGB(193,143,103) = HSL(0.0741, 0.4206, 0.5804)
// 消费方：
//   - RasterMap.terrainColorAt → 小地图等用【纯净基准色】
//   - ChunkAppearance.bake    → 地表渲染在基准色上做【逐地块随机抖动】
//     （方块感来源；小地图不加抖动，保证可读性）
// ============================================================

export interface Hsl { h: number; s: number; l: number }

/** 基准色（HSL 空间；抖动在 H/S/L 上做最自然）
 *  ⚠️ 取值已经过 ACES 色调映射补偿：ACES 会压暗暗部（toe 区域），
 *     低亮度基准色会直接被砸成黑色。凹陷类亮度取"烘完仍可辨色"的区间 */
export const TERRAIN_BASE_HSL = {
  /** 平地/路：棕褐 */
  flat:     { h: 0.0854, s: 0.3628, l: 0.4431 },
  /** 高台上部：浅棕 */
  platform: { h: 0.0741, s: 0.4206, l: 0.5804 },
  /** 坑洞：暗血红警示（致命但可辨识；纯黑会与阴影混为一体） */
  pit:      { h: 0.9800, s: 0.6000, l: 0.2200 },
  /** 水域：可辨识深蓝（未来独立水面网格） */
  water:    { h: 0.5800, s: 0.5200, l: 0.3000 },
} satisfies Record<string, Hsl>;

/** 标准CSS式 HSL→RGB（输出 0~255，显示空间 sRGB） */
export function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}
