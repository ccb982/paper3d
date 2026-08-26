"use strict";
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
//   5. 高度分配（绝对平整，无斜坡；地块属性查 Tiles 注册表）
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCK_WATER = exports.BLOCK_SLOPE = exports.BLOCK_PIT = exports.BLOCK_PLATFORM = exports.BLOCK_FLAT = exports.BLOCKS_PER_SIDE = exports.BLOCK_SIZE = exports.CHUNK_SIZE = exports.hash2 = void 0;
exports.generateChunk = generateChunk;
const Tiles_1 = require("./Tiles");
const RegionTheme_1 = require("./RegionTheme");
const TerrainNoise_1 = require("./TerrainNoise");
// 确定性 hash 噪声：权威实现已迁 TerrainNoise（RegionTheme/bakeCompute 共用，
// 避免与 RegionTheme 形成 import 环）。保持原导出兼容既有消费方。
var TerrainNoise_2 = require("./TerrainNoise");
Object.defineProperty(exports, "hash2", { enumerable: true, get: function () { return TerrainNoise_2.hash2; } });
/** chunk 尺寸（米） */
exports.CHUNK_SIZE = 60;
/** 块尺寸（米） */
exports.BLOCK_SIZE = 4;
/** 每 chunk 块数 */
exports.BLOCKS_PER_SIDE = exports.CHUNK_SIZE / exports.BLOCK_SIZE; // 15
// ============ 块类型 ============
exports.BLOCK_FLAT = 0; // 平地/路（可通行）
exports.BLOCK_PLATFORM = 1; // 高台（可通行，比路高）
exports.BLOCK_PIT = 2; // 坑洞（不可通行，秒杀）
exports.BLOCK_SLOPE = 3; // 保留（未使用）
exports.BLOCK_WATER = 4; // 水域（不可通行，阻挡）
// ============ 地形类型（内部） ============
var TileType;
(function (TileType) {
    TileType[TileType["UNKNOWN"] = 0] = "UNKNOWN";
    TileType[TileType["ROAD"] = 1] = "ROAD";
    TileType[TileType["WATER"] = 2] = "WATER";
    TileType[TileType["PIT"] = 3] = "PIT";
    TileType[TileType["PLATFORM"] = 4] = "PLATFORM";
})(TileType || (TileType = {}));
/** 内部生成类型 → 地块定义（唯一映射点；新增地块类型改 Tiles 注册表即可） */
const LEGACY_DEF = {
    [TileType.UNKNOWN]: Tiles_1.TILE_FLAT,
    [TileType.ROAD]: Tiles_1.TILE_FLAT,
    [TileType.WATER]: Tiles_1.TILE_WATER,
    [TileType.PIT]: Tiles_1.TILE_PIT,
    [TileType.PLATFORM]: Tiles_1.TILE_PLATFORM,
};
// ============ 阶段 0：端口派生 ============
/**
 * 为当前 Chunk 生成 4 条边上的出口位置，保证与相邻 Chunk 严格对齐。
 * 对称性：Chunk(cx,cz) 的右边界 = Chunk(cx+1,cz) 的左边界
 */
