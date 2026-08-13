// ============================================================
// ChunkGenerator —— 地形生成（纯函数，零依赖，可单测）
// ============================================================
// generateChunk(seed, chunkX, chunkZ) → ChunkData（60×60 区域）
// ★ 方舟风块状地形：三类型 平地 / 高台 / 坑洞（≤5%）
//   - 两层 value noise（确定性 hash）→ 阈值分类（区域聚集，非碎斑）
//   - 元胞平滑：孤立碎块合并（邻域多数投票 1 轮）
//   - 高度：块基准（0 / 1.5 / -2）+ 每米微起伏 ±0.2（平地也有像素级落差）
//   - 确定性：同 (seed, chunkX, chunkZ) 永远同结果（每天地形一致，架构 3.8）
// 不 import three/rapier/播放器——纯数据生成。

/** chunk 尺寸（米） */
export const CHUNK_SIZE = 60;
/** 块尺寸（米）：15×15 块 */
export const BLOCK_SIZE = 4;
/** 每 chunk 块数 */
export const BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE;

/** 块类型 */
export const BLOCK_FLAT = 0;     // 平地
export const BLOCK_PLATFORM = 1; // 高台
export const BLOCK_PIT = 2;      // 坑洞（摔死）

/** 块基准高度 */
const BASE_HEIGHT = [0, 1.5, -2] as const;

/** 类型阈值（value noise 0-1） */
const T_PIT = 0.04;      // < 0.04 → 坑洞（≤5%）
const T_PLATFORM = 0.62; // > 0.62 → 高台（~30%）

export interface ChunkData {
  chunkX: number;
  chunkZ: number;
  /** 每米高度（60×60；块基准 + 微起伏） */
  heights: Float32Array;
  /** 块类型（15×15；0 平地 / 1 高台 / 2 坑洞） */
  blockTypes: Uint8Array;
  /** 每米阻挡高度（高台立面 = 平台高；射击 rayMarch / 行走阻挡用） */
  blockHeight: Float32Array;
  /** 每米可通行（坑洞 = 0） */
  walkable: Uint8Array;
}

// ============ 确定性 hash 噪声 ============

/** 整数 hash → [0,1)（确定性） */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** value noise（双线性插值 hash 场，scale = 网格间距） */
function valueNoise(x: number, z: number, seed: number, scale: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smooth(gx - x0);
  const fz = smooth(gz - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/** 两层噪声混合（大区域 + 细节） */
function terrainNoise(bx: number, bz: number, seed: number): number {
  const large = valueNoise(bx, bz, seed, 4.5);   // 大块区域
  const detail = valueNoise(bx, bz, seed + 7, 2); // 细节
  return large * 0.7 + detail * 0.3;
}

/** 每米微起伏（±0.2 的像素级落差） */
function microRelief(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed + 13, 1.5) - 0.5) * 0.4;
}

// ============ 生成 ============

/** ★ 生成 60×60 区域地形（确定性；★ 世界连续噪声场——
 *   块类型/微起伏全部用【世界坐标 + 全局 seed】采样，不做 chunk 级混合：
 *   相邻 chunk 边界共享同一噪声场 → 地形跨边界天然连续（无需事后修补）） */
export function generateChunk(seed: number, chunkX: number, chunkZ: number): ChunkData {
  // 世界块坐标起点（块类型场在世界空间连续）
  const wx0 = chunkX * BLOCKS_PER_SIDE;
  const wz0 = chunkZ * BLOCKS_PER_SIDE;

  // ① 块类型（两层噪声阈值分类；世界块坐标采样 → 边界连续）
  const blockTypes = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const n = terrainNoise(wx0 + bx, wz0 + bz, seed);
      blockTypes[bz * BLOCKS_PER_SIDE + bx] = n < T_PIT ? BLOCK_PIT : n > T_PLATFORM ? BLOCK_PLATFORM : BLOCK_FLAT;
    }
  }

  // ② 元胞平滑：孤立碎块合并（3×3 邻域多数投票，1 轮）
  //   ⚠ 仅本 chunk 内邻域（边界块与邻居 chunk 的关系由世界连续场保证，
  //     平滑只在 chunk 内做，不破坏跨 chunk 连续性）
  const smoothed = new Uint8Array(blockTypes);
  for (let bz = 1; bz < BLOCKS_PER_SIDE - 1; bz++) {
    for (let bx = 1; bx < BLOCKS_PER_SIDE - 1; bx++) {
      const self = blockTypes[bz * BLOCKS_PER_SIDE + bx];
      let same = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (blockTypes[(bz + dz) * BLOCKS_PER_SIDE + (bx + dx)] === self) same++;
        }
      }
      // 邻域内同类 < 4（孤立/边缘碎块）→ 并入周围最多数的类型
      if (same < 4) {
        const counts = [0, 0, 0];
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            counts[blockTypes[(bz + dz) * BLOCKS_PER_SIDE + (bx + dx)]]++;
          }
        }
        let best = BLOCK_FLAT;
        let bestCount = -1;
        for (let t = 0; t < 3; t++) {
          if (counts[t] > bestCount) {
            bestCount = counts[t];
            best = t;
          }
        }
        smoothed[bz * BLOCKS_PER_SIDE + bx] = best;
      }
    }
  }
  blockTypes.set(smoothed);

  // ③ 每米数据（高度 + 阻挡 + 可通行）
  const heights = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const blockHeight = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const walkable = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const bx = Math.floor(x / BLOCK_SIZE);
      const bz = Math.floor(z / BLOCK_SIZE);
      const t = blockTypes[bz * BLOCKS_PER_SIDE + bx];
      const base = BASE_HEIGHT[t];
      // ★ 微起伏：世界每米坐标 + 全局 seed（跨 chunk 连续 → 边界高度无缝）
      heights[z * CHUNK_SIZE + x] = base + microRelief(chunkX * CHUNK_SIZE + x, chunkZ * CHUNK_SIZE + z, seed);
      // 阻挡：高台 = 平台高（立面）；其他 0
      blockHeight[z * CHUNK_SIZE + x] = t === BLOCK_PLATFORM ? BASE_HEIGHT[BLOCK_PLATFORM] : 0;
      // 可通行：坑洞 = 0
      walkable[z * CHUNK_SIZE + x] = t === BLOCK_PIT ? 0 : 1;
    }
  }

  return { chunkX, chunkZ, heights, blockTypes, blockHeight, walkable };
}
