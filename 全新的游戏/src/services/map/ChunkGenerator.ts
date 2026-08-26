// ============================================================
// ChunkGenerator —— 分块迷宫地形生成（六层管线）
// ============================================================
// ★ 六层分离（2026-08-26 定稿，详见《地块与装饰架构.md》）：
//   L0   端口派生            确定性哈希出口，跨块连通
//   L0.5 特殊布局解析        registerSpecialLayout 命中 → 接管结构层
//                            （为特殊事件服务的地形自主设计接口；注册表空 = 行为同旧版逐位一致）
//   L1   结构层              迷宫 → 角色槽位 PATH/WALL/LIQUID/PIT
//                            ★ 只认槽位不认地块；输出 = 固定 seed 回归基准
//   L2   选组层              每 chunk 加权抽一个风格组（TileGroups）
//   L3   抽取层              槽位角色 → 组内筛同 genRole 成员加权抽块；
//                            PATH 装饰斑块 pass（低频噪声成片替换装饰平面地块）
//   L4   行为落地            高度读地块 physics；梯田带按 platform 角色判定；
//                            连通性修复：端口格不得是不可走角色
//   L5   输出                blockTypes 存最终 TileDef.id（下游零改动）
//
// 装饰纹理/实体装饰不在本文件：它们是独立列表（TileDecals/TileProps），
// 同样带组归属，在地形生成完成后、渲染前按块数据自主散布。
//
// ⚠️ 随机盐铁律：所有 hash2/vnoise 盐与历史版本逐位一致——
//   改任何一个数 = 全世界地形重洗，回归基线全部失效。
// ============================================================

import { TILE_FLAT } from './Tiles';
import { tileById } from './Tiles';
import { pickChunkGroup, drawTileForRole, drawGroundDecorTile, type GroupDef } from './TileGroups';
import { regionParamsAt } from './RegionTheme';
import { hash2, vnoise } from './TerrainNoise';

// 确定性 hash 噪声：权威实现已迁 TerrainNoise。保持原导出兼容既有消费方。
export { hash2 } from './TerrainNoise';

/** chunk 尺寸（米） */
export const CHUNK_SIZE = 60;
/** 块尺寸（米） */
export const BLOCK_SIZE = 4;
/** 每 chunk 块数 */
export const BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE; // 15

// ============ 结构槽位角色（L1 输出；只描述"位置该长什么"，不指具体地块） ============

export const ROLE_PATH = 0;    // 地面位（迷宫走廊/端口/死路平地）
export const ROLE_WALL = 1;    // 高台位（迷宫墙）
export const ROLE_LIQUID = 2;  // 液体位
export const ROLE_PIT = 3;     // 坑洞位

// ============ 端口数据结构 ============

export interface Ports {
  top: number[];    // 上边界出口的列索引
  bottom: number[];
  left: number[];
  right: number[];
}

// ============ L0.5 特殊 chunk 布局接口（预留；注册表为空时行为不变） ============
//
// 特殊事件的 chunk 地形需要自主设计（竞技场清空/对称房间/环形结构…），
// 通过本接口在结构层插队接管。事件系统本体不做，只保证：
//   - 布局判定确定性（同 seed 同坐标恒同结果）→ 天内复现一致
//   - 无论哪种布局来源，L4 连通性修复无条件兜底

export interface ChunkLayoutPlan {
  /** replace = 整块接管结构层（overlay 局部混合留待扩展） */
  mode: 'replace';
  /** 自主设计的角色布局（225 格，值用 ROLE_*） */
  roles: Uint8Array;
  /** 可选自定义端口（缺省走 L0 派生；自定义必须与邻块协商，慎用） */
  ports?: Ports;
}

interface SpecialLayoutEntry {
  match(seed: number, cx: number, cz: number): boolean;
  build(seed: number, cx: number, cz: number): ChunkLayoutPlan;
}

