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
import { tileByKey, tileById, TILE_FLAT, TILE_PLATFORM, TILE_WATER, TILE_PIT, type TileDef, type TileGenRole } from './Tiles';

// ============================================================
// 组定义与注册表
// ============================================================

export interface GroupDef {
  key: string;
  label: string;
  /** 选组权重（foundation 固定 0 = 不参与选组，只作回退） */
  weight: number;
  /** 成员权重表：tileKey → 相对权重 */
  members: Record<string, number>;
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

/** 角色无成员时的最终默认块（理论上基石组齐全时不会走到这里） */
const ROLE_DEFAULT: Record<TileGenRole, TileDef> = {
  ground: TILE_FLAT,
  platform: TILE_PLATFORM,
  liquid: TILE_WATER,
  pit: TILE_PIT,
};

// ============================================================
// 内置组（加风格 = 加一个组对象；成员引用 Tiles 的 key）
// ============================================================

registerGroup({
  key: 'foundation', label: '基石', weight: 0,
  members: { flat: 1, platform: 1, water: 1, pit: 1, brick: 1, grass: 1, wood: 1 },
});

registerGroup({
  key: 'crystal', label: '霜蓝结晶', weight: 1,
  members: { ice: 3, ice_platform: 3, water: 1, pit: 1 },
});

registerGroup({
  key: 'ashen', label: '灰烬废土', weight: 1,
  members: { ash_field: 3, mud: 1, rock_platform: 3, pit: 2, water: 0.5, brick: 2 },
});

registerGroup({
  key: 'overgrown', label: '沃绿蔓生', weight: 1,
  members: { mud: 2, mossy_platform: 3, water: 2, pit: 0.5, grass: 2, wood: 2 },
});

// ============================================================
// 选组面板（L2）
// ============================================================

/** 主打成员加成倍率：本 chunk 该角色的主打块更容易成片出现 */
const FEATURED_BOOST = 5;

/** 每 chunk 加权抽一个生效组（排除 foundation；确定性） */
export function pickChunkGroup(seed: number, cx: number, cz: number): GroupDef {
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
    rolePool(g, 'ground').filter((p) => p.key !== 'flat');
  const tryDraw = (g: GroupDef): TileDef | null => {
    const pool = decorPool(g);
    if (pool.length === 0) return null;
    const key = weightedPickKey(pool, null, seed + 8484, cx, cz + blockIndex);
    return tileByKey(key) ?? null;
  };
  return tryDraw(group) ?? tryDraw(REGISTRY.get(FOUNDATION_KEY)!);
}
