// ============================================================
// ChunkGenerator —— 分块迷宫地形生成（六层管线）
// ============================================================
// ★ 六层分离（2026-08-26 定稿，详见《地形与渲染管线架构.md》）：
//   L0   端口派生            确定性哈希出口，跨块连通
//   L0.5 特殊布局解析        registerSpecialLayout 命中 → 接管结构层
//                            （为特殊事件服务的地形自主设计接口；注册表空 = 行为同旧版逐位一致）
//   L1   结构层 ★预设驱动    区域级抽「地形预设」（TerrainPresets）+ 块级预设种子
//                            → 角色槽位 PATH/WALL/LIQUID/PIT
//                            ★ 只认槽位不认地块；与材质（TileGroups 选组）完全解耦
//   L2   选组层              每 chunk 加权抽一个风格组（TileGroups）
//   L3   抽取层              槽位角色 → 组内筛同 genRole 成员加权抽块；
//                            PATH 装饰斑块 pass（低频噪声成片替换装饰平面地块）
//   L4   行为落地            高度读地块 physics；梯田带按 platform 角色判定；
//                            连通性修复：端口格不得是不可走角色
//   L5   输出                blockTypes 存最终 TileDef.id（下游零改动）
//
// 装饰纹理/实体装饰不在本文件：它们是独立基类体系（decor/TileDecalBase、
// decor/MapEntityDecorBase），同样带组归属，在地形生成完成后、渲染前散布。
//
// ⚠️ 随机盐铁律：所有 hash2/vnoise 盐与历史版本逐位一致——
//   改任何一个数 = 全世界地形重洗，回归基线全部失效。
// ============================================================

import { TILE_FLAT_SAND, tileById, tileByKey, type TileDef } from './Tiles';
import { pickChunkGroup, drawTileForRole, drawGroundDecorTile, type GroupDef } from './TileGroups';
import { hash2, vnoise } from './TerrainNoise';

// 确定性 hash 噪声：权威实现已迁 TerrainNoise。保持原导出兼容既有消费方。
export { hash2 } from './TerrainNoise';

/** chunk 尺寸（米） */
export const CHUNK_SIZE = 60;
/** 块尺寸（米） */
export const BLOCK_SIZE = 4;
/** 每 chunk 块数 */
export const BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE; // 15

// ============ 结构槽位角色 / 端口 / 预设（唯一真源：TerrainPresets） ============

import {
  ROLE_PATH, ROLE_WALL, ROLE_LIQUID, ROLE_PIT,
  generatePorts, pickPreset, presetByKey, getTestPreset, gridNeighbors,
  type Ports,
} from './TerrainPresets';

