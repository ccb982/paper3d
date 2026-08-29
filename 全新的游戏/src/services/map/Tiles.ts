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
// ★ 类型/材质分离铁律（2026-08-28 定稿，详见《地块与装饰架构.md》§1.0）：
//   类型 = genRole + physics —— 封闭集合，必须确定（四基础类型 + 装饰变体；
//          变体 physics 必须 ≙ 基础类型，换皮不改结构）
//   材质 = visual.material + baseHsl + key/label —— 完全自由（名字/材质/颜色任意）
//   加类型 = 体系决策（慎）；加材质皮 = 日常内容（注册即生效）
//
// ⚠️ 行为兼容承诺：
//   - 内置基础 5 类的物理数值与历史版本逐项一致（回归基线依赖）
//   - 装饰性地块(10~15)的物理数值与其对应基础类严格一致
//     （ice/ash/mud ≙ flat；*_platform 走同一梯田带公式）——
//     保证"换皮不改结构"，固定 seed 下 walkable/heights 逐位不变
// ============================================================

import type { Hsl } from './TerrainPalette';
import { hsl2rgb } from './TerrainPalette';

// ============================================================
// 角色（生成器结构槽位 ↔ 地块匹配的唯一维度）
// ============================================================

export type TileGenRole = 'ground' | 'platform' | 'liquid' | 'pit';

// ============================================================
// 属性描述接口
// ============================================================

/** 外观层属性（表现层消费；阶段二起为 shader 图案库的输入参数） */
export interface TileVisual {
  /** 基准色（显示空间 HSL）——JS/GLSL 两端共用的唯一颜色真源 */
  baseHsl: Hsl;
  /** 逐地块抖动幅度（世界tile坐标 hash2 派生；0 = 均质不抖，如水面） */
  jitter: { h: number; s: number; l: number };
  /** 凹陷地块：表面按 ≤0 平面均匀着色（无邻域AO）；侧壁>0 部分自动转平地材质 */
  depression: boolean;
  /** 色阶化斑块开关（水域关闭；pit 减半幅度） */
  patches?: boolean;
  patchHalf?: boolean;
  /** 地块内描边（贴边压暗圈）——默认开启，水面关闭 */
  borderLine?: boolean;
  /** 方向性拉丝（平台拉丝金属） */
  streaks?: boolean;
  /**
   * ★ 地块自挂材质（2026-08-27 定稿）：材质是地块的属性——
   * fnId 在 TileMaterials 注册表登记（GLSL 材质函数阶段二实现），
   * params 覆盖材质默认参数（同 fnId 不同 params = 变体）。
   * 材质决定"这块地是什么"；装饰纹理（TileDecalBase）独立叠加，
   * 决定"这块地上长了什么"。
   */
  material?: { fnId: string; params?: Record<string, number> };
}

/** 物理与生成层属性（生成器/碰撞消费） */
export interface TilePhysics {
  /** 基础高度（米） */
  height: number;
  /** 高度随机扰动的基址偏移与幅度（final = height + base + rand*range） */
  heightJitterBase?: number;
  heightJitterRange?: number;
  /** 端口格强制回到基础高度（保证跨 chunk 顺滑衔接；仅道路用） */
  flattenAtPorts?: boolean;
  walkable: boolean;
  /** 接触即死（坑洞） */
  lethal?: boolean;
  /**
   * ★ 边缘裁决覆盖（《地形边缘裁决与视觉面架构.md》§2.1 规则链位次 1）：
   * 'hard' = 本地块一切边强制硬边界（cliff）；'smooth' = 强制插值过渡（weld，
   * 如未来 TILE_SLOPE 坡道）；缺省 = 走 β 微高差规则。类型层决策，材质不参与。
   */
  edgePolicy?: 'smooth' | 'hard';
}

// ============================================================
// TileDef 基类
// ============================================================

export class TileDef {
  constructor(
    public readonly id: number,
    public readonly key: string,
    public readonly label: string,
    public readonly genRole: TileGenRole,
    public readonly visual: TileVisual,
    public readonly physics: TilePhysics,
    /** 所属风格组（多对多；空 = 不参与任何组抽取，如保留位） */
    public readonly groups: string[] = [],
  ) {}

  get isDepression(): boolean {
    return this.visual.depression;
  }

  /** 基准色 RGB（显示空间；小地图等直接消费） */
  get baseRgb(): [number, number, number] {
    return hsl2rgb(this.visual.baseHsl.h, this.visual.baseHsl.s, this.visual.baseHsl.l);
  }
}