const SPECIAL_LAYOUTS: SpecialLayoutEntry[] = [];

/** ★ 扩展点：注册特殊 chunk 布局（稀有度由 match 内部盐控制） */
export function registerSpecialLayout(entry: SpecialLayoutEntry): void {
  SPECIAL_LAYOUTS.push(entry);
}

function resolveSpecialLayout(seed: number, cx: number, cz: number): ChunkLayoutPlan | null {
  for (const e of SPECIAL_LAYOUTS) {
    if (e.match(seed, cx, cz)) return e.build(seed, cx, cz);
  }
  return null;
}

// ============ ChunkData（保持接口兼容 + groupKey 扩展） ============
export interface ChunkData {
  chunkX: number;
  chunkZ: number;
  /** 每米高度（60×60；每个 4×4 tile 内绝对平整） */
  heights: Float32Array;
  /** 块类型（15×15；存最终 TileDef.id） */
  blockTypes: Uint8Array;
  /** 每米阻挡高度 */
  blockHeight: Float32Array;
  /** 每米可通行 */
  walkable: Uint8Array;
  /** 本 chunk 生效的风格组（TileGroups；贴图/装饰物规划层消费） */
  groupKey: string;
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
// 从端口出发，逐步向相邻的"墙"单元格挖路，直到达到目标路占比。
// targetPassageRatio 控制墙密度：0.3 = 墙密集（窄迷宫），0.7 = 墙稀疏（开阔地）
//
// 返回值：passage[i] = 1 表示格子 i 是路（可通行）

function generateMaze(seed: number, cx: number, cz: number, ports: Ports, targetPassageRatio: number): Uint8Array {
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
  const targetCount = Math.floor(N * targetPassageRatio);

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

    // ★ 达到目标路数后停止
    let roadCount = 0;
    for (let i = 0; i < N; i++) if (passage[i]) roadCount++;
    if (roadCount >= targetCount) break;
  }

  return passage;
}

// ============ L1 结构层：角色槽位划分 ============
// （原 classifyTerrain；输出从 TileType 枚举改为角色槽位，逻辑与随机流逐位保留）

