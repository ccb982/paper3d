// ============================================================
// TileGroups —— 地块风格组（多对多集合 + 每 chunk 选组 + 组内抽块）
// ============================================================
// 组 = 风格包，不是结构契约：
//   - 一组内混装各种 genRole 的地块（地面/高台/水/坑），表达风格倾向
//   - 一个地块可属于多个组 → 相邻区域换组过渡自然
//   - 结构合法性由「抽取时按角色过滤」保证：结构层说此处需要 platform，
//     就只在当前组的 platform 成员里抽；筛空走回退链
//
// 回退链（终点评定为基石组）：
//   生效组 → 基石组(foundation) → 全局默认块(tileById 回退)
//
// 选组粒度：每 chunk 一次（60m 一换），确定性 hash 抽取。
// ============================================================

import { hash2 } from './TerrainNoise';
import { tileByKey, tileById, allTiles, TILE_FLAT_SAND, TILE_PLATFORM_SAND, TILE_WATER, TILE_PIT, type TileDef, type TileGenRole } from './Tiles';

// ============================================================
// 组定义与注册表
// ============================================================

/** 组级调色板（融合原 RegionTheme：hue/sat/light 偏移；作用于本组所有地块） */
export interface GroupPalette {
  /** 色相偏移（叠加到 tile baseHsl.h 后取 fract） */
  hueShift: number;
  /** 饱和度系数 */
  satMul: number;
  /** 明度系数 */
  lightMul: number;
}

/** 组级生成偏置（融合原 RegionTheme：影响迷宫密度/水体/坑洞比例） */
export interface GroupGen {
  /** 迷宫路占比偏置（负=墙密，正=开阔） */
  densityBias: number;
  /** 水体目标比例系数 */
  waterMul: number;
  /** 坑洞目标比例系数 */
  pitMul: number;
}

/** 语义色（水/坑）吃组调色的强度（保玩法可读性，不被主题洗掉） */
export const SEMANTIC_THEME_MIX = 0.45;

export interface GroupDef {
  key: string;
  label: string;
  /** 选组权重（0 = 不参与选组，只作回退） */
  weight: number;
  /** 成员权重表：tileKey → 相对权重 */
  members: Record<string, number>;
  /** 组级调色板（融合原 RegionTheme；缺省=中性不变色） */
  palette?: GroupPalette;
  /** 组级生成偏置（融合原 RegionTheme；缺省=无偏置） */
  gen?: GroupGen;
}

/**
 * ★ 应用组调色板到地块 HSL（融合原 RegionTheme 的 HSL 调制）。
 * mix=1 全量；水/坑等语义色传 SEMANTIC_THEME_MIX 保可读性。
 */
export function applyGroupTintHsl(hsl: { h: number; s: number; l: number }, p: GroupPalette | undefined, mix = 1): { h: number; s: number; l: number } {
  if (!p) return hsl;
  return {
    h: (((hsl.h + p.hueShift * mix) % 1) + 1) % 1,
    s: Math.min(1, hsl.s * (1 + (p.satMul - 1) * mix)),
    l: Math.min(1, hsl.l * (1 + (p.lightMul - 1) * mix)),
  };
}

const REGISTRY = new Map<string, GroupDef>();

export function registerGroup(def: GroupDef): void {
  if (REGISTRY.has(def.key)) throw new Error(`[TileGroups] 组 key 已存在: ${def.key}`);
  REGISTRY.set(def.key, def);
}

export function groupByKey(key: string): GroupDef | undefined {
  return REGISTRY.get(key);
}

/** 基石组（四角色齐装的兜底包；回退链终点） */
export const FOUNDATION_KEY = 'foundation';

/** 角色无成员时的最终默认块（★ 2026-09-02 起默认皮 = 1-7 沙土变体；物理 ≙ 基础类） */
const ROLE_DEFAULT: Record<TileGenRole, TileDef> = {
  ground: TILE_FLAT_SAND,
  platform: TILE_PLATFORM_SAND,
  liquid: TILE_WATER,
  pit: TILE_PIT,
};

// ============================================================
// 内置组（加风格 = 加一个组对象；成员引用 Tiles 的 key）
// ============================================================

const NEUTRAL_PALETTE: GroupPalette = { hueShift: 0, satMul: 1, lightMul: 1 };
const NEUTRAL_GEN: GroupGen = { densityBias: 0, waterMul: 1, pitMul: 1 };

