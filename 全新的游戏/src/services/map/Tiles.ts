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

import type { Hsl } from './TerrainPalette';
import { hsl2rgb } from './TerrainPalette';

// ============================================================
// 属性描述接口
// ============================================================

/** 外观层属性（ChunkAppearance.bake 消费） */
export interface TileVisual {
  /** 基准色（显示空间 HSL） */
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
}

/** 物理与生成层属性（ChunkGenerator 消费） */
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
}

// ============================================================
// TileDef
// ============================================================

export class TileDef {
  constructor(
    public readonly id: number,
    public readonly key: string,
    public readonly label: string,
    public readonly visual: TileVisual,
    public readonly physics: TilePhysics,
  ) {}

  get isDepression(): boolean {
    return this.visual.depression;
  }

  /** 基准色 RGB（显示空间；小地图等直接消费） */
  get baseRgb(): [number, number, number] {
    return hsl2rgb(this.visual.baseHsl.h, this.visual.baseHsl.s, this.visual.baseHsl.l);
  }
}

// ============================================================
// 内置地块（数值 = 重构前各文件中的原值，逐一核对过）
// ============================================================

export const TILE_FLAT = new TileDef(
  0, 'flat', '平地/路',
  {
    baseHsl: { h: 0.0854, s: 0.3628, l: 0.4431 },          // RGB(154,114,72)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
  },
  {
    height: 0, heightJitterBase: -0.1, heightJitterRange: 0.4,
    flattenAtPorts: true,
    walkable: true,
  },
);

export const TILE_PLATFORM = new TileDef(
  1, 'platform', '高台',
  {
    baseHsl: { h: 0.0741, s: 0.4206, l: 0.5804 },          // RGB(193,143,103)
    jitter: { h: 0.008, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,                                          // 拉丝金属
  },
  {
    height: 1.8, heightJitterRange: 0.4,
    walkable: true,
  },
);

export const TILE_PIT = new TileDef(
  2, 'pit', '坑洞',
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
);

export const TILE_WATER = new TileDef(
  4, 'water', '水域',
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
);

/** 预留位（旧 SLOPE 编号，暂未启用） */
export const TILE_SLOPE = new TileDef(
  3, 'slope', '坡道（预留）',
  { baseHsl: TILE_FLAT.visual.baseHsl, jitter: TILE_FLAT.visual.jitter, depression: false },
  { height: 0, walkable: true },
);

// ============================================================
// 注册表
// ============================================================

const REGISTRY = new Map<number, TileDef>();
for (const t of [TILE_FLAT, TILE_PLATFORM, TILE_PIT, TILE_SLOPE, TILE_WATER]) {
  if (REGISTRY.has(t.id)) throw new Error(`[Tiles] 地块 id 冲突: ${t.id}`);
  REGISTRY.set(t.id, t);
}

/** 按 id 取地块定义（未知 id 回退平地，防未加载/越界崩溃） */
export function tileById(id: number): TileDef {
  return REGISTRY.get(id) ?? TILE_FLAT;
}

/**
 * ★ 扩展点：注册自定义地块（更丰富的地块走这里）。
 * id 必须未占用；建议从 10 起步给玩法自定义类型留空间。
 */
export function registerTile(def: TileDef): void {
  if (REGISTRY.has(def.id)) throw new Error(`[Tiles] 地块 id 已存在: ${def.id} (${def.key})`);
  REGISTRY.set(def.id, def);
}

/** 全部已注册地块（遍历用） */
export function allTiles(): TileDef[] {
  return [...REGISTRY.values()];
}
