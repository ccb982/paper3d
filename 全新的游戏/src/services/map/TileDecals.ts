// ============================================================
// TileDecals —— 装饰性纹理贴图注册表（独立于地块列表）
// ============================================================
// 定位：不是地块（不参与生成器结构/物理），是地形生成完成后、
//       渲染前叠在地块表面上的程序化纹理装饰。
//
// 设计（2026-08-26 定稿）：
//   - 与地块/组同构：每个贴图声明所属组（多对多）→ 组面板决定
//     本 chunk 哪些贴图活跃；placement 决定贴图长在哪些地块上
//   - 自主决定：散布由确定性 hash 驱动（同 seed 同坐标必复现）
//   - 渲染：阶段二并入 TerrainMaterial 的 shader 图案层
//     （贴图 = 地块图案函数的叠加层，专用/独占天然成立）
//
// 本文件阶段一仅立契约与注册表；planChunkDecals 在阶段二实现。
// ============================================================

/** 贴图可生长的地块角色（装饰贴图只贴可走表面） */
export type DecalHostRole = 'ground' | 'platform';

export interface DecalPlacement {
  /** 可生长的地块 key（留空 = 不限，但受 hostRole 约束） */
  tiles?: string[];
  /** 可生长角色（ground/platform；液体/坑洞默认不可贴） */
  hostRole: DecalHostRole[];
  /** 每 chunk 期望出现个数（阶段二消耗；散布 salt 由 seed+cx+cz 派生） */
  perChunk: number;
  /** 尺度（米，贴图特征尺寸） */
  scaleRange: [number, number];
}

export interface DecalDef {
  key: string;
  label: string;
  /** 所属风格组（多对多；空 = 任意组均可用） */
  groups: string[];
  placement: DecalPlacement;
  /** 阶段二：shader 图案参数（叠加层的噪声种/对比度/色调偏移等） */
  pattern: Record<string, number>;
}

const REGISTRY = new Map<string, DecalDef>();

export function registerDecal(def: DecalDef): void {
  if (REGISTRY.has(def.key)) throw new Error(`[TileDecals] 贴图 key 已存在: ${def.key}`);
  REGISTRY.set(def.key, def);
}

export function decalByKey(key: string): DecalDef | undefined {
  return REGISTRY.get(key);
}

export function allDecals(): DecalDef[] {
  return [...REGISTRY.values()];
}

/** 按组取可用贴图（组面板消费） */
export function decalsByGroup(groupKey: string): DecalDef[] {
  return [...REGISTRY.values()].filter((d) => d.groups.length === 0 || d.groups.includes(groupKey));
}

// ============================================================
// 规划入口（阶段二实现）
// ============================================================

export interface PlannedDecal {
  decalKey: string;
  /** 贴图中心的世界坐标 */
  x: number;
  z: number;
  /** 尺度（米） */
  scale: number;
  /** 变体盐（同种贴图不同形态） */
  variant: number;
}

/**
 * ★ 阶段二：地形生成完成后、渲染前调用。
 * 消费 ChunkData.blockTypes → 按贴图注册表 + 组面板散布贴图。
 * 阶段一仅占位返回空数组（渲染层未接入）。
 */
export function planChunkDecals(
  _seed: number, _cx: number, _cz: number,
  _blockTypes: Uint8Array, _groupKey: string,
): PlannedDecal[] {
  return [];
}
