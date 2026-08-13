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

/** ★ region 尺寸（块）：3×3 块一个区域。chunk 15 块 = 5×5 region（15%3==0）
 *   → region 边界与 chunk 边界对齐 → 高台/坑洞区域【永不跨 chunk 切半】，
 *     同一 region 的块无论落在哪个 chunk 类型完全一致（完整生成） */
const REGION = 3;

/** 块基准高度 */
const BASE_HEIGHT = [0, 1.5, -2] as const;

/** 类型阈值（hash 0-1） */
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

/** 每米微起伏（±0.2 的像素级落差；★ 导出：边界修正降块时重算平地高度） */
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

  // ① 块类型 = region 类型（★ 跨 chunk 完整生成）：
  //   region（3×3 块）类型由【region 世界坐标】确定性 hash 决定。
  //   ★ 严丝合缝保证：chunk 边界一圈 region【强制平地】——
  //     高台/坑洞只出现在 chunk 内部（中间 3×3 region），
  //     缝两侧永远是"平地对平地"→ 不存在边界截断/半块高台/角色站虚空
  const blockTypes = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const REGIONS = BLOCKS_PER_SIDE / REGION; // 5
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const rx = Math.floor((wx0 + bx) / REGION);
      const rz = Math.floor((wz0 + bz) / REGION);
      // region 在本 chunk 内的索引（0..4）
      const lrx = rx - Math.floor(wx0 / REGION);
      const lrz = rz - Math.floor(wz0 / REGION);
      // ★ 边界 region（贴 chunk 边缘一圈）→ 强制平地（严丝合缝）
      if (lrx === 0 || lrx === REGIONS - 1 || lrz === 0 || lrz === REGIONS - 1) {
        blockTypes[bz * BLOCKS_PER_SIDE + bx] = BLOCK_FLAT;
        continue;
      }
      const n = hash2(rx, rz, seed);
      blockTypes[bz * BLOCKS_PER_SIDE + bx] = n < T_PIT ? BLOCK_PIT : n > T_PLATFORM ? BLOCK_PLATFORM : BLOCK_FLAT;
    }
  }

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