export { ROLE_PATH, ROLE_WALL, ROLE_LIQUID, ROLE_PIT };

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
  /** ★ 本 chunk 生效的地形结构预设（TerrainPresets；调试/装饰可用，渲染链不依赖） */
  presetKey: string;
  /** ★ §14.11 补丁层数覆盖（1m cell，0=无；N = 累深 N×PATCH_DEPTH）。
   *   生成器恒产出全 0 —— 仅运行时 playBulletImpact 写；clearAll 随 chunk 回收。 */
  levels: Uint8Array;
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
    for (const nb of gridNeighbors(p)) s.add(nb);
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
  materialOverride?: Partial<Record<'ground' | 'platform' | 'liquid' | 'pit', string>> | null,
  noGroundPatch = false,
): void {
  const portNear = buildPortNearSet(ports);
  // ★ 材质覆盖查表（人造地形：背景/字各一个固定材质，不走组抽取）
  const overrideOf = (role: 'ground' | 'platform' | 'liquid' | 'pit'): TileDef | null => {
    const key = materialOverride?.[role];
    return key ? (tileByKey(key) ?? null) : null;
  };
  const ovGround = overrideOf('ground');
  const ovPlatform = overrideOf('platform');
  const ovLiquid = overrideOf('liquid');
  const ovPit = overrideOf('pit');

  for (let i = 0; i < 225; i++) {
    switch (roles[i]) {
      case ROLE_WALL:
        blockIds[i] = (ovPlatform ?? drawTileForRole(panel, 'platform', seed, cx, cz, i)).id;
        break;
      case ROLE_LIQUID:
        blockIds[i] = (ovLiquid ?? drawTileForRole(panel, 'liquid', seed, cx, cz, i)).id;
        break;
      case ROLE_PIT:
        blockIds[i] = (ovPit ?? drawTileForRole(panel, 'pit', seed, cx, cz, i)).id;
        break;
      default: {
        // ★ 材质覆盖优先（背景材质）：人造地形不参与地面装饰斑块
        if (ovGround) {
          blockIds[i] = ovGround.id;
          break;
        }
        // PATH：低频噪声成片替换为装饰平面地块（冰原/灰烬地/泥沼…）
        const bx = i % BLOCKS_PER_SIDE;
        const bz = Math.floor(i / BLOCKS_PER_SIDE);
        const wx = (cx * BLOCKS_PER_SIDE + bx) * BLOCK_SIZE;
        const wz = (cz * BLOCKS_PER_SIDE + bz) * BLOCK_SIZE;
        if (!noGroundPatch && !portNear.has(i) && vnoise(wx * PATCH_FREQ, wz * PATCH_FREQ, seed + 7349) > PATCH_TAU) {
          const decor = drawGroundDecorTile(panel, seed, cx, cz, i);
          blockIds[i] = decor ? decor.id : TILE_FLAT_SAND.id;
        } else {
          blockIds[i] = TILE_FLAT_SAND.id;
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
  overrides?: Float32Array | null,
  overridePortHeights = false,
): Float32Array {
  const heights = new Float32Array(225);
  const allPorts = new Set<number>(); // ★ 端口格（正确坐标映射；高度归基础面保跨块顺滑）
  for (const c of ports.top) allPorts.add(c);
  for (const c of ports.bottom) allPorts.add((BLOCKS_PER_SIDE - 1) * BLOCKS_PER_SIDE + c);
  for (const r of ports.left) allPorts.add(r * BLOCKS_PER_SIDE);
  for (const r of ports.right) allPorts.add(r * BLOCKS_PER_SIDE + (BLOCKS_PER_SIDE - 1));

  // 高度分配（确定性；规则来自被抽地块自身的 physics）
  //   ground: height + jitter，端口平整
  //   platform 角色: 三档梯田 1.2/2.2/3.4（低频噪声分带，同档成片）
  //   liquid/pit: 各自 physics.height
  for (let i = 0; i < 225; i++) {
    // ★ 预设高度覆盖（山峰/峡谷/岛屿/高原）：默认端口格除外；
    //   overridePortHeights = true 时端口也生效（高原等大高程地形的跨块同高）
    if (overrides && (overridePortHeights || !allPorts.has(i)) && Number.isFinite(overrides[i])) {
      heights[i] = overrides[i];
      continue;
    }
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
  presetKey: string,
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

  return {
    chunkX, chunkZ, heights, blockTypes, blockHeight, walkable, groupKey, presetKey,
    levels: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), // ★ §14.11 覆盖层：初始 0，L6 预置伤痕 + 运行时挖坑共写
  };
}

// ============ L6 ★ 预置伤痕（§14.11 地图创建期预写：装饰弹坑 / 裂隙） ============
// 语义（用户 2026-09-05 定调）：复用 levels 预写 —— 生成期确定性撒若干
// 圆形弹坑（1~3 层焦土）+ 有机裂隙（随机游走路径）；纯装饰可通行，
// 不触发坑洞死亡；渲染/trimesh/玩法高度经 levels 链路自动同步；玩家可再叠加。
// ★ 细化（2026-09-05 用户四点要求 + 二轮修正）：
//   ① 坑洞有大有小 —— r=1~4 四档（小多 大少），径向渐层剖面（中心深→边缘浅，
//     包络平滑后为自然碗形；原两级剖面台阶感重）；
//   ② 裂隙不再直来直去 —— 4 向随机游走（45% 直行 / 55% ±90° 转向、禁回头），
//     撞墙/出带/自交即止 → 连续锯齿折线。★ 不用斜向步：深度包络只沿 ±x/±z
//     传播，斜向相邻的满深格在共享角点处深度收口 0 → 斜向段视觉断成珠串
//     （实测用户"还是都是直的"的根因：斜向段不可见，只剩正交长直段）；
//   ③ 数量与配比 —— 裂缝/弹坑分别设配额（各 8，出生 chunk 各 12）+ 裂隙加长
//     5~14 步：裂缝不再被弹坑挤压（原共用 16 配额、裂缝失败率高 → 实际很少）；
//   ④ 分布合理 —— 形状间 ≥1 cell 空隙（8 邻域检查）不粘连；★ 高台偏置：
//     chunk 内有高台 cell 时 60% 尝试优先落在高台上（用户：高台上再多点）；
//     空 chunk 概率维持 3%（留呼吸节奏）。
// ★ 确定性：独立 PRNG（hash2 派生），不触碰 L1~L5 既有随机流 → 回归基线不变。
const SCAR_MARGIN = 4;   // 距 chunk 边留白（包络 seam 收口 0.5m + 形状余量）

function mulberry32(seed0: number): () => number {
  let a = seed0 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function presetLevelScars(seed: number, chunkX: number, chunkZ: number, data: ChunkData): void {
  const draw = mulberry32(Math.floor(hash2(chunkX, chunkZ, seed + 8801) * 4294967296) >>> 0);
  const isSpawn = chunkX === 0 && chunkZ === 0;
  if (!isSpawn && draw() < 0.03) return; // 少量留白 chunk（节奏呼吸）
  const levels = data.levels;
  const occ = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); // 已提交形状占用图
  const inBand = (lx: number, lz: number) =>
    lx >= SCAR_MARGIN && lx < CHUNK_SIZE - SCAR_MARGIN && lz >= SCAR_MARGIN && lz < CHUNK_SIZE - SCAR_MARGIN;
  // ★ 间隔检查：cell 自身可放置（带内+可走）且 8 邻域无已提交形状 → 形状间
  //   恒有 ≥1 cell 原地面过渡带，散布自然不粘连
  const canPlace = (lx: number, lz: number): boolean => {
    if (!inBand(lx, lz)) return false;
    if (data.walkable[lz * CHUNK_SIZE + lx] !== 1) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx, z = lz + dz;
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
        if (occ[z * CHUNK_SIZE + x] !== 0) return false;
      }
    }
    return true;
  };
  const mark = (lx: number, lz: number, level: number): void => {
    occ[lz * CHUNK_SIZE + lx] = 1;
    if (levels[lz * CHUNK_SIZE + lx] < level) levels[lz * CHUNK_SIZE + lx] = level;
  };
  // 中心撒点（出生 chunk 强制落在 30,30 ±10 cell，其余全幅随机）
  const centerP = (v: number, spanCells: number) =>
    isSpawn
      ? Math.round(30 + (v - 0.5) * 2 * spanCells)
      : SCAR_MARGIN + Math.floor(v * (CHUNK_SIZE - SCAR_MARGIN * 2));
  const bound = (v: number) => Math.max(SCAR_MARGIN, Math.min(CHUNK_SIZE - 1 - SCAR_MARGIN, v));
  // ★ 高台偏置采样：收集本 chunk 全部高台 cell（genRole=platform 的 4×4 全格）；
  //   60% 尝试直接在高台上取形心（用户：高台上再多点），其余全幅随机
  const platCells: number[] = [];
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      if (tileById(data.blockTypes[bz * BLOCKS_PER_SIDE + bx]).genRole !== 'platform') continue;
      for (let dz = 0; dz < BLOCK_SIZE; dz++) {
        for (let dx = 0; dx < BLOCK_SIZE; dx++) {
          platCells.push((bz * BLOCK_SIZE + dz) * CHUNK_SIZE + (bx * BLOCK_SIZE + dx));
        }
      }
    }
  }
  const pickCenter = (): { lx: number; lz: number } => {
    if (platCells.length > 0 && draw() < 0.6) {
      const gi = platCells[Math.floor(draw() * platCells.length)];
      return { lx: bound(gi % CHUNK_SIZE), lz: bound(Math.floor(gi / CHUNK_SIZE)) };
    }
    return { lx: bound(centerP(draw(), isSpawn ? 10 : 1)), lz: bound(centerP(draw(), isSpawn ? 10 : 1)) };
  };
  // 4 向步进表（裂隙随机游走；只走正交步 → 折线连续不断）
  const DX4 = [1, 0, -1, 0];
  const DZ4 = [0, 1, 0, -1];
  // ★ 分类型配额：裂缝/弹坑各自保底（原共用配额 → 裂缝被挤压饥饿）
  const minCraters = isSpawn ? 12 : 8;
  const minCracks = isSpawn ? 12 : 8;
  let placedCraters = 0;
  let placedCracks = 0;
  for (let t = 0; t < 150 && (placedCraters < minCraters || placedCracks < minCracks); t++) {
    // 未满配额的类型优先；双方都未满时按 0.55 概率抽弹坑
    const wantCrater = placedCraters < minCraters;
    const wantCrack = placedCracks < minCracks;
    const doCrater = wantCrater && (!wantCrack || draw() < 0.55);
    if (!doCrater) {
      // ---- 裂隙：正交随机游走（45% 直行 / 55% ±90° 转向、禁回头）----
      const start = pickCenter(); // ★ 单次采样：x/z 必须来自同一形心
      let lx = start.lx, lz = start.lz;
      // 起点须直接可放（偏置落在高台上时 walkable 必真，仍兜底）
      if (!canPlace(lx, lz)) continue;
      let dir = Math.floor(draw() * 4);
      const len = 5 + Math.floor(draw() * 10); // 5..14 步
      const level = draw() < 0.72 ? 1 : 2;
      const path: { lx: number; lz: number }[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < len; i++) {
        path.push({ lx, lz });
        seen.add(lz * CHUNK_SIZE + lx);
        const turn = draw() < 0.45 ? 0 : (draw() < 0.5 ? 1 : 3); // 0 直行 / 1 左转 / 3 右转
        dir = (dir + turn) & 3;
        const nx = lx + DX4[dir], nz = lz + DZ4[dir];
        if (!canPlace(nx, nz) || seen.has(nz * CHUNK_SIZE + nx)) break;
        lx = nx; lz = nz;
      }
      if (path.length >= 4) {
        for (const p of path) mark(p.lx, p.lz, level);
        placedCracks++;
      }
    } else {
      // ---- 弹坑：r=1~4 四档（小多 大少），径向渐层（中心 L → 边缘 1）----
      // 层深沿半径线性下降，经包络（W=0.5）平滑后为自然碗形，无两级台阶感
      const c0 = pickCenter();
      const cx0 = c0.lx, cz0 = c0.lz;
      const rr = draw();
      const r = rr < 0.38 ? 1 : rr < 0.68 ? 2 : rr < 0.9 ? 3 : 4;
      const L = 1 + Math.floor(draw() * 3); // 中心层数 1..3
      const cells: { lx: number; lz: number; level: number }[] = [];
      let ok = true;
      for (let dz = -r; dz <= r && ok; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist2 = dx * dx + dz * dz;
          if (dist2 > r * r) continue;
          if (!canPlace(cx0 + dx, cz0 + dz)) { ok = false; break; }
          const level = Math.max(1, Math.round(L - (Math.sqrt(dist2) * (L - 1)) / Math.max(1, r)));
          cells.push({ lx: cx0 + dx, lz: cz0 + dz, level });
        }
      }
      if (ok) {
        for (const c of cells) mark(c.lx, c.lz, c.level);
        placedCraters++;
      }
    }
  }
}