registerGroup({
  key: 'foundation', label: '基石',
  // ★ 2026-09-05 转正：用户定调"1-7 沙土风才是精心制作的主力内容"——
  //   基石组参与正式选组（权重 1，与主题组均等，中性调色保持原味）；
  //   兼职不变：生效组缺角色时仍走本组回退。
  weight: 1,
  members: { flat_sand: 1, platform_sand: 1, cement_platform: 1, water: 1, pit: 1 },
  palette: NEUTRAL_PALETTE, gen: NEUTRAL_GEN,
});

registerGroup({
  key: 'crystal', label: '霜蓝结晶', weight: 1,
  members: { ice: 3, ice_platform: 3, water: 1, pit: 1 },
  palette: { hueShift: 0.47, satMul: 0.85, lightMul: 1.02 },
  gen: { densityBias: 0.10, waterMul: 1.7, pitMul: 0.6 },
});

registerGroup({
  key: 'ashen', label: '灰烬废土', weight: 1,
  members: { ash_field: 3, mud: 1, rock_platform: 3, pit: 2, water: 0.5, brick: 2 },
  palette: { hueShift: 0.00, satMul: 0.45, lightMul: 0.82 },
  gen: { densityBias: -0.06, waterMul: 0.6, pitMul: 1.2 },
});

registerGroup({
  key: 'overgrown', label: '沃绿蔓生', weight: 1,
  members: { mud: 2, mossy_platform: 3, water: 2, pit: 0.5, grass: 2, wood: 2 },
  palette: { hueShift: 0.33, satMul: 1.05, lightMul: 0.98 },
  gen: { densityBias: 0.00, waterMul: 1.4, pitMul: 0.7 },
});

// ============================================================
// 选组面板（L2）
// ============================================================

/** 主打成员加成倍率：本 chunk 该角色的主打块更容易成片出现 */
const FEATURED_BOOST = 5;

/**
 * ★ 注册表一致性校验（防双记账漂移；首次选组时自动跑一次，幂等）：
 *   ① 组成员 key → 地块必须已注册（rolePool 对缺失 key 是静默跳过）
 *   ② 地块声明的 groups → 组必须存在且 members 已收录
 *     （Tile.groups 是声明性数据，运行时不消费；漂移 = 声明不生效）
 * 以后加内容模块后可手动再调（幂等由 syncValidated 守卫，跨内容批次
 * 需要重校验时置回 false 即可）。
 */
let syncValidated = false;
export function validateTileGroupSync(): void {
  if (syncValidated) return;
  syncValidated = true;
  for (const g of REGISTRY.values()) {
    for (const key of Object.keys(g.members)) {
      if (!tileByKey(key)) {
        console.warn(`[TileGroups] 组"${g.key}"的成员"${key}"未注册（抽取时会被静默跳过）`);
      }
    }
  }
  for (const t of allTiles()) {
    for (const gk of t.groups) {
      const def = REGISTRY.get(gk);
      if (!def) {
        console.warn(`[Tiles] 地块"${t.key}"声明的组"${gk}"不存在`);
      } else if (!(t.key in def.members)) {
        console.warn(`[TileGroups] 地块"${t.key}"声明属于组"${gk}"，但该组 members 未收录（声明不会生效）`);
      }
    }
  }
}

// ============================================================
// 测试地图覆盖（素材填充/视觉调试专用）
// ============================================================

let testGroupOverride: string | null = null;

/**
 * ★ 测试地图：强制所有 chunk 使用指定组（null = 恢复正常加权抽取）。
 * 传入组 key（如 'crystal' / 'ashen' / 'overgrown' / 'foundation'）；
 * 未知 key 直接抛错。组成员抽取、贴图/装饰散布、组调色板全部随
 * chunkData.groupKey 同源生效——整个世界就是这一组的"素材陈列馆"。
 * 确定性：覆盖开启期间同 seed 生成恒定；关闭即恢复原抽取。
 */
export function setTestGroup(key: string | null): void {
  if (key !== null && !REGISTRY.has(key)) {
    throw new Error(`[TileGroups] 测试组不存在: "${key}"（可用: ${[...REGISTRY.keys()].join(', ')}）`);
  }
  testGroupOverride = key;
  console.info(`[TileGroups] 测试地图 = ${key ?? '关闭（正常加权抽取）'}`);
}

