// ============================================================
// ChunkGenerator —— 地形生成（模板驱动，零依赖，可单测）
// ============================================================
// ★ 新架构：用"战术竞技场模板"替代 Perlin 噪声随机填色。
//   每个 Chunk 从 5 种模板中确定性地选一种，生成有明确
//   战术意图的立体战场。
//
// 设计（2026-08-19 重构）：
//   ① 模板系统：5 种竞技场布局，每种有明确的高低差/视野遮挡/陷阱
//   ② 平滑斜坡：高台/坑洞边缘自动生成 2-3 格宽缓坡（30°-45°）
//   ③ 连接走廊：chunk 边界强制平坦，相邻 chunk 无缝衔接
//   ④ 地形变异：随机叠加特殊区域（地刺/加速/迷雾/重力）
//   ⑤ 确定性：同 (seed, chunkX, chunkZ) 永远同结果
// ============================================================

/** chunk 尺寸（米） */
export const CHUNK_SIZE = 60;
/** 块尺寸（米）：15×15 块 */
export const BLOCK_SIZE = 4;
/** 每 chunk 块数 */
export const BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE; // 15

// ============ 块类型（保持与旧版兼容） ============
export const BLOCK_FLAT = 0;     // 平地
export const BLOCK_PLATFORM = 1; // 高台
export const BLOCK_PIT = 2;      // 坑洞
export const BLOCK_SLOPE = 3;    // 斜坡（新增：高台/坑洞边缘过渡）

// ============ 模板枚举 ============
export type ArenaTemplate = 'ring' | 'cross_bridge' | 'pillar_forest' | 'cliff_rift' | 'three_tier';
const TEMPLATES: ArenaTemplate[] = ['ring', 'cross_bridge', 'pillar_forest', 'cliff_rift', 'three_tier'];

// ============ 特殊区域类型 ============
export type SpecialZoneType = 'spike' | 'speed_boost' | 'gravity_anomaly' | 'fog';

export interface SpecialZone {
  type: SpecialZoneType;
  x: number; z: number;  // 世界坐标中心
  radius: number;        // 作用半径（米）
}

// ============ ChunkData（保持接口兼容） ============
export interface ChunkData {
  chunkX: number;
  chunkZ: number;
  /** 模板名称 */
  template: ArenaTemplate;
  /** 模板旋转（0/90/180/270 度） */
  rotation: number;
  /** 每米高度（60×60；含平滑斜坡） */
  heights: Float32Array;
  /** 块类型（15×15；0 平地 / 1 高台 / 2 坑洞 / 3 斜坡） */
  blockTypes: Uint8Array;
  /** 每米阻挡高度（高台立面 = 台面高；射击 rayMarch / 行走阻挡用） */
  blockHeight: Float32Array;
  /** 每米可通行（坑洞 = 0；斜坡/高台 = 1） */
  walkable: Uint8Array;
  /** 特殊区域（地形变异） */
  specialZones: SpecialZone[];
}

// ============ 确定性 hash 噪声 ============

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ============ 模板选择 ============

function selectTemplate(seed: number, cx: number, cz: number): { template: ArenaTemplate; rotation: number } {
  const idx = Math.floor(hash2(cx, cz, seed + 777) * TEMPLATES.length);
  const rot = Math.floor(hash2(cx + 1, cz + 1, seed + 333) * 4) * 90;
  return { template: TEMPLATES[idx], rotation: rot };
}

// ============ 模板定义：生成 15×15 块目标高度 ============

/** 每个模板生成一个 15×15 的目标高度网格（米） */
type BlockHeightGrid = Float32Array; // 15×15

const HALF = BLOCKS_PER_SIDE / 2; // 7.5

/** 环形剧场：中心下沉坑洞 → 平地 → 缓坡 → 环状高台 → 缓坡 → 平地 */
function genRing(seed: number, cx: number, cz: number): BlockHeightGrid {
  const grid = new Float32Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const dist = Math.hypot(bx - HALF + 0.5, bz - HALF + 0.5);
      if (dist < 2.5) {
        // 中心坑洞（-2m）
        grid[bz * BLOCKS_PER_SIDE + bx] = -2;
      } else if (dist < 4.5) {
        // 平地过渡区
        grid[bz * BLOCKS_PER_SIDE + bx] = 0;
      } else if (dist < 6.5) {
        // 斜坡（0 → 1.5）
        const t = (dist - 4.5) / 2;
        grid[bz * BLOCKS_PER_SIDE + bx] = t * 1.5;
      } else if (dist < 9.5) {
        // 高台环
        grid[bz * BLOCKS_PER_SIDE + bx] = 1.5;
      } else if (dist < 11.5) {
        // 斜坡（1.5 → 0）
        const t = (dist - 9.5) / 2;
        grid[bz * BLOCKS_PER_SIDE + bx] = 1.5 * (1 - t);
      } else {
        // 边缘平地
        grid[bz * BLOCKS_PER_SIDE + bx] = 0;
      }
    }
  }
  // 强制边界一圈为平地（连接走廊）
  enforceFlatEdges(grid);
  return grid;
}

