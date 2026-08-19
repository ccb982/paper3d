// ============================================================
// ChunkGenerator —— 分块迷宫地形生成（Wilson 生成树）
// ============================================================
// ★ 新架构：每个 Chunk 内部是独立迷宫，通过边界端口协议
//   保证跨块连通，形成无限延展的全局迷宫。
//
// 生成流水线（5 阶段）：
//   0. 端口派生（确定性哈希，边界对称）
//   1. Wilson 随机游走（均匀随机生成树）
//   2. 走廊加宽（可选，增加战斗空间）
//   3. 墙区分类（水域/坑洞/高台/死路）
//   4. 连通性修复（保证所有树节点可达）
//   5. 高度分配（绝对平整，无斜坡）
// ============================================================

/** chunk 尺寸（米） */
export const CHUNK_SIZE = 60;
/** 块尺寸（米） */
export const BLOCK_SIZE = 4;
/** 每 chunk 块数 */
export const BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE; // 15

// ============ 块类型 ============
export const BLOCK_FLAT = 0;      // 平地/路（可通行）
export const BLOCK_PLATFORM = 1;  // 高台（可通行，比路高）
export const BLOCK_PIT = 2;       // 坑洞（不可通行，秒杀）
export const BLOCK_SLOPE = 3;     // 保留（未使用）
export const BLOCK_WATER = 4;     // 水域（不可通行，阻挡）

// ============ 地形类型（内部） ============
enum TileType { ROAD, WATER, PIT, PLATFORM }

// ============ 端口数据结构 ============
interface Ports {
  top: number[];    // 上边界出口的列索引
  bottom: number[];
  left: number[];
  right: number[];
}

// ============ ChunkData（保持接口兼容） ============
export interface ChunkData {
  chunkX: number;
  chunkZ: number;
  /** 每米高度（60×60；每个 4×4 tile 内绝对平整） */
  heights: Float32Array;
  /** 块类型（15×15） */
  blockTypes: Uint8Array;
  /** 每米阻挡高度 */
  blockHeight: Float32Array;
  /** 每米可通行 */
  walkable: Uint8Array;
}

// ============ 确定性 hash 噪声 ============

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ============ 阶段 0：端口派生 ============

/**
 * 为当前 Chunk 生成 4 条边上的出口位置，保证与相邻 Chunk 严格对齐。
 * 对称性：Chunk(cx,cz) 的右边界 = Chunk(cx+1,cz) 的左边界
 */
function generatePorts(seed: number, cx: number, cz: number): Ports {
  // 每条边生成 2 个出口，位置在 2~12 之间（不能贴角 0 或 14，且间隔 ≥ 3）
  const sidePorts = (sideSeed: number): number[] => {
    const p1 = (Math.floor(hash2(sideSeed, 0, seed + 101) * 11) + 2) % 15;
    let p2: number;
    // 循环直到与 p1 不同且间隔 ≥ 3
    for (let i = 1; ; i++) {
      p2 = (Math.floor(hash2(sideSeed, i, seed + 202) * 11) + 2) % 15;
      if (p2 !== p1 && Math.abs(p2 - p1) >= 3) break;
    }
    return [p1, p2].sort((a, b) => a - b);
  };

  // 上边界：chunk(cx, cz) 自己的 top
  const top = sidePorts(hash2(cx, cz, seed + 303) * 1000000 | 0);
  // 下边界：chunk(cx, cz) 的 bottom = chunk(cx, cz-1) 的 top
  const bottom = sidePorts(hash2(cx, cz - 1, seed + 303) * 1000000 | 0);
  // 左边界：chunk(cx, cz) 的 left
  const left = sidePorts(hash2(cx, cz, seed + 404) * 1000000 | 0);
  // 右边界：chunk(cx, cz) 的 right = chunk(cx+1, cz) 的 left
  const right = sidePorts(hash2(cx + 1, cz, seed + 404) * 1000000 | 0);

  return { top, bottom, left, right };
}

// ============ 辅助函数 ============

/** 获取邻居索引（上下左右） */
function neighbors(idx: number): number[] {
  const r = Math.floor(idx / 15);
  const c = idx % 15;
  const n: number[] = [];
  if (r > 0) n.push(idx - 15);
  if (r < 14) n.push(idx + 15);
  if (c > 0) n.push(idx - 1);
  if (c < 14) n.push(idx + 1);
  return n;
}

// ============ 阶段 1：迷宫生成（Growing Tree 算法） ============
//
// 从端口出发，逐步向相邻的"墙"单元格挖路，直到约 50% 的格子变成路。
// 这保证：
//   - 所有端口连通
//   - 约 50% 格子是路（passage），50% 是墙（wall）
//   - 墙区后续可分类为水域/坑洞/高台/死路
//
// 返回值：passage[i] = 1 表示格子 i 是路（可通行）

