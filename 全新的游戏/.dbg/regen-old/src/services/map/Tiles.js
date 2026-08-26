"use strict";
// ============================================================
// Tiles —— 地块基类与注册表（数据驱动封装）
// ============================================================
// 设计目标：加一种新地块 = 在注册处登记一个对象。
// 地块属性自足：角色 / 物理 / 外观参数 / 组归属 全部内聚在此。
//
//   genRole  —— 生成器消费：结构槽位匹配（ground/platform/liquid/pit）
//   physics  —— 高度分配/连通性/碰撞消费
//   visual   —— 表现层消费（阶段二起由 shader 图案库按此参数程序化生成）
//   groups   —— 所属风格组（多对多；见 TileGroups.ts）
//
// ⚠️ 行为兼容承诺：
//   - 内置基础 5 类的物理数值与历史版本逐项一致（回归基线依赖）
//   - 装饰性地块(10~15)的物理数值与其对应基础类严格一致
//     （ice/ash/mud ≙ flat；*_platform 走同一梯田带公式）——
//     保证"换皮不改结构"，固定 seed 下 walkable/heights 逐位不变
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.TILE_MOSSY_PLATFORM = exports.TILE_ICE_PLATFORM = exports.TILE_ROCK_PLATFORM = exports.TILE_MUD = exports.TILE_ASH_FIELD = exports.TILE_ICE = exports.TILE_SLOPE = exports.TILE_WATER = exports.TILE_PIT = exports.TILE_PLATFORM = exports.TILE_FLAT = exports.TileDef = void 0;
exports.tileById = tileById;
exports.tileByKey = tileByKey;
exports.registerTile = registerTile;
exports.allTiles = allTiles;
const TerrainPalette_1 = require("./TerrainPalette");
// ============================================================
// TileDef 基类
// ============================================================
class TileDef {
    constructor(id, key, label, genRole, visual, physics, 
    /** 所属风格组（多对多；空 = 不参与任何组抽取，如保留位） */
    groups = []) {
        this.id = id;
        this.key = key;
        this.label = label;
        this.genRole = genRole;
        this.visual = visual;
        this.physics = physics;
        this.groups = groups;
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
// 内置基础地块（物理数值 = 历史版本原值，逐项核对过）
// ============================================================
exports.TILE_FLAT = new TileDef(0, 'flat', '平地/路', 'ground', {
    baseHsl: { h: 0.0854, s: 0.3628, l: 0.4431 }, // RGB(154,114,72)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
}, {
    height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4,
    flattenAtPorts: true,
    walkable: true,
}, ['foundation']);
exports.TILE_PLATFORM = new TileDef(1, 'platform', '高台', 'platform', {
    baseHsl: { h: 0.0741, s: 0.4206, l: 0.5804 }, // RGB(193,143,103)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true, // 拉丝金属
}, {
    height: 1.8, heightJitterRange: 0.4,
    walkable: true,
}, ['foundation']);
exports.TILE_PIT = new TileDef(2, 'pit', '坑洞', 'pit', {
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
}, ['foundation']);
exports.TILE_WATER = new TileDef(4, 'water', '水域', 'liquid', {
    baseHsl: { h: 0.58, s: 0.52, l: 0.30 }, // 可辨识深蓝
    jitter: { h: 0, s: 0, l: 0 }, // 液体均质不抖
    depression: true,
    patches: false, // 水面无色阶斑块
    borderLine: false, // 水面无内描边
}, {
    height: -0.5,
    walkable: false,
}, ['foundation']);
/** 预留位（旧 SLOPE 编号，暂未启用；不入任何组 → 永不被抽中） */
exports.TILE_SLOPE = new TileDef(3, 'slope', '坡道（预留）', 'ground', { baseHsl: exports.TILE_FLAT.visual.baseHsl, jitter: exports.TILE_FLAT.visual.jitter, depression: false }, { height: 0, walkable: true });
// ============================================================
// 装饰性地块（id 从 10 起；物理数值严格 ≙ 对应基础类 —— 换皮不改结构）
// ============================================================
/** 冰面（装饰平面）：霜蓝结晶风格主打 */
exports.TILE_ICE = new TileDef(10, 'ice', '冰面', 'ground', {
    baseHsl: { h: 0.55, s: 0.30, l: 0.72 },
    jitter: { h: 0.006, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
}, { height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4, flattenAtPorts: true, walkable: true }, ['crystal']);
/** 灰烬地（装饰平面）：废土主打 */
exports.TILE_ASH_FIELD = new TileDef(11, 'ash_field', '灰烬地', 'ground', {
    baseHsl: { h: 0.05, s: 0.06, l: 0.32 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
}, { height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4, flattenAtPorts: true, walkable: true }, ['ashen']);
/** 泥沼地（装饰平面）：湿润过渡 */
exports.TILE_MUD = new TileDef(12, 'mud', '泥沼地', 'ground', {
    baseHsl: { h: 0.08, s: 0.38, l: 0.26 },
    jitter: { h: 0.006, s: 0.03, l: 0.04 },
    depression: false,
    borderLine: true,
}, { height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4, flattenAtPorts: true, walkable: true }, ['ashen', 'overgrown']);
/** 岩台（装饰高台）：废土高台变体 */
exports.TILE_ROCK_PLATFORM = new TileDef(13, 'rock_platform', '岩台', 'platform', {
    baseHsl: { h: 0.08, s: 0.12, l: 0.42 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
}, { height: 1.8, heightJitterRange: 0.4, walkable: true }, ['ashen', 'foundation']);
/** 冰台（装饰高台）：结晶高台变体 */
exports.TILE_ICE_PLATFORM = new TileDef(14, 'ice_platform', '冰台', 'platform', {
    baseHsl: { h: 0.55, s: 0.22, l: 0.66 },
    jitter: { h: 0.006, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    streaks: true,
}, { height: 1.8, heightJitterRange: 0.4, walkable: true }, ['crystal']);
/** 苔台（装饰高台）：蔓生高台变体 */
exports.TILE_MOSSY_PLATFORM = new TileDef(15, 'mossy_platform', '苔台', 'platform', {
    baseHsl: { h: 0.30, s: 0.35, l: 0.40 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
}, { height: 1.8, heightJitterRange: 0.4, walkable: true }, ['overgrown']);
// ============================================================
// 注册表
// ============================================================
const REGISTRY = new Map();
const KEY_INDEX = new Map();
for (const t of [
    exports.TILE_FLAT, exports.TILE_PLATFORM, exports.TILE_PIT, exports.TILE_SLOPE, exports.TILE_WATER,
    exports.TILE_ICE, exports.TILE_ASH_FIELD, exports.TILE_MUD,
    exports.TILE_ROCK_PLATFORM, exports.TILE_ICE_PLATFORM, exports.TILE_MOSSY_PLATFORM,
]) {
    if (REGISTRY.has(t.id))
        throw new Error(`[Tiles] 地块 id 冲突: ${t.id}`);
    REGISTRY.set(t.id, t);
    KEY_INDEX.set(t.key, t);
}
/** 按 id 取地块定义（未知 id 回退平地，防未加载/越界崩溃） */
function tileById(id) {
    return REGISTRY.get(id) ?? exports.TILE_FLAT;
}
/** 按 key 取地块定义（组权重表以 key 引用成员） */
function tileByKey(key) {
    return KEY_INDEX.get(key);
}
/**
 * ★ 扩展点：注册自定义地块（更丰富的地块走这里）。
 * id 必须未占用；key 必须未占用。
 */
function registerTile(def) {
    if (REGISTRY.has(def.id))
        throw new Error(`[Tiles] 地块 id 已存在: ${def.id} (${def.key})`);
    if (KEY_INDEX.has(def.key))
        throw new Error(`[Tiles] 地块 key 已存在: ${def.key}`);
    REGISTRY.set(def.id, def);
    KEY_INDEX.set(def.key, def);
}
/** 全部已注册地块（遍历用） */
function allTiles() {
    return [...REGISTRY.values()];
}