/** 十字天桥：中央十字形高架桥 + 四角缓坡 + 下方平地通道 */
function genCrossBridge(seed: number, cx: number, cz: number): BlockHeightGrid {
  const grid = new Float32Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const bridgeW = 2; // 桥宽 2 块
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const dx = Math.abs(bx - HALF + 0.5);
      const dz = Math.abs(bz - HALF + 0.5);
      // 十字桥：沿 X 轴或 Z 轴
      const onBridge = (dx <= bridgeW / 2 || dz <= bridgeW / 2);
      // 四角斜坡入口：距离十字中心 3-4 块
      const nearBridge = (dx > bridgeW / 2 && dz > bridgeW / 2 &&
        dx < 4 && dz < 4);
      if (onBridge) {
        grid[bz * BLOCKS_PER_SIDE + bx] = 2.0; // 桥面 +2m
      } else if (nearBridge) {
        // 斜坡过渡
        const dist = Math.max(dx, dz) - bridgeW / 2;
        const t = Math.min(1, dist / 2);
        grid[bz * BLOCKS_PER_SIDE + bx] = 2.0 * (1 - t);
      } else {
        grid[bz * BLOCKS_PER_SIDE + bx] = 0; // 平地
      }
    }
  }
  enforceFlatEdges(grid);
  return grid;
}

/** 柱林掩体：6-8 个方形柱均匀分布 */
function genPillarForest(seed: number, cx: number, cz: number): BlockHeightGrid {
  const grid = new Float32Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  // 初始全部平地
  grid.fill(0);
  // 生成 7 个柱子（确定性位置）
  const pillarPositions: [number, number][] = [
    [2, 2], [2, 7], [2, 12],
    [7, 2], [7, 7], [7, 12],
    [12, 2], [12, 7], [12, 12],
  ];
  // 随机选取 7 个（确定性）
  const count = 7;
  const selected = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(hash2(i, cx * 100 + cz, seed + 555) * pillarPositions.length);
    selected.add(idx);
  }
  const pillarSize = 1.5; // 柱宽 1.5 块（6m）
  for (const idx of selected) {
    const [px, pz] = pillarPositions[idx];
    for (let bz = Math.max(0, Math.floor(pz - pillarSize / 2)); bz <= Math.min(14, Math.ceil(pz + pillarSize / 2)); bz++) {
      for (let bx = Math.max(0, Math.floor(px - pillarSize / 2)); bx <= Math.min(14, Math.ceil(px + pillarSize / 2)); bx++) {
        const dist = Math.hypot(bx - px, bz - pz);
        if (dist <= pillarSize / 2) {
          grid[bz * BLOCKS_PER_SIDE + bx] = 1.5; // 柱顶 +1.5m
        } else if (dist <= pillarSize / 2 + 1) {
          // 斜坡过渡
          const t = (dist - pillarSize / 2);
          grid[bz * BLOCKS_PER_SIDE + bx] = 1.5 * (1 - t);
        }
      }
    }
  }
  enforceFlatEdges(grid);
  return grid;
}

/** 断崖裂隙：中央横贯深坑 + 两座独木桥 */
function genCliffRift(seed: number, cx: number, cz: number): BlockHeightGrid {
  const grid = new Float32Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const riftZ = HALF; // 裂隙在 Z 轴中央
  const riftW = 2;    // 裂隙宽 2 块（8m）
  const bridgeX1 = 3; // 第一座桥 X 位置（块坐标）
  const bridgeX2 = 11; // 第二座桥 X 位置
  const bridgeW = 1.5; // 桥宽 1.5 块

  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const dz = Math.abs(bz - riftZ);
      // 是否在裂隙范围内
      if (dz <= riftW / 2) {
        // 是否在桥上
        const onBridge = (Math.abs(bx - bridgeX1) <= bridgeW / 2) ||
          (Math.abs(bx - bridgeX2) <= bridgeW / 2);
        if (onBridge) {
          grid[bz * BLOCKS_PER_SIDE + bx] = 0; // 桥面 = 平地
        } else {
          grid[bz * BLOCKS_PER_SIDE + bx] = -5; // 深坑（秒杀）
        }
      } else if (dz <= riftW / 2 + 1) {
        // 坑边缓坡
        if (grid[bz * BLOCKS_PER_SIDE + bx] !== -5) {
          grid[bz * BLOCKS_PER_SIDE + bx] = 0;
        }
      } else {
        grid[bz * BLOCKS_PER_SIDE + bx] = 0; // 平地
      }
    }
  }
  enforceFlatEdges(grid);
  return grid;
}

