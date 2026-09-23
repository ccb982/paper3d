// ============================================================
// TerrainPalette —— HSL 颜色工具（地块基准色已迁至 Tiles 注册表）
// ============================================================
// 基准色的唯一权威来源 = services/map/Tiles.ts 的 TileDef.visual.baseHsl。
// 本文件只保留颜色空间工具，供 Tiles 与外观烘焙共用。
// ============================================================

export interface Hsl { h: number; s: number; l: number }

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
