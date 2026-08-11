// ============================================================
// MapGenerator —— 地图生成层（纯函数，零依赖）
// ============================================================
// 输入 (seed, 主题) → MapData。当前生成平地（heightmap 全 0）。
// 未来：噪声高度场（Perlin/Simplex 叠加），全部由 seed 确定性输出。
// 不 import three/rapier/播放器——可单测。

import type { MapData } from './MapData';

/** 平地占位地图（heightmap 全 0；地形算法就位后替换） */
export function generateFlatMap(seed: number, size = 64, theme = 'green_placeholder'): MapData {
  const heightmap = new Float32Array(size * size);
  // 占位：全 0 平地。未来：heightmap[y * size + x] = 噪声(x, z, seed)
  return { size, seed, theme, heightmap };
}