/** 三阶平台：从低到高分为三层，层间缓坡 */
function genThreeTier(seed: number, cx: number, cz: number): BlockHeightGrid {
  const grid = new Float32Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const center = HALF;
  const tierR = [3, 5, 7]; // 每层半径（内到外）
  const tierH = [0, 2, 4]; // 每层高度

  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const dist = Math.hypot(bx - center + 0.5, bz - center + 0.5);
      if (dist < tierR[0]) {
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[0]; // 底层（地面）
      } else if (dist < tierR[0] + 1) {
        // 斜坡：0 → 2
        const t = (dist - tierR[0]) / 1;
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[0] + (tierH[1] - tierH[0]) * t;
      } else if (dist < tierR[1]) {
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[1]; // 中层 +2m
      } else if (dist < tierR[1] + 1) {
        // 斜坡：2 → 4
        const t = (dist - tierR[1]) / 1;
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[1] + (tierH[2] - tierH[1]) * t;
      } else if (dist < tierR[2]) {
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[2]; // 顶层 +4m
      } else if (dist < tierR[2] + 1) {
        // 斜坡：4 → 0
        const t = (dist - tierR[2]) / 1;
        grid[bz * BLOCKS_PER_SIDE + bx] = tierH[2] * (1 - t);
      } else {
        grid[bz * BLOCKS_PER_SIDE + bx] = 0; // 平地
      }
    }
  }
  enforceFlatEdges(grid);
  return grid;
}

/** 模板生成函数映射 */
const TEMPLATE_GENS: Record<ArenaTemplate, (seed: number, cx: number, cz: number) => BlockHeightGrid> = {
  ring: genRing,
  cross_bridge: genCrossBridge,
  pillar_forest: genPillarForest,
  cliff_rift: genCliffRift,
  three_tier: genThreeTier,
};

// ============ 辅助函数 ============

/** 强制 chunk 边界一圈为平地（连接走廊） */
function enforceFlatEdges(grid: BlockHeightGrid): void {
  const SIDE = BLOCKS_PER_SIDE; // 15
  const EDGE = 1; // 边界 1 块宽
  for (let i = 0; i < SIDE; i++) {
    for (let e = 0; e < EDGE; e++) {
      grid[e * SIDE + i] = 0;      // 上边
      grid[(SIDE - 1 - e) * SIDE + i] = 0; // 下边
      grid[i * SIDE + e] = 0;      // 左边
      grid[i * SIDE + (SIDE - 1 - e)] = 0; // 右边
    }
  }
}

/** 微起伏（±0.2m 的像素级落差，世界坐标连续） */
function microRelief(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed + 13, 1.5) - 0.5) * 0.4;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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

/** 将 15×15 块高度网格展开为 60×60 每米高度，带平滑插值 */
function expandToPerMeter(blockGrid: BlockHeightGrid, seed: number, wx: number, wz: number): Float32Array {
  const heights = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const SIDE = BLOCKS_PER_SIDE; // 15
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      // 块坐标（浮点）
      const bf = x / BLOCK_SIZE;
      const bz = z / BLOCK_SIZE;
      const bx0 = Math.floor(bf);
      const bz0 = Math.floor(bz);
      const bx1 = Math.min(bx0 + 1, SIDE - 1);
      const bz1 = Math.min(bz0 + 1, SIDE - 1);
      const fx = bf - bx0;
      const fz = bz - bz0;
      // 双线性插值块高度
      const h00 = blockGrid[bz0 * SIDE + bx0];
      const h10 = blockGrid[bz0 * SIDE + bx1];
      const h01 = blockGrid[bz1 * SIDE + bx0];
      const h11 = blockGrid[bz1 * SIDE + bx1];
      const h = lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
      // 加微起伏
      heights[z * CHUNK_SIZE + x] = h + microRelief(wx + x, wz + z, seed);
    }
  }
  return heights;
}