function structureSlots(
  seed: number, cx: number, cz: number,
  passage: Uint8Array, ports: Ports,
): Uint8Array {
  const N = 225;
  const roles = new Uint8Array(N); // 默认 ROLE_PATH(0) —— 与旧 UNKNOWN→ROAD 收敛一致
  const portSet = new Set<number>([...ports.top, ...ports.bottom, ...ports.left, ...ports.right]);

  // 1. 标记所有 passage 为 PATH（迷宫走廊）
  for (let i = 0; i < N; i++) {
    if (passage[i]) roles[i] = ROLE_PATH;
  }

  // 2. 端口强制 PATH
  for (const p of portSet) {
    roles[p] = ROLE_PATH;
  }

  // 3. 收集墙区（既非走廊也非端口）→ 这些将成为高台位，少量被液体/坑洞位替换
  const wallSet = new Set<number>();
  for (let i = 0; i < N; i++) {
    if (!passage[i] && !portSet.has(i)) wallSet.add(i);
  }

  if (wallSet.size === 0) return roles;

  // 4. 洗牌墙区池（确定性）
  let wallPool = [...wallSet];
  let terrSeed = (hash2(cx, cz, seed + 1010) * 1000000) | 0;
  for (let i = wallPool.length - 1; i > 0; i--) {
    terrSeed = (terrSeed + 1) % 1000000;
    const j = Math.floor(hash2(terrSeed, 0, seed + 1111) * (i + 1));
    [wallPool[i], wallPool[j]] = [wallPool[j], wallPool[i]];
  }

  const used = new Uint8Array(N);
  const total = wallPool.length;

  // ---- BFS 生长集群 ----
  function growCluster(sizeMin: number, sizeMax: number, filter?: (idx: number) => boolean): number[] {
    let seedCell = -1;
    for (const c of wallPool) {
      if (!used[c] && (!filter || filter(c))) { seedCell = c; break; }
    }
    if (seedCell === -1) return [];

    const targetSize = Math.min(sizeMin + Math.floor(hash2(terrSeed, 0, seed + 1313) * (sizeMax - sizeMin + 1)), total);

    const cluster: number[] = [];
    const frontier: number[] = [seedCell];
    const visited = new Set<number>();
    visited.add(seedCell);

    while (frontier.length > 0 && cluster.length < targetSize) {
      terrSeed = (terrSeed + 1) % 1000000;
      const fi = Math.floor(hash2(terrSeed, 0, seed + 1414) * frontier.length);
      const cur = frontier[fi];
      frontier[fi] = frontier[frontier.length - 1];
      frontier.pop();

      if (used[cur]) continue;
      if (filter && !filter(cur)) continue;

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

  // 5. 墙区分配：大部分 → 高台位，少量 → 液体/坑洞位
  // ★ 区域主题偏置：水体/坑洞比例随区域变化（荒漠少水多坑、霜蓝多冰湖…）
  const rp = regionParamsAt(seed, (cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
  const targetWater = Math.floor(total * 0.15 * rp.waterMul);
  const targetPit = Math.floor(total * 0.15 * rp.pitMul);

  // 液体：3~6 格连续集群（湖泊）
  let waterCount = 0;
  while (waterCount < targetWater) {
    const rem = targetWater - waterCount;
    const cluster = growCluster(Math.min(3, rem), Math.min(6, rem));
    for (const c of cluster) { roles[c] = ROLE_LIQUID; waterCount++; }
    if (cluster.length === 0) break;
  }

  // 坑洞：2~4 格连续集群（陷阱）
  let pitCount = 0;
  while (pitCount < targetPit) {
    const rem = targetPit - pitCount;
    const cluster = growCluster(Math.min(2, rem), Math.min(4, rem));
    for (const c of cluster) { roles[c] = ROLE_PIT; pitCount++; }
    if (cluster.length === 0) break;
  }

  // 6. 剩余墙区 → 高台位（迷宫墙）+ 少数死路平地
  let platformCount = 0;
  const targetPlatform = Math.floor(total * 0.60);
  for (const c of wallPool) {
    if (used[c]) continue;
    if (platformCount < targetPlatform) {
      roles[c] = ROLE_WALL;
      used[c] = 1;
      platformCount++;
    }
  }
  // 再剩余的 → 死路平地（保持默认 ROLE_PATH）

  return roles;
}

// ============ L4a 连通性修复（角色级；对特殊布局同样兜底） ============
//
// 只保证端口不被不可走角色堵死，不强制全局连通。
// 契约原则：L3 抽取按角色过滤，walkable 属性跟随角色语义
// （PATH 全可走 / LIQUID·PIT 全不可走），故修复在角色层一次完成。

function repairConnectivityRoles(roles: Uint8Array, ports: Ports): void {
  const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];
  for (const p of allPorts) {
    if (roles[p] === ROLE_LIQUID || roles[p] === ROLE_PIT) {
      roles[p] = ROLE_PATH;
    }
  }
}

// ============ L2+L3 选组与填充 ============

/** PATH 装饰斑块覆盖率阈值（vnoise > τ 成片替换装饰平面地块；越大越稀） */
const PATCH_TAU = 0.60;
/** 斑块噪声频率（~45m 尺度的坨状分布） */
const PATCH_FREQ = 0.09;

/** 端口块及其 1 圈邻域（斑块豁免——主干道衔接处保持基础平地） */
function buildPortNearSet(ports: Ports): Set<number> {
  const s = new Set<number>();
  const allPorts = [...new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right])];
  for (const p of allPorts) {
    s.add(p);
    for (const nb of neighbors(p)) s.add(nb);
  }
  return s;
}

/**
 * L3 填充：角色槽位 → 组内抽块。
 * @param panel 本 chunk 生效组（L2 已选）
 * @param blockIds 输出（最终 TileDef.id）
 */
function fillSlots(
  seed: number, cx: number, cz: number,
  roles: Uint8Array, ports: Ports, panel: GroupDef,
  blockIds: Uint8Array,
): void {
  const portNear = buildPortNearSet(ports);

  for (let i = 0; i < 225; i++) {
    switch (roles[i]) {
      case ROLE_WALL:
        blockIds[i] = drawTileForRole(panel, 'platform', seed, cx, cz, i).id;
        break;
      case ROLE_LIQUID:
        blockIds[i] = drawTileForRole(panel, 'liquid', seed, cx, cz, i).id;
        break;
      case ROLE_PIT:
        blockIds[i] = drawTileForRole(panel, 'pit', seed, cx, cz, i).id;
        break;
      default: {
        // PATH：低频噪声成片替换为装饰平面地块（冰原/灰烬地/泥沼…）
        const bx = i % BLOCKS_PER_SIDE;
        const bz = Math.floor(i / BLOCKS_PER_SIDE);
        const wx = (cx * BLOCKS_PER_SIDE + bx) * BLOCK_SIZE;
        const wz = (cz * BLOCKS_PER_SIDE + bz) * BLOCK_SIZE;
        if (!portNear.has(i) && vnoise(wx * PATCH_FREQ, wz * PATCH_FREQ, seed + 7349) > PATCH_TAU) {
          const decor = drawGroundDecorTile(panel, seed, cx, cz, i);
          blockIds[i] = decor ? decor.id : TILE_FLAT.id;
        } else {
          blockIds[i] = TILE_FLAT.id;
        }
        break;
      }
    }
  }
}

// ============ L4 高度分配 ============

function assignHeights(
  blockIds: Uint8Array,
  roles: Uint8Array,
  ports: Ports,
  seed: number,
  chunkX: number,
  chunkZ: number,
): Float32Array {
  const heights = new Float32Array(225);
  const allPorts = new Set([...ports.top, ...ports.bottom, ...ports.left, ...ports.right]);

  // 高度分配（确定性；规则来自被抽地块自身的 physics）
  //   ground: height + jitter，端口平整
  //   platform 角色: 三档梯田 1.2/2.2/3.4（低频噪声分带，同档成片）
  //   liquid/pit: 各自 physics.height
  for (let i = 0; i < 225; i++) {
    const def = tileById(blockIds[i]);
    const p = def.physics;

    // ★ 高度档位：高台不再固定一档——低频噪声把世界分成梯田 district，
    //   同档平台连片、异档之间自然出现更多层断崖（天际线起伏的来源）。
    //   档间落差 ≥0.9m > MIN_WALL_DROP → ChunkWalls 自动补侧壁。
    //   判定用【角色】而非具体地块 id → 一切高台变体自动继承同一梯田带。
    if (roles[i] === ROLE_WALL && !allPorts.has(i)) {
      const bx = i % BLOCKS_PER_SIDE;
      const bz = Math.floor(i / BLOCKS_PER_SIDE);
      const wx = (chunkX * BLOCKS_PER_SIDE + bx) * BLOCK_SIZE;
      const wz = (chunkZ * BLOCKS_PER_SIDE + bz) * BLOCK_SIZE;
      const band = Math.min(
        PLATFORM_TIERS.length - 1,
        Math.floor(vnoise(wx * 0.05, wz * 0.05, seed + 4242) * PLATFORM_TIERS.length),
      );
      heights[i] = PLATFORM_TIERS[band] + (hash2(i, 9, seed + 5555) - 0.5) * 0.3;
      continue;
    }

    if (p.flattenAtPorts && allPorts.has(i)) {
      heights[i] = p.height; // 端口：基础高度（跨块顺滑）
      continue;
    }
    heights[i] =
      p.height +
      (p.heightJitterBase ?? 0) +
      (p.heightJitterRange ? hash2(i, 0, 1212) * p.heightJitterRange : 0);
  }
  return heights;
}

/** 高台高度档位（米）。改这里 = 改世界天际线；档差需 > CAST_MIN_DEPTH */
const PLATFORM_TIERS = [1.2, 2.2, 3.4];

// ============ 转换为 ChunkData 格式 ============

function toChunkData(
  blockIds: Uint8Array,
  tileHeights: Float32Array,
  chunkX: number, chunkZ: number,
  groupKey: string,
): ChunkData {
  const heights = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const blockTypes = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  const blockHeight = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  const walkable = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const ti = bz * BLOCKS_PER_SIDE + bx;
      const h = tileHeights[ti];

      // 块类型 + 可通行（属性来自 Tiles 注册表；id 即最终地块）
      const defT = tileById(blockIds[ti]);
      blockTypes[ti] = defT.id;

      // 填充 4×4 每米数据
      for (let dz = 0; dz < BLOCK_SIZE; dz++) {
        for (let dx = 0; dx < BLOCK_SIZE; dx++) {
          const gz = bz * BLOCK_SIZE + dz;
          const gx = bx * BLOCK_SIZE + dx;
          const gi = gz * CHUNK_SIZE + gx;

          heights[gi] = h;
          blockHeight[gi] = 0;
          walkable[gi] = defT.physics.walkable ? 1 : 0;
        }
      }
    }
  }

  return { chunkX, chunkZ, heights, blockTypes, blockHeight, walkable, groupKey };
}