// ============ 主入口（六层管线编排） ============

/** ★ 生成 60×60 区域地形（确定性） */
export function generateChunk(seed: number, chunkX: number, chunkZ: number): ChunkData {
  // ---- L0 端口派生 ----
  let ports = generatePorts(seed, chunkX, chunkZ);

  // ---- L0.5 特殊布局解析（注册表空 = 恒 null，行为与旧版逐位一致） ----
  const special = resolveSpecialLayout(seed, chunkX, chunkZ);
  if (special?.ports) ports = special.ports;

  // ---- L2 选组（本 chunk 生效组；生成偏置与贴图/装饰规划同源消费 groupKey） ----
  const panel = pickChunkGroup(seed, chunkX, chunkZ);

  // ---- L1 结构层（★ 预设驱动）----
  //   区域种子抽预设（4×4 chunk 一区 + 边缘过渡）；块级 salt 让同预设形态各异；
  //   材质选组（L2）与之完全独立。
  let roles: Uint8Array;
  let presetKey: string;
  let heightOverrides: Float32Array | null = null;
  let overridePortHeights = false;
  let materialOverride: Partial<Record<'ground' | 'platform' | 'liquid' | 'pit', string>> | null = null;
  let noGroundPatch = false;
  if (special?.mode === 'replace' && special.roles) {
    roles = special.roles.slice();
    presetKey = 'special';
  } else {
    const preset = getTestPreset() ? (presetByKey(getTestPreset()!) ?? pickPreset(seed, chunkX, chunkZ)) : pickPreset(seed, chunkX, chunkZ);
    presetKey = preset.key;
    const salt = ((hash2(chunkX, chunkZ, seed + 9202) * 1000000000) | 0) ^ (seed * 2654435761);
    const built = preset.build({ seed, cx: chunkX, cz: chunkZ, ports, salt, gen: panel.gen });
    if (built instanceof Uint8Array) {
      roles = built;
    } else {
      roles = built.roles;
      heightOverrides = built.heights ?? null;
      overridePortHeights = built.overridePorts === true;
      materialOverride = built.materials ?? null;
      noGroundPatch = built.noGroundPatch === true;
    }
  }

  // ---- L4a 连通性修复（对所有布局来源兜底） ----
  repairConnectivityRoles(roles, ports);

  // ---- L2+L3 选组与抽取 ----
  const blockIds = new Uint8Array(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE);
  fillSlots(seed, chunkX, chunkZ, roles, ports, panel, blockIds, materialOverride, noGroundPatch);

  // ---- L4 高度分配 ----
  const tileHeights = assignHeights(blockIds, roles, ports, seed, chunkX, chunkZ, heightOverrides, overridePortHeights);

  // ---- L5 输出 ----
  const data = toChunkData(blockIds, tileHeights, chunkX, chunkZ, panel.key, presetKey);
  // ---- L6 预置伤痕（装饰弹坑/裂隙；levels 预写，确定性） ----
  presetLevelScars(seed, chunkX, chunkZ, data);
  return data;
}
