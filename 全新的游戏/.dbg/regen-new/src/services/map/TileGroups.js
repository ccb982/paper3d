"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOUNDATION_KEY = void 0;
exports.registerGroup = registerGroup;
exports.groupByKey = groupByKey;
exports.pickChunkGroup = pickChunkGroup;
exports.drawTileForRole = drawTileForRole;
exports.drawGroundDecorTile = drawGroundDecorTile;
const TerrainNoise_1 = require("./TerrainNoise");
const Tiles_1 = require("./Tiles");
const REGISTRY = new Map();
function registerGroup(def) {
    if (REGISTRY.has(def.key))
        throw new Error(`[TileGroups] 组 key 已存在: ${def.key}`);
    REGISTRY.set(def.key, def);
}
function groupByKey(key) {
    return REGISTRY.get(key);
}
/** 基石组（四角色齐装的兜底包；回退链终点） */
exports.FOUNDATION_KEY = 'foundation';
/** 角色无成员时的最终默认块（理论上基石组齐全时不会走到这里） */
const ROLE_DEFAULT = {
    ground: Tiles_1.TILE_FLAT,
    platform: Tiles_1.TILE_PLATFORM,
    liquid: Tiles_1.TILE_WATER,
    pit: Tiles_1.TILE_PIT,
};
// ============================================================
// 内置组（加风格 = 加一个组对象；成员引用 Tiles 的 key）
// ============================================================
registerGroup({
    key: 'foundation', label: '基石', weight: 0,
    members: { flat: 1, platform: 1, water: 1, pit: 1 },
});
registerGroup({
    key: 'crystal', label: '霜蓝结晶', weight: 1,
    members: { ice: 3, ice_platform: 3, water: 1, pit: 1 },
});
registerGroup({
    key: 'ashen', label: '灰烬废土', weight: 1,
    members: { ash_field: 3, mud: 1, rock_platform: 3, pit: 2, water: 0.5 },
});
registerGroup({
    key: 'overgrown', label: '沃绿蔓生', weight: 1,
    members: { mud: 2, mossy_platform: 3, water: 2, pit: 0.5 },
});
// ============================================================
// 选组面板（L2）
// ============================================================
/** 主打成员加成倍率：本 chunk 该角色的主打块更容易成片出现 */
const FEATURED_BOOST = 5;
/** 每 chunk 加权抽一个生效组（排除 foundation；确定性） */
function pickChunkGroup(seed, cx, cz) {
    const pool = [...REGISTRY.values()].filter((g) => g.weight > 0);
    let total = 0;
    for (const g of pool)
        total += g.weight;
    let r = (0, TerrainNoise_1.hash2)(cx, cz, seed + 8181) * total;
    for (const g of pool) {
        r -= g.weight;
        if (r <= 0)
            return g;
    }
    return pool[pool.length - 1];
}
/** 某组在某角色下的有效成员池（key+weight）；空 = 该组缺此角色 */
function rolePool(group, role) {
    const out = [];
    for (const [key, w] of Object.entries(group.members)) {
        const t = (0, Tiles_1.tileByKey)(key);
        if (t && t.genRole === role)
            out.push({ key, w });
    }
    return out;
}
function weightedPickKey(pool, featured, seed, saltX, saltY) {
    let total = 0;
    for (const p of pool)
        total += p.w * (p.key === featured ? FEATURED_BOOST : 1);
    let r = (0, TerrainNoise_1.hash2)(saltX, saltY, seed) * total;
    for (const p of pool) {
        r -= p.w * (p.key === featured ? FEATURED_BOOST : 1);
        if (r <= 0)
            return p.key;
    }
    return pool[pool.length - 1].key;
}
/**
 * 组内按角色抽地块（含回退链）。
 * @param blockIndex 块索引（逐块微扰盐——同组同角色也能出变化）
 */
function drawTileForRole(group, role, seed, cx, cz, blockIndex) {
    // 主打成员：本 chunk 该角色的加权偏向（确定性，逐角色独立盐）
    const pickFeatured = (g) => {
        const pool = rolePool(g, role);
        if (pool.length === 0)
            return null;
        return weightedPickKey(pool, null, seed + 8282, cx * 4 + pool.length, cz * 4 + blockIndex % 4);
    };
    const tryDraw = (g) => {
        const pool = rolePool(g, role);
        if (pool.length === 0)
            return null;
        const key = weightedPickKey(pool, pickFeatured(g), seed + 8383, cx, cz + blockIndex);
        return (0, Tiles_1.tileByKey)(key) ?? null;
    };
    return tryDraw(group)
        ?? tryDraw(REGISTRY.get(exports.FOUNDATION_KEY))
        ?? ROLE_DEFAULT[role];
}
/**
 * PATH 装饰斑块抽取：只要「装饰性平面地块」（排除基础平地）。
 * 组内没有装饰平面成员（如基石组）→ 返回 null，调用方保持 flat。
 */
function drawGroundDecorTile(group, seed, cx, cz, blockIndex) {
    const decorPool = (g) => rolePool(g, 'ground').filter((p) => p.key !== 'flat');
    const tryDraw = (g) => {
        const pool = decorPool(g);
        if (pool.length === 0)
            return null;
        const key = weightedPickKey(pool, null, seed + 8484, cx, cz + blockIndex);
        return (0, Tiles_1.tileByKey)(key) ?? null;
    };
    return tryDraw(group) ?? tryDraw(REGISTRY.get(exports.FOUNDATION_KEY));
}