// ============ 主入口（六层管线编排） ============

/** ★ 生成 60×60 区域地形（确定性） */
export function generateChunk(seed: number, chunkX: number, chunkZ: number): ChunkData {
  // ---- L0 端口派生 ----
  let ports = generatePorts(seed, chunkX, chunkZ);

  // ---- L0.5 特殊布局解析（注册表空 = 恒 null，行为与旧版逐位一致） ----
  const special = resolveSpecialLayout(seed, chunkX, chunkZ);
  if (special?.ports) ports = special.ports;

  // ---- L1 结构层 ----
  let roles: Uint8Array;
  if (special?.mode === 'replace' && special.roles) {
    roles = special.roles.slice();
  } else {
    // ★ 墙密度：0.3（墙密集）~ 0.7（墙稀疏），每 chunk 不同；
    //   再叠加区域主题偏置（荒漠开阔 / 废土墙密——世界级空间节奏）
    const density = hash2(chunkX, chunkZ, seed + 1818);
    let targetPassageRatio = 0.3 + density * 0.4;
    targetPassageRatio = Math.min(0.75, Math.max(0.25, targetPassageRatio +
      regionParamsAt(seed, (chunkX + 0.5) * CHUNK_SIZE, (chunkZ + 0.5) * CHUNK_SIZE).densityBias));

    const passage = generateMaze(seed, chunkX, chunkZ, ports, targetPassageRatio);
    roles = structureSlots(seed, chunkX, chunkZ, passage, ports);
  }

  // ---- L4a 连通性修复（对所有布局来源兜底） ----
  repairConnectivityRoles(roles, ports);

  // ---- L2 选组（本 chunk 生效组；贴图/装饰物规划层同源消费 groupKey） ----
  const panel = pickChunkGroup(seed, chunkX, chunkZ);

  // ---- L2+L3 选组与抽取 ----
  const blockIds = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  fillSlots(seed, chunkX, chunkZ, roles, ports, panel, blockIds);

  // ---- L4 高度分配 ----
  const tileHeights = assignHeights(blockIds, roles, ports, seed, chunkX, chunkZ);

  // ---- L5 输出 ----
  return toChunkData(blockIds, tileHeights, chunkX, chunkZ, panel.key);
}