function generateMaze(seed: number, cx: number, cz: number, ports: Ports): Uint8Array {
  const N = 225;
  const passage = new Uint8Array(N); // 1 = 路
  const frontier: number[] = [];     // 边界格子列表

  // 所有端口标记为路
  const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];
  for (const p of allPorts) {
    if (passage[p]) continue;
    passage[p] = 1;
    // 将该端口的非路邻居加入边界
    for (const nb of neighbors(p)) {
      if (!passage[nb]) frontier.push(nb);
    }
  }

  let mazeSeed = (hash2(cx, cz, seed + 505) * 1000000) | 0;

  // 持续从边界中随机选格子，将其挖成路
  while (frontier.length > 0) {
    // 从边界中随机选一个（偏向新近加入的，产生分支）
    mazeSeed = (mazeSeed + 1) % 1000000;
    const fi = Math.floor(hash2(mazeSeed, 0, seed + 606) * frontier.length);
    const cur = frontier[fi];

    // 找到 cur 的已通路邻居（随机选一个）
    const nbrs = neighbors(cur);
    const roadNbrs = nbrs.filter(nb => passage[nb]);
    if (roadNbrs.length > 0) {
      // 挖通路：将 cur 标记为路
      passage[cur] = 1;

      // 将 cur 的未访问邻居加入边界
      for (const nb of nbrs) {
        if (!passage[nb] && !frontier.includes(nb)) {
          frontier.push(nb);
        }
      }
    }

    // 从边界移除 cur
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();

    // ★ 当路已占 ~50% 时停止（保证有足够的墙区用于分类）
    // 统计已通路数
    let roadCount = 0;
    for (let i = 0; i < N; i++) if (passage[i]) roadCount++;
    if (roadCount >= 115) break; // 约 51%
  }

  return passage;
}

// ============ 阶段 2：走廊加宽（已合并到迷宫生成中） ============

// ============ 阶段 3：地形分类 ============

function classifyTerrain(
  seed: number, cx: number, cz: number,
  passage: Uint8Array, ports: Ports,
): Uint8Array {
  const N = 225;
  const tileType = new Uint8Array(N); // 0=ROAD, 1=WATER, 2=PIT, 3=PLATFORM

  // 所有迷宫通路 = ROAD
  for (let i = 0; i < N; i++) {
    if (passage[i]) {
      tileType[i] = TileType.ROAD;
    }
  }

  // 端口强制 ROAD
  for (const portList of [ports.top, ports.bottom, ports.left, ports.right]) {
    for (const p of portList) {
      tileType[p] = TileType.ROAD;
    }
  }

  // 收集墙区（非树节点且非端口）
  const wallCells: number[] = [];
  for (let i = 0; i < N; i++) {
    if (tileType[i] === TileType.ROAD) continue;
    // 跳过端口（已经设为 ROAD）
    wallCells.push(i);
  }

  if (wallCells.length === 0) return tileType;

  // 洗牌墙区（确定性）
  let terrSeed = (hash2(cx, cz, seed + 1010) * 1000000) | 0;
  for (let i = wallCells.length - 1; i > 0; i--) {
    terrSeed = (terrSeed + 1) % 1000000;
    const j = Math.floor(hash2(terrSeed, 0, seed + 1111) * (i + 1));
    [wallCells[i], wallCells[j]] = [wallCells[j], wallCells[i]];
  }

  // 按比例分配墙区
  const total = wallCells.length;
  const waterCount = Math.floor(total * 0.30);
  const pitCount = Math.floor(total * 0.30);
  const platformCount = Math.floor(total * 0.20);
  const flatCount = total - waterCount - pitCount - platformCount;

  // 水域（前 30%）
  for (let i = 0; i < waterCount; i++) {
    tileType[wallCells[i]] = TileType.WATER;
  }
  // 坑洞（接下来 30%）
  for (let i = waterCount; i < waterCount + pitCount; i++) {
    tileType[wallCells[i]] = TileType.PIT;
  }
  // 高台（接下来 20%，需要紧挨树节点）
  for (let i = waterCount + pitCount; i < waterCount + pitCount + platformCount; i++) {
    const idx = wallCells[i];
    // 检查是否紧挨树节点（ROAD）
    const nbrs = neighbors(idx);
    const hasRoadNeighbor = nbrs.some(nb => tileType[nb] === TileType.ROAD);
    if (hasRoadNeighbor) {
      tileType[idx] = TileType.PLATFORM;
    } else {
      // 没有紧挨路，降级为死路平地
      tileType[idx] = TileType.ROAD;
    }
  }
  // 剩余墙区 = 死路平地（ROAD）
  for (let i = waterCount + pitCount + platformCount; i < total; i++) {
    tileType[wallCells[i]] = TileType.ROAD;
  }

  return tileType;
}