/**
 * ★ 地块类型名（类型封闭原则的显示侧；id≥10 = 装饰变体是本表既有约定）。
 * 六类型：平地 / 高台 / 水 / 坑洞 / 装饰性平地 / 装饰性高台。
 */
export function tileTypeName(td: TileDef): string {
  switch (td.genRole) {
    case 'liquid': return '水';
    case 'pit': return '坑洞';
    case 'ground': return td.id >= 10 ? '装饰性平地' : '平地';
    case 'platform': return td.id >= 10 ? '装饰性高台' : '高台';
  }
}

/** 类型显示顺序（面板/图例统一用） */
export const TILE_TYPE_ORDER = ['平地', '装饰性平地', '高台', '装饰性高台', '水', '坑洞'] as const;

// ============================================================
// 内置基础地块（物理数值 = 历史版本原值，逐项核对过）
// ============================================================

export const TILE_FLAT = new TileDef(
  0, 'flat', '平地/路', 'ground',
  {
    baseHsl: { h: 0.0854, s: 0.3628, l: 0.4431 },          // RGB(154,114,72)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: 'dirt' },                            // ★ 纯泥土地面
  },
  {
    height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true,
  },
  ['foundation'],
);

export const TILE_PLATFORM = new TileDef(
  1, 'platform', '高台', 'platform',
  {
    baseHsl: { h: 0.0741, s: 0.4206, l: 0.5804 },          // RGB(193,143,103)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,                                          // 拉丝金属
    material: { fnId: 'rock' },                             // ★ 岩石材质
  },
  {
    height: 1.8, heightJitterRange: 0.4,
    walkable: true,
  },
  ['foundation'],
);

export const TILE_PIT = new TileDef(
  2, 'pit', '坑洞', 'pit',
  {
    baseHsl: { h: 0.98, s: 0.60, l: 0.22 },                // 暗血红警示（ACES 补偿后）
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: true,
    patches: true,
    patchHalf: true,                                        // 警示色保持醒目
    borderLine: true,
  },
  {
    height: -3.0,
    walkable: false,
    lethal: true,
  },
  ['foundation'],
);

export const TILE_WATER = new TileDef(
  4, 'water', '水域', 'liquid',
  {
    baseHsl: { h: 0.58, s: 0.52, l: 0.30 },                // 可辨识深蓝
    jitter: { h: 0, s: 0, l: 0 },                          // 液体均质不抖
    depression: true,
    patches: false,                                         // 水面无色阶斑块
    borderLine: false,                                      // 水面无内描边
  },
  {
    height: -0.5,
    walkable: false,
  },
  ['foundation'],
);

/** 预留位（旧 SLOPE 编号，暂未启用；不入任何组 → 永不被抽中） */
export const TILE_SLOPE = new TileDef(
  3, 'slope', '坡道（预留）', 'ground',
  { baseHsl: TILE_FLAT.visual.baseHsl, jitter: TILE_FLAT.visual.jitter, depression: false },
  { height: 0, walkable: true },
);

// ============================================================
// 装饰性地块（id 从 10 起；物理数值严格 ≙ 对应基础类 —— 换皮不改结构）
// ============================================================