/** 从高度网格推导块类型（15×15） */
function deriveBlockTypes(heights: Float32Array): Uint8Array {
  const blockTypes = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      // 采样块中心高度
      const cx = Math.floor((bx + 0.5) * BLOCK_SIZE);
      const cz = Math.floor((bz + 0.5) * BLOCK_SIZE);
      const h = heights[cz * CHUNK_SIZE + cx];
      const maxH = Math.max(
        heights[cz * CHUNK_SIZE + Math.floor(bx * BLOCK_SIZE)],
        heights[cz * CHUNK_SIZE + Math.min(Math.floor((bx + 1) * BLOCK_SIZE), CHUNK_SIZE - 1)],
        heights[Math.floor(bz * BLOCK_SIZE) * CHUNK_SIZE + cx],
        heights[Math.min(Math.floor((bz + 1) * BLOCK_SIZE), CHUNK_SIZE - 1) * CHUNK_SIZE + cx],
      );
      if (h < -1) {
        blockTypes[bz * BLOCKS_PER_SIDE + bx] = BLOCK_PIT;
      } else if (maxH > 0.5) {
        // 有隆起 → 检查是否斜坡
        const minH = Math.min(
          heights[cz * CHUNK_SIZE + Math.floor(bx * BLOCK_SIZE)],
          heights[cz * CHUNK_SIZE + Math.min(Math.floor((bx + 1) * BLOCK_SIZE), CHUNK_SIZE - 1)],
          heights[Math.floor(bz * BLOCK_SIZE) * CHUNK_SIZE + cx],
          heights[Math.min(Math.floor((bz + 1) * BLOCK_SIZE), CHUNK_SIZE - 1) * CHUNK_SIZE + cx],
        );
        const diff = maxH - minH;
        if (diff > 0.3 && diff < 1.2) {
          blockTypes[bz * BLOCKS_PER_SIDE + bx] = BLOCK_SLOPE;
        } else {
          blockTypes[bz * BLOCKS_PER_SIDE + bx] = BLOCK_PLATFORM;
        }
      } else {
        blockTypes[bz * BLOCKS_PER_SIDE + bx] = BLOCK_FLAT;
      }
    }
  }
  return blockTypes;
}

/** 生成特殊区域（地形变异） */
function generateSpecialZones(seed: number, cx: number, cz: number): SpecialZone[] {
  const zones: SpecialZone[] = [];
  // 60% 概率有特殊区域
  if (hash2(cx, cz, seed + 999) > 0.4) {
    const types: SpecialZoneType[] = ['spike', 'speed_boost', 'gravity_anomaly', 'fog'];
    const typeIdx = Math.floor(hash2(cx + 5, cz + 7, seed + 888) * types.length);
    const zone: SpecialZone = {
      type: types[typeIdx],
      x: cx * CHUNK_SIZE + hash2(cx + 3, cz + 5, seed + 777) * CHUNK_SIZE,
      z: cz * CHUNK_SIZE + hash2(cx + 7, cz + 3, seed + 777) * CHUNK_SIZE,
      radius: 5 + hash2(cx + 11, cz + 13, seed + 666) * 8,
    };
    // 确保不在坑洞里
    zones.push(zone);
  }
  return zones;
}

// ============ 主入口 ============

/** ★ 生成 60×60 区域地形（确定性） */
export function generateChunk(seed: number, chunkX: number, chunkZ: number): ChunkData {
  // ① 选择模板
  const { template, rotation } = selectTemplate(seed, chunkX, chunkZ);

  // ② 生成块高度网格
  const genFn = TEMPLATE_GENS[template];
  const blockGrid = genFn(seed, chunkX, chunkZ);

  // ★ 出生安全区：chunk(0,0) 中心 6×6 块强制平地（玩家出生/摔死传送点，保证无坑洞/高台）
  if (chunkX === 0 && chunkZ === 0) {
    for (let bz = 6; bz <= 11; bz++) {
      for (let bx = 6; bx <= 11; bx++) {
        blockGrid[bz * BLOCKS_PER_SIDE + bx] = 0;
      }
    }
  }

  // ③ 展开为每米高度（带平滑插值）
  const wx = chunkX * CHUNK_SIZE;
  const wz = chunkZ * CHUNK_SIZE;
  const heights = expandToPerMeter(blockGrid, seed, wx, wz);

  // ④ 推导块类型
  const blockTypes = deriveBlockTypes(heights);

  // ⑤ 每米数据（阻挡高度 + 可通行）
  const blockHeight = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const walkable = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const h = heights[z * CHUNK_SIZE + x];
      const bx = Math.floor(x / BLOCK_SIZE);
      const bz = Math.floor(z / BLOCK_SIZE);
      const bt = blockTypes[bz * BLOCKS_PER_SIDE + bx];
      // 阻挡高度：高台 = 台面高（立面）；斜坡 = 0（可走上）
      if (bt === BLOCK_PLATFORM) {
        blockHeight[z * CHUNK_SIZE + x] = 1.5;
      } else {
        blockHeight[z * CHUNK_SIZE + x] = 0;
      }
      // 可通行：坑洞 = 0；斜坡/高台 = 1
      walkable[z * CHUNK_SIZE + x] = (bt === BLOCK_PIT && h < -1) ? 0 : 1;
    }
  }

  // ⑥ 特殊区域
  const specialZones = generateSpecialZones(seed, chunkX, chunkZ);

  return {
    chunkX, chunkZ,
    template, rotation,
    heights, blockTypes, blockHeight, walkable,
    specialZones,
  };
}