function generatePorts(seed, cx, cz) {
    // 每条边生成 2 个出口，位置在 2~12 之间（不能贴角 0 或 14，且间隔 ≥ 3）
    const sidePorts = (sideSeed) => {
        const p1 = (Math.floor((0, TerrainNoise_1.hash2)(sideSeed, 0, seed + 101) * 11) + 2) % 15;
        let p2;
        // 循环直到与 p1 不同且间隔 ≥ 3
        for (let i = 1;; i++) {
            p2 = (Math.floor((0, TerrainNoise_1.hash2)(sideSeed, i, seed + 202) * 11) + 2) % 15;
            if (p2 !== p1 && Math.abs(p2 - p1) >= 3)
                break;
        }
        return [p1, p2].sort((a, b) => a - b);
    };
    // 上边界：chunk(cx, cz) 自己的 top
    const top = sidePorts((0, TerrainNoise_1.hash2)(cx, cz, seed + 303) * 1000000 | 0);
    // 下边界：chunk(cx, cz) 的 bottom = chunk(cx, cz-1) 的 top
    const bottom = sidePorts((0, TerrainNoise_1.hash2)(cx, cz - 1, seed + 303) * 1000000 | 0);
    // 左边界：chunk(cx, cz) 的 left
    const left = sidePorts((0, TerrainNoise_1.hash2)(cx, cz, seed + 404) * 1000000 | 0);
    // 右边界：chunk(cx, cz) 的 right = chunk(cx+1, cz) 的 left
    const right = sidePorts((0, TerrainNoise_1.hash2)(cx + 1, cz, seed + 404) * 1000000 | 0);
    return { top, bottom, left, right };
}
// ============ 辅助函数 ============
/** 获取邻居索引（上下左右） */
function neighbors(idx) {
    const r = Math.floor(idx / 15);
    const c = idx % 15;
    const n = [];
    if (r > 0)
        n.push(idx - 15);
    if (r < 14)
        n.push(idx + 15);
    if (c > 0)
        n.push(idx - 1);
    if (c < 14)
        n.push(idx + 1);
    return n;
}
// ============ 阶段 1：迷宫生成（Growing Tree 算法） ============
//
// 从端口出发，逐步向相邻的"墙"单元格挖路，直到达到目标路占比。
// targetPassageRatio 控制墙密度：0.3 = 墙密集（窄迷宫），0.7 = 墙稀疏（开阔地）
//
// 返回值：passage[i] = 1 表示格子 i 是路（可通行）
function generateMaze(seed, cx, cz, ports, targetPassageRatio) {
    const N = 225;
    const passage = new Uint8Array(N); // 1 = 路
    const frontier = []; // 边界格子列表
    // 所有端口标记为路
    const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];
    for (const p of allPorts) {
        if (passage[p])
            continue;
        passage[p] = 1;
        // 将该端口的非路邻居加入边界
        for (const nb of neighbors(p)) {
            if (!passage[nb])
                frontier.push(nb);
        }
    }
    let mazeSeed = ((0, TerrainNoise_1.hash2)(cx, cz, seed + 505) * 1000000) | 0;
    const targetCount = Math.floor(N * targetPassageRatio);
    // 持续从边界中随机选格子，将其挖成路
    while (frontier.length > 0) {
        // 从边界中随机选一个（偏向新近加入的，产生分支）
        mazeSeed = (mazeSeed + 1) % 1000000;
        const fi = Math.floor((0, TerrainNoise_1.hash2)(mazeSeed, 0, seed + 606) * frontier.length);
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
        // ★ 达到目标路数后停止
        let roadCount = 0;
        for (let i = 0; i < N; i++)
            if (passage[i])
                roadCount++;
        if (roadCount >= targetCount)
            break;
    }
    return passage;
}
// ============ 阶段 2：走廊加宽（已合并到迷宫生成中） ============
// ============ 阶段 3：地形分类 ============
function classifyTerrain(seed, cx, cz, passage, ports) {
    const N = 225;
    const tileType = new Uint8Array(N); // 默认 UNKNOWN = 0
    // 1. 标记所有 passage 为 ROAD（迷宫走廊）
    for (let i = 0; i < N; i++) {
        if (passage[i])
            tileType[i] = TileType.ROAD;
    }
    // 2. 端口强制 ROAD
    for (const portList of [ports.top, ports.bottom, ports.left, ports.right]) {
        for (const p of portList) {
            tileType[p] = TileType.ROAD;
        }
    }
    // 3. 收集墙区（UNKNOWN）→ 这些将成为迷宫墙（高台），少量被水/坑替换
    const wallSet = new Set();
    for (let i = 0; i < N; i++) {
        if (tileType[i] === 0)
            wallSet.add(i);
    }
    if (wallSet.size === 0)
        return tileType;
    // 4. 洗牌墙区池（确定性）
    let wallPool = [...wallSet];
    let terrSeed = ((0, TerrainNoise_1.hash2)(cx, cz, seed + 1010) * 1000000) | 0;
    for (let i = wallPool.length - 1; i > 0; i--) {
        terrSeed = (terrSeed + 1) % 1000000;
        const j = Math.floor((0, TerrainNoise_1.hash2)(terrSeed, 0, seed + 1111) * (i + 1));
        [wallPool[i], wallPool[j]] = [wallPool[j], wallPool[i]];
    }
    const used = new Uint8Array(N);
    const total = wallPool.length;
    // ---- BFS 生长集群 ----
    function growCluster(sizeMin, sizeMax, filter) {
        let seedCell = -1;
        for (const c of wallPool) {
            if (!used[c] && (!filter || filter(c))) {
                seedCell = c;
                break;
            }
        }
        if (seedCell === -1)
            return [];
        const targetSize = Math.min(sizeMin + Math.floor((0, TerrainNoise_1.hash2)(terrSeed, 0, seed + 1313) * (sizeMax - sizeMin + 1)), total);
        const cluster = [];
        const frontier = [seedCell];
        const visited = new Set();
        visited.add(seedCell);
        while (frontier.length > 0 && cluster.length < targetSize) {
            terrSeed = (terrSeed + 1) % 1000000;
            const fi = Math.floor((0, TerrainNoise_1.hash2)(terrSeed, 0, seed + 1414) * frontier.length);
            const cur = frontier[fi];
            frontier[fi] = frontier[frontier.length - 1];
            frontier.pop();
            if (used[cur])
                continue;
            if (filter && !filter(cur))
                continue;
            cluster.push(cur);
            used[cur] = 1;
            for (const nb of neighbors(cur)) {
                if (!visited.has(nb) && !used[nb] && (!filter || filter(nb))) {
                    visited.add(nb);
                    frontier.push(nb);
                }
            }
        }
        return cluster;
    }
    // 5. 墙区分配：大部分 → 高台（迷宫墙），少量 → 水/坑
    // ★ 区域主题偏置：水体/坑洞比例随区域变化（荒漠少水多坑、霜蓝多冰湖…）
    const rp = (0, RegionTheme_1.regionParamsAt)(seed, (cx + 0.5) * exports.CHUNK_SIZE, (cz + 0.5) * exports.CHUNK_SIZE);
    const targetWater = Math.floor(total * 0.15 * rp.waterMul);
    const targetPit = Math.floor(total * 0.15 * rp.pitMul);
    // 水体：3~6 格连续集群（湖泊）
    let waterCount = 0;
    while (waterCount < targetWater) {
        const rem = targetWater - waterCount;
        const cluster = growCluster(Math.min(3, rem), Math.min(6, rem));
        for (const c of cluster) {
            tileType[c] = TileType.WATER;
            waterCount++;
        }
        if (cluster.length === 0)
            break;
    }
    // 坑洞：2~4 格连续集群（陷阱）
    let pitCount = 0;
    while (pitCount < targetPit) {
        const rem = targetPit - pitCount;
        const cluster = growCluster(Math.min(2, rem), Math.min(4, rem));
        for (const c of cluster) {
            tileType[c] = TileType.PIT;
            pitCount++;
        }
        if (cluster.length === 0)
            break;
    }
    // 6. 剩余墙区 → 高台（迷宫墙）+ 少数死路平地
    let platformCount = 0;
    const targetPlatform = Math.floor(total * 0.60);
    for (const c of wallPool) {
        if (used[c])
            continue;
        if (platformCount < targetPlatform) {
            tileType[c] = TileType.PLATFORM;
            used[c] = 1;
            platformCount++;
        }
    }
    // 再剩余的 → 死路平地（ROAD）
    for (const c of wallPool) {
        if (!used[c])
            tileType[c] = TileType.ROAD;
    }
    return tileType;
}
// ============ 阶段 4：端口连通性兜底 ============
//
// 只保证端口不被水/坑堵死，不强制全局连通。
// 每个连通分量可以独立生长，但端口必须可以通行。
function repairConnectivity(tileType, ports) {
    const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];
    for (const p of allPorts) {
        if (tileType[p] === TileType.WATER || tileType[p] === TileType.PIT) {
            tileType[p] = TileType.ROAD;
        }
    }
}
// ============ 阶段 5：高度分配 ============
function assignHeights(tileType, ports, seed, chunkX, chunkZ) {
    const heights = new Float32Array(225);
    const allPorts = new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right]);
    // 高度分配（确定性；规则来自 Tiles 注册表的 physics 属性）
    //   ROAD: height + (-0.1 ~ +0.3)，端口平整
    //   PLATFORM: 三档梯田 1.2/2.2/3.4（低频噪声分带，同档成片）
    //   WATER: -0.5 | PIT: -3.0
    for (let i = 0; i < 225; i++) {
        const tt = tileType[i];
        const def = LEGACY_DEF[tt] ?? Tiles_1.TILE_FLAT;
        const p = def.physics;
        // ★ B 高度档位：高台不再固定一档——低频噪声把世界分成梯田 district，
        //   同档平台连片、异档之间自然出现更多层断崖（天际线起伏的来源）。
        //   档间落差 ≥0.9m > MIN_WALL_DROP → ChunkWalls 自动补侧壁。
        if (tt === TileType.PLATFORM && !allPorts.has(i)) {
            const bx = i % exports.BLOCKS_PER_SIDE;
            const bz = Math.floor(i / exports.BLOCKS_PER_SIDE);
            const wx = (chunkX * exports.BLOCKS_PER_SIDE + bx) * exports.BLOCK_SIZE;
            const wz = (chunkZ * exports.BLOCKS_PER_SIDE + bz) * exports.BLOCK_SIZE;
            const band = Math.min(PLATFORM_TIERS.length - 1, Math.floor((0, TerrainNoise_1.vnoise)(wx * 0.05, wz * 0.05, seed + 4242) * PLATFORM_TIERS.length));
            heights[i] = PLATFORM_TIERS[band] + ((0, TerrainNoise_1.hash2)(i, 9, seed + 5555) - 0.5) * 0.3;
            continue;
        }
        if (tt === TileType.UNKNOWN || (p.flattenAtPorts && allPorts.has(i))) {
            heights[i] = p.height; // 端口/未知：基础高度（跨块顺滑）
            continue;
        }
        heights[i] =
            p.height +
                (p.heightJitterBase ?? 0) +
                (p.heightJitterRange ? (0, TerrainNoise_1.hash2)(i, 0, 1212) * p.heightJitterRange : 0);
    }
    return heights;
}
/** 高台高度档位（米）。改这里 = 改世界天际线；档差需 > CAST_MIN_DEPTH */
const PLATFORM_TIERS = [1.2, 2.2, 3.4];
// ============ 转换为 ChunkData 格式 ============
function toChunkData(tileType, tileHeights, chunkX, chunkZ) {
    const heights = new Float32Array(exports.CHUNK_SIZE * exports.CHUNK_SIZE);
    const blockTypes = new Uint8Array(exports.BLOCKS_PER_SIDE * exports.BLOCKS_PER_SIDE);
    const blockHeight = new Float32Array(exports.CHUNK_SIZE * exports.CHUNK_SIZE);
    const walkable = new Uint8Array(exports.CHUNK_SIZE * exports.CHUNK_SIZE);
    for (let bz = 0; bz < exports.BLOCKS_PER_SIDE; bz++) {
        for (let bx = 0; bx < exports.BLOCKS_PER_SIDE; bx++) {
            const ti = bz * exports.BLOCKS_PER_SIDE + bx;
            const type = tileType[ti];
            const h = tileHeights[ti];
            // 块类型 + 可通行（属性来自 Tiles 注册表）
            const defT = LEGACY_DEF[type] ?? Tiles_1.TILE_FLAT;
            blockTypes[ti] = defT.id;
            // 填充 4×4 每米数据
            for (let dz = 0; dz < exports.BLOCK_SIZE; dz++) {
                for (let dx = 0; dx < exports.BLOCK_SIZE; dx++) {
                    const gz = bz * exports.BLOCK_SIZE + dz;
                    const gx = bx * exports.BLOCK_SIZE + dx;
                    const gi = gz * exports.CHUNK_SIZE + gx;
                    heights[gi] = h;
                    blockHeight[gi] = 0;
                    walkable[gi] = defT.physics.walkable ? 1 : 0;
                }
            }
        }
    }
    return { chunkX, chunkZ, heights, blockTypes, blockHeight, walkable };
}
// ============ 主入口 ============
/** ★ 生成 60×60 区域地形（确定性） */
function generateChunk(seed, chunkX, chunkZ) {
    // 阶段 0：端口派生
    const ports = generatePorts(seed, chunkX, chunkZ);
    // ★ 墙密度：0.3（墙密集）~ 0.7（墙稀疏），每 chunk 不同；
    //   再叠加区域主题偏置（荒漠开阔 / 废土墙密——世界级空间节奏）
    const density = (0, TerrainNoise_1.hash2)(chunkX, chunkZ, seed + 1818);
    let targetPassageRatio = 0.3 + density * 0.4;
    targetPassageRatio = Math.min(0.75, Math.max(0.25, targetPassageRatio +
        (0, RegionTheme_1.regionParamsAt)(seed, (chunkX + 0.5) * exports.CHUNK_SIZE, (chunkZ + 0.5) * exports.CHUNK_SIZE).densityBias));
    // 阶段 1：生成迷宫（Growing Tree，可变密度）
    const passage = generateMaze(seed, chunkX, chunkZ, ports, targetPassageRatio);
    // 阶段 2：地形分类（墙区 → 高台迷宫墙 + 少量水坑）
    const tileType = classifyTerrain(seed, chunkX, chunkZ, passage, ports);
    // 阶段 3：连通性修复
    repairConnectivity(tileType, ports);
    // 阶段 4：高度分配
    const tileHeights = assignHeights(tileType, ports, seed, chunkX, chunkZ);
    // 转换为 ChunkData 格式
    return toChunkData(tileType, tileHeights, chunkX, chunkZ);
}