/** 冰面（装饰平面）：霜蓝结晶风格主打 */
export const TILE_ICE = new TileDef(
  10, 'ice', '冰面', 'ground',
  {
    baseHsl: { h: 0.55, s: 0.30, l: 0.72 },
    jitter: { h: 0.006, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
  },
  { height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16, flattenAtPorts: true, walkable: true },
  ['crystal'],
);

/** 灰烬地（装饰平面）：废土主打 */
export const TILE_ASH_FIELD = new TileDef(
  11, 'ash_field', '灰烬地', 'ground',
  {
    baseHsl: { h: 0.05, s: 0.06, l: 0.32 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
  },
  { height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16, flattenAtPorts: true, walkable: true },
  ['ashen'],
);

/** 泥沼地（装饰平面）：湿润过渡 */
export const TILE_MUD = new TileDef(
  12, 'mud', '泥沼地', 'ground',
  {
    baseHsl: { h: 0.08, s: 0.38, l: 0.26 },
    jitter: { h: 0.006, s: 0.03, l: 0.04 },
    depression: false,
    borderLine: true,
  },
  { height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16, flattenAtPorts: true, walkable: true },
  ['ashen', 'overgrown'],
);

/** 岩台（装饰高台）：废土高台变体 */
export const TILE_ROCK_PLATFORM = new TileDef(
  13, 'rock_platform', '岩台', 'platform',
  {
    baseHsl: { h: 0.08, s: 0.12, l: 0.42 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: 'rock', params: { strata: 0.24, cracks: 0.14 } }, // ★ 岩台（更粗粝）
  },
  { height: 1.8, heightJitterRange: 0.4, walkable: true },
  ['ashen'],
);

/** 冰台（装饰高台）：结晶高台变体 */
export const TILE_ICE_PLATFORM = new TileDef(
  14, 'ice_platform', '冰台', 'platform',
  {
    baseHsl: { h: 0.55, s: 0.22, l: 0.66 },
    jitter: { h: 0.006, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    streaks: true,
  },
  { height: 1.8, heightJitterRange: 0.4, walkable: true },
  ['crystal'],
);

/** 苔台（装饰高台）：蔓生高台变体 */
export const TILE_MOSSY_PLATFORM = new TileDef(
  15, 'mossy_platform', '苔台', 'platform',
  {
    baseHsl: { h: 0.30, s: 0.35, l: 0.40 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: 'moss' },                             // ★ 苔藓材质
  },
  { height: 1.8, heightJitterRange: 0.4, walkable: true },
  ['overgrown'],
);

// ============================================================
// 路面材质专用地块（让 brick/grass/wood 三个材质投入使用）
// genRole=ground → 作为 PATH 装饰斑块成片出现；基色由材质 shader 调制
//   （albedo 走白底，颜色来自 uMatBase = 本表 baseHsl × mat_xxx 图案）
// ============================================================

/** 砖石路面（brick 材质；废墟/城镇基调） */
export const TILE_BRICK = new TileDef(
  16, 'brick', '砖石路', 'ground',
  {
    baseHsl: { h: 0.08, s: 0.18, l: 0.42 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: 'brick' },
  },
  {
    height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16,
    flattenAtPorts: true, walkable: true,
  },
  ['ashen'],
);

/** 草地路面（grass 材质；沃绿蔓生基调） */
export const TILE_GRASS = new TileDef(
  17, 'grass', '草地', 'ground',
  {
    baseHsl: { h: 0.30, s: 0.32, l: 0.38 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: 'grass' },
  },
  {
    height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16,
    flattenAtPorts: true, walkable: true,
  },
  ['overgrown'],
);

/** 木板路面（wood 材质；栈道/木桥基调） */
export const TILE_WOOD = new TileDef(
  18, 'wood', '木板路', 'ground',
  {
    baseHsl: { h: 0.07, s: 0.35, l: 0.30 },
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: 'wood' },
  },
  {
    height: 0, heightJitterBase: -0.04, heightJitterRange: 0.16,
    flattenAtPorts: true, walkable: true,
  },
  ['overgrown'],
);

// ============================================================
// 注册表
// ============================================================

const REGISTRY = new Map<number, TileDef>();
const KEY_INDEX = new Map<string, TileDef>();
for (const t of [
  TILE_FLAT, TILE_PLATFORM, TILE_PIT, TILE_SLOPE, TILE_WATER,
  TILE_ICE, TILE_ASH_FIELD, TILE_MUD,
  TILE_ROCK_PLATFORM, TILE_ICE_PLATFORM, TILE_MOSSY_PLATFORM,
  TILE_BRICK, TILE_GRASS, TILE_WOOD,
]) {
  if (REGISTRY.has(t.id)) throw new Error(`[Tiles] 地块 id 冲突: ${t.id}`);
  REGISTRY.set(t.id, t);
  KEY_INDEX.set(t.key, t);
}

/** 按 id 取地块定义（未知 id 回退平地，防未加载/越界崩溃） */
export function tileById(id: number): TileDef {
  return REGISTRY.get(id) ?? TILE_FLAT;
}

/** 按 key 取地块定义（组权重表以 key 引用成员） */
export function tileByKey(key: string): TileDef | undefined {
  return KEY_INDEX.get(key);
}

/**
 * ★ 扩展点：注册自定义地块（更丰富的地块走这里）。
 * id 必须未占用；key 必须未占用。
 */
export function registerTile(def: TileDef): void {
  if (REGISTRY.has(def.id)) throw new Error(`[Tiles] 地块 id 已存在: ${def.id} (${def.key})`);
  if (KEY_INDEX.has(def.key)) throw new Error(`[Tiles] 地块 key 已存在: ${def.key}`);
  REGISTRY.set(def.id, def);
  KEY_INDEX.set(def.key, def);
}

/** 全部已注册地块（遍历用） */
export function allTiles(): TileDef[] {
  return [...REGISTRY.values()];
}
