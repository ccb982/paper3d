// ============================================================
// TerrainNoise —— 地形域共享噪声底座（hash2 / vnoise）
// ============================================================
// 从 ChunkGenerator 抽出：RegionTheme / ChunkGenerator / bakeCompute
// 都要消费，且互相之间不能形成 import 环（ChunkGenerator ↔ RegionTheme
// 双向需要对方）。本文件是地图侧最底层模块，不依赖任何邻居。

/** 确定性 hash 噪声（输出 0~1）。⚠️ 常量与历史版本逐位一致——
 *  改任何一个数 = 全世界地形重洗，存档里已生成的地图记忆全部失效 */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 平滑值噪声（双线性 + smoothstep），空间连续——用于需要"成片"效果的场景 */
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash2(a, b, seed);
  const top = h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx;
  const bot = h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx;
  return top * (1 - sy) + bot * sy;
}
