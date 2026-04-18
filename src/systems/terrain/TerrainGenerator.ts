import { createNoise2D } from 'simplex-noise';

export interface TerrainData {
  width: number;
  depth: number;
  segments: number;
  heights: number[][];
  getHeightAt: (x: number, z: number) => number;
}

export interface TerrainParams {
  width: number;
  depth: number;
  segments: number;
  seed?: number;
  heightScale: number;
  noiseScale: number;
  octaves?: number;
}

export const generateTerrain = (params: TerrainParams): TerrainData => {
  const {
    width,
    depth,
    segments,
    seed = Math.random() * 10000,
    heightScale,
    noiseScale,
    octaves = 4
  } = params;

  const noise2D = createNoise2D(() => seed / 10000);
  
  const heights: number[][] = [];
  
  for (let i = 0; i <= segments; i++) {
    heights[i] = [];
    for (let j = 0; j <= segments; j++) {
      const x = (j / segments - 0.5) * width;
      const z = (i / segments - 0.5) * depth;
      
      let height = 0;
      let amplitude = 1;
      let frequency = 1;
      let maxValue = 0;
      
      for (let o = 0; o < octaves; o++) {
        height += noise2D(x * noiseScale * frequency, z * noiseScale * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      
      // 调整高度分布，使地形以平原为主（占50%左右）
      // 使用平滑函数，让更多区域保持在低高度
      height = (height / maxValue);
      // 应用平滑曲线，增强平原区域
      height = Math.pow(height, 2); // 平方函数，使低高度区域更集中
      // 调整高度范围，使平原占比增加
      
      height = height * heightScale;
      heights[i][j] = height;
    }
  }
  
  const getHeightAt = (x: number, z: number): number => {
    const normalizedX = (x / width + 0.5) * segments;
    const normalizedZ = (z / depth + 0.5) * segments;
    
    // 限制坐标范围，防止越界
    if (normalizedX < 0 || normalizedX > segments || normalizedZ < 0 || normalizedZ > segments) {
      return 0;
    }
    
    const i = Math.floor(normalizedZ);
    const j = Math.floor(normalizedX);
    
    const clampedI = Math.max(0, Math.min(segments - 1, i));
    const clampedJ = Math.max(0, Math.min(segments - 1, j));
    const clampedI1 = Math.max(0, Math.min(segments, i + 1));
    const clampedJ1 = Math.max(0, Math.min(segments, j + 1));
    
    const fracX = normalizedX - j;
    const fracZ = normalizedZ - i;
    
    const h00 = heights[clampedI][clampedJ];
    const h10 = heights[clampedI][clampedJ1];
    const h01 = heights[clampedI1][clampedJ];
    const h11 = heights[clampedI1][clampedJ1];
    
    const h0 = h00 * (1 - fracX) + h10 * fracX;
    const h1 = h01 * (1 - fracX) + h11 * fracX;
    
    return h0 * (1 - fracZ) + h1 * fracZ;
  };
  
  return {
    width,
    depth,
    segments,
    heights,
    getHeightAt
  };
};
