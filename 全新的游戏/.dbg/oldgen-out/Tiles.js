"use strict";
// ============================================================
// Tiles —— 地块类型定义与注册表（数据驱动封装）
// ============================================================
// 设计目标：加一种新地块 = 在 REGISTRY 注册一个对象，不再改散落
// 各处的 switch。地块的全部静态属性内聚在此：
//
//   visual  —— 外观Canvas烘焙消费：基准色 / 逐块抖动幅度 / 颗粒 /
//              斑块 / 描边 / 拉丝 / 凹陷标志
//   physics —— ChunkGenerator 消费：基础高度 / 高度扰动 / 可通行 /
//              端口平整 / 致死
//
// ⚠️ 行为兼容承诺：内置 5 类的数值与重构前逐项一致。
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.TILE_SLOPE = exports.TILE_WATER = exports.TILE_PIT = exports.TILE_PLATFORM = exports.TILE_FLAT = exports.TileDef = void 0;
exports.tileById = tileById;
exports.registerTile = registerTile;
exports.allTiles = allTiles;
const TerrainPalette_1 = require("./TerrainPalette");
// ============================================================
// TileDef
// ============================================================
class TileDef {
    constructor(id, key, label, visual, physics) {
        this.id = id;
        this.key = key;
        this.label = label;
        this.visual = visual;
        this.physics = physics;
    }
    get isDepression() {
        return this.visual.depression;
    }
    /** 基准色 RGB（显示空间；小地图等直接消费） */
    get baseRgb() {
        return (0, TerrainPalette_1.hsl2rgb)(this.visual.baseHsl.h, this.visual.baseHsl.s, this.visual.baseHsl.l);
    }
}
exports.TileDef = TileDef;
// ============================================================
// 内置地块（数值 = 重构前各文件中的原值，逐一核对过）
// ============================================================
exports.TILE_FLAT = new TileDef(0, 'flat', '平地/路', {
    baseHsl: { h: 0.0854, s: 0.3628, l: 0.4431 }, // RGB(154,114,72)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
}, {
    height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4,
    flattenAtPorts: true,
    walkable: true,
});
exports.TILE_PLATFORM = new TileDef(1, 'platform', '高台', {
    baseHsl: { h: 0.0741, s: 0.4206, l: 0.5804 }, // RGB(193,143,103)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true, // 拉丝金属
}, {
    height: 1.8, heightJitterRange: 0.4,
    walkable: true,
});
exports.TILE_PIT = new TileDef(2, 'pit', '坑洞', {
    baseHsl: { h: 0.98, s: 0.60, l: 0.22 }, // 暗血红警示（ACES 补偿后）
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: true,
    patches: true,
    patchHalf: true, // 警示色保持醒目
    borderLine: true,
}, {
    height: -3.0,
    walkable: false,
    lethal: true,
});
exports.TILE_WATER = new TileDef(4, 'water', '水域', {
    baseHsl: { h: 0.58, s: 0.52, l: 0.30 }, // 可辨识深蓝
    jitter: { h: 0, s: 0, l: 0 }, // 液体均质不抖
    depression: true,
    patches: false, // 水面无色阶斑块
    borderLine: false, // 水面无内描边
}, {
    height: -0.5,
    walkable: false,
});
/** 预留位（旧 SLOPE 编号，暂未启用） */
exports.TILE_SLOPE = new TileDef(3, 'slope', '坡道（预留）', { baseHsl: exports.TILE_FLAT.visual.baseHsl, jitter: exports.TILE_FLAT.visual.jitter, depression: false }, { height: 0, walkable: true });
// ============================================================
// 注册表
// ============================================================
const REGISTRY = new Map();
for (const t of [exports.TILE_FLAT, exports.TILE_PLATFORM, exports.TILE_PIT, exports.TILE_SLOPE, exports.TILE_WATER]) {
    if (REGISTRY.has(t.id))
        throw new Error(`[Tiles] 地块 id 冲突: ${t.id}`);
    REGISTRY.set(t.id, t);
}
/** 按 id 取地块定义（未知 id 回退平地，防未加载/越界崩溃） */
function tileById(id) {
    return REGISTRY.get(id) ?? exports.TILE_FLAT;
}
/**
 * ★ 扩展点：注册自定义地块（更丰富的地块走这里）。
 * id 必须未占用；建议从 10 起步给玩法自定义类型留空间。
 */
function registerTile(def) {
    if (REGISTRY.has(def.id))
        throw new Error(`[Tiles] 地块 id 已存在: ${def.id} (${def.key})`);
    REGISTRY.set(def.id, def);
}
/** 全部已注册地块（遍历用） */
function allTiles() {
    return [...REGISTRY.values()];
}
