// ============================================================
// TileProps —— 实体地形装饰注册表（有实体但属于地图一部分）
// ============================================================
// 定位：静态几何装饰（碎石/晶簇/枯木…），随 chunk 生灭，
//       不进 EntityManager/空间索引/AI——是"地图的一部分"。
//
// 设计（2026-08-26 定稿）：
//   - 与地块/组同构：每个装饰物声明所属组（多对多）
//   - 自主决定：散布由确定性 hash 驱动（同 seed 同坐标必复现）
//   - 顺序：地形生成完成后（拿到 blockTypes）再散布，然后渲染
//   - 渲染：阶段三 InstancedMesh（程序化几何优先；billboard 预留）
//
// 本文件阶段一仅立契约与注册表；planChunkProps 在阶段三实现。
// ============================================================

/** 装饰物可生长的地块角色 */
export type PropHostRole = 'ground' | 'platform';

export interface PropPlacement {
  /** 可生长的地块 key（留空 = 不限，但受 hostRole 约束） */
  tiles?: string[];
  /** 可生长角色 */
  hostRole: PropHostRole[];
  /** 抖动网格 cell 出现概率（3m cell；150 网格每 chunk） */
  perCellProb: number;
  /** 缩放范围（乘数） */
  scaleRange: [number, number];
  /** 下沉量（米，防悬浮） */
  sinkIntoGround?: number;
  /** 出生保护区（世界坐标 + 半径；规划期排除） */
  keepClear?: { x: number; z: number; r: number };
}

export interface PropDef {
  key: string;
  label: string;
  /** 所属风格组（多对多；空 = 任意组均可用） */
  groups: string[];
  placement: PropPlacement;
  /**
   * 阶段三：程序化几何工厂（module 级共享 geometry/material）。
   * three 依赖只允许出现在渲染适配层，规划层保持纯函数。
   */
  render: 'instanced' | 'billboard';   // v1 只实现 instanced
}

const REGISTRY = new Map<string, PropDef>();

export function registerProp(def: PropDef): void {
  if (REGISTRY.has(def.key)) throw new Error(`[TileProps] 装饰物 key 已存在: ${def.key}`);
  REGISTRY.set(def.key, def);
}

export function propByKey(key: string): PropDef | undefined {
  return REGISTRY.get(key);
}

export function allProps(): PropDef[] {
  return [...REGISTRY.values()];
}

/** 按组取可用装饰物（组面板消费） */
export function propsByGroup(groupKey: string): PropDef[] {
  return [...REGISTRY.values()].filter((p) => p.groups.length === 0 || p.groups.includes(groupKey));
}

// ============================================================
// 规划入口（阶段三实现）
// ============================================================

export interface PlannedProp {
  propKey: string;
  x: number;
  z: number;
  y: number;          // surfaceHeightAt 落地 + sink
  scale: number;
  rotY: number;
  variant: number;
}

/**
 * ★ 阶段三：地形生成完成后、渲染前调用。
 * 消费 ChunkData.blockTypes + RasterMap 高度 → 按装饰物注册表 + 组面板散布。
 * 阶段一仅占位返回空数组（渲染层未接入）。
 */
export function planChunkProps(
  _seed: number, _cx: number, _cz: number,
  _blockTypes: Uint8Array, _groupKey: string,
): PlannedProp[] {
  return [];
}