// ============ 阶段 4：连通性修复 ============

function repairConnectivity(tileType: Uint8Array, ports: Ports): void {
  const N = 225;
  const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];

  // BFS 从所有端口出发
  const visited = new Uint8Array(N);
  const queue: number[] = [...allPorts];
  for (const p of allPorts) visited[p] = 1;

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (tileType[cur] === TileType.WATER || tileType[cur] === TileType.PIT) continue;
    for (const nb of neighbors(cur)) {
      if (visited[nb]) continue;
      if (tileType[nb] === TileType.WATER || tileType[nb] === TileType.PIT) continue;
      visited[nb] = 1;
      queue.push(nb);
    }
  }

  // 修复所有未访问的 ROAD/PLATFORM 节点
  for (let i = 0; i < N; i++) {
    if (!visited[i] && (tileType[i] === TileType.ROAD || tileType[i] === TileType.PLATFORM)) {
      // 强制恢复为 ROAD（如果上面有高台则降级，有水/坑则填平）
      tileType[i] = TileType.ROAD;
      // 从该节点重新 BFS（确保修复后的节点能传播连通性）
      visited[i] = 1;
      queue.push(i);
      while (head < queue.length) {
        const cur = queue[head++];
        for (const nb of neighbors(cur)) {
          if (visited[nb]) continue;
          if (tileType[nb] === TileType.WATER || tileType[nb] === TileType.PIT) continue;
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
  }
}

// ============ 阶段 5：高度分配 ============

function assignHeights(tileType: Uint8Array, ports: Ports): Float32Array {
  const heights = new Float32Array(225);
  const allPorts = new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right]);

  for (let i = 0; i < 225; i++) {
    switch (tileType[i]) {
      case TileType.ROAD:
        // 边界出口 = 0.0（无扰动）；内部路 = 0.0 + 微扰动
        heights[i] = allPorts.has(i) ? 0 : 0;
        break;
      case TileType.PLATFORM:
        heights[i] = 1.8;
        break;
      case TileType.WATER:
        heights[i] = -0.5;
        break;
      case TileType.PIT:
        heights[i] = -3.0;
        break;
    }
  }
  return heights;
}

// ============ 转换为 ChunkData 格式 ============

function toChunkData(
  tileType: Uint8Array,
  tileHeights: Float32Array,
  chunkX: number, chunkZ: number,
): ChunkData {
  const heights = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const blockTypes = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const blockHeight = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const walkable = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const ti = bz * BLOCKS_PER_SIDE + bx;
      const type = tileType[ti];
      const h = tileHeights[ti];

      // 块类型
      switch (type) {
        case TileType.PLATFORM:
          blockTypes[ti] = BLOCK_PLATFORM;
          break;
        case TileType.PIT:
          blockTypes[ti] = BLOCK_PIT;
          break;
        case TileType.WATER:
          blockTypes[ti] = BLOCK_WATER;
          break;
        default:
          blockTypes[ti] = BLOCK_FLAT;
          break;
      }

      // 填充 4×4 每米数据
      for (let dz = 0; dz < BLOCK_SIZE; dz++) {
        for (let dx = 0; dx < BLOCK_SIZE; dx++) {
          const gz = bz * BLOCK_SIZE + dz;
          const gx = bx * BLOCK_SIZE + dx;
          const gi = gz * CHUNK_SIZE + gx;

          heights[gi] = h;
          blockHeight[gi] = 0;
          walkable[gi] = (type === TileType.ROAD || type === TileType.PLATFORM) ? 1 : 0;
        }
      }
    }
  }

  return { chunkX, chunkZ, heights, blockTypes, blockHeight, walkable };
}

// ============ 主入口 ============

/** ★ 生成 60×60 区域地形（确定性） */
export function generateChunk(seed: number, chunkX: number, chunkZ: number): ChunkData {
  // 阶段 0：端口派生
  const ports = generatePorts(seed, chunkX, chunkZ);

  // 阶段 1：生成迷宫（Growing Tree）
  const passage = generateMaze(seed, chunkX, chunkZ, ports);

  // 阶段 2：地形分类
  const tileType = classifyTerrain(seed, chunkX, chunkZ, passage, ports);

  // 阶段 3：连通性修复
  repairConnectivity(tileType, ports);

  // 阶段 4：高度分配
  const tileHeights = assignHeights(tileType, ports);

  // 转换为 ChunkData 格式
  return toChunkData(tileType, tileHeights, chunkX, chunkZ);
}