export function getTestGroup(): string | null {
  return testGroupOverride;
}

/** 每 chunk 加权抽一个生效组（weight>0 全部参与，含转正的基石组；确定性） */
export function pickChunkGroup(seed: number, cx: number, cz: number): GroupDef {
  validateTileGroupSync();
  // ★ 测试地图覆盖：最高优先级（chunk 级确定性——覆盖期间同 seed 恒同组）
  if (testGroupOverride) return REGISTRY.get(testGroupOverride)!;
  const pool = [...REGISTRY.values()].filter((g) => g.weight > 0);
  let total = 0;
  for (const g of pool) total += g.weight;
  let r = hash2(cx, cz, seed + 8181) * total;
  for (const g of pool) {
    r -= g.weight;
    if (r <= 0) return g;
  }
  return pool[pool.length - 1];
}

/** 某组在某角色下的有效成员池（key+weight）；空 = 该组缺此角色 */
function rolePool(group: GroupDef, role: TileGenRole): Array<{ key: string; w: number }> {
  const out: Array<{ key: string; w: number }> = [];
  for (const [key, w] of Object.entries(group.members)) {
    const t = tileByKey(key);
    if (t && t.genRole === role) out.push({ key, w });
  }
  return out;
}

function weightedPickKey(
  pool: Array<{ key: string; w: number }>, featured: string | null,
  seed: number, saltX: number, saltY: number,
): string {
  let total = 0;
  for (const p of pool) total += p.w * (p.key === featured ? FEATURED_BOOST : 1);
  let r = hash2(saltX, saltY, seed) * total;
  for (const p of pool) {
    r -= p.w * (p.key === featured ? FEATURED_BOOST : 1);
    if (r <= 0) return p.key;
  }
  return pool[pool.length - 1].key;
}

/**
 * 组内按角色抽地块（含回退链）。
 * @param blockIndex 块索引（逐块微扰盐——同组同角色也能出变化）
 */
export function drawTileForRole(
  group: GroupDef, role: TileGenRole,
  seed: number, cx: number, cz: number, blockIndex: number,
): TileDef {
  // ★ 主打成员：本 chunk 该角色只掷一次（盐不含 blockIndex）——
  //   主打块同 chunk 内成片出现，换块不换主打（设计定稿）
  const roleSalt = ['ground', 'platform', 'liquid', 'pit'].indexOf(role);
  const featuredCache = new Map<string, string | null>();
  const pickFeatured = (g: GroupDef): string | null => {
    let f = featuredCache.get(g.key);
    if (f === undefined) {
      const pool = rolePool(g, role);
      f = pool.length === 0 ? null : weightedPickKey(pool, null, seed + 8282, cx * 5 + roleSalt, cz * 5 + roleSalt);
      featuredCache.set(g.key, f);
    }
    return f;
  };

  const tryDraw = (g: GroupDef): TileDef | null => {
    const pool = rolePool(g, role);
    if (pool.length === 0) return null;
    const key = weightedPickKey(pool, pickFeatured(g), seed + 8383, cx, cz + blockIndex);
    return tileByKey(key) ?? null;
  };

  return tryDraw(group)
    ?? tryDraw(REGISTRY.get(FOUNDATION_KEY)!)
    ?? ROLE_DEFAULT[role];
}

/**
 * PATH 装饰斑块抽取：只要「装饰性平面地块」（排除基础平地）。
 * 组内没有装饰平面成员（如基石组）→ 返回 null，调用方保持 flat。
 */
export function drawGroundDecorTile(
  group: GroupDef, seed: number, cx: number, cz: number, blockIndex: number,
): TileDef | null {
  const decorPool = (g: GroupDef) =>
    rolePool(g, 'ground').filter((p) => p.key !== 'flat' && p.key !== 'flat_sand');
  const tryDraw = (g: GroupDef): TileDef | null => {
    const pool = decorPool(g);
    if (pool.length === 0) return null;
    const key = weightedPickKey(pool, null, seed + 8484, cx, cz + blockIndex);
    return tileByKey(key) ?? null;
  };
  return tryDraw(group) ?? tryDraw(REGISTRY.get(FOUNDATION_KEY)!);
}
