// ============================================================
// TileDecalBase —— 装饰性纹理贴图基类（库：声明/规划/烘焙印章）
// ============================================================
// 架构（2026-08-27 基类化整理）：
//   ┌─ 基类 TileDecalBase：一张贴图的全部声明——
//   │    组归属 / 放置规则 / 图案函数与参数
//   │    ★ 烘焙：stampInto 基类统一实现——按 pattern.fnId 查图案注册表执行
//   ├─ 图案注册表：registerDecalPattern(fnId, 印章函数) —— 加新图案 = 注册函数
//   ├─ 库（注册表）：registerDecal(实例) —— 加新贴图 = 注册实例
//   ├─ 规划：planChunkDecals（确定性散布，纯函数，零 three）
//   └─ 烘焙：applyDecalStamps → 各实例 stampInto → 图案函数印进 albedo
//       （顺序绑定：贴图全部放置完 → 触发预渲染 → 本函数消费）
// ============================================================

import { hash2 } from '../TerrainNoise';
import { tileById, type TileDef } from '../Tiles';

/** 贴图可生长的地块角色（装饰贴图只贴可走表面） */
export type DecalHostRole = 'ground' | 'platform';

export interface DecalPlacement {
  /** 可生长的地块 key（空 = 不限，但受 hostRole 约束） */
  tiles?: string[];
  /** 可生长角色 */
  hostRole: DecalHostRole[];
  /** 期望密度（每 chunk 出现的 cell 比例，0~1；实际受 20×20 cell 数约束） */
  density: number;
  /** 尺度范围（米） */
  scaleRange: [number, number];
}

export interface TileDecalConfig {
  key: string;
  label: string;
  /** 所属风格组（多对多；空 = 任意组均可用） */
  groups: string[];
  placement: DecalPlacement;
  /** shader/烘焙图案函数标识 + 参数（fnId 在图案注册表登记） */
  pattern: { fnId: string; params: Record<string, number> };
}

/**
 * ★ 装饰性纹理贴图基类。
 * 实例 = 声明（配置数据），基类 = 行为（印章调度的统一实现）。
 */
export class TileDecalBase {
  readonly key: string;
  readonly label: string;
  readonly groups: string[];
  readonly placement: DecalPlacement;
  readonly pattern: { fnId: string; params: Record<string, number> };

  constructor(cfg: TileDecalConfig) {
    this.key = cfg.key;
    this.label = cfg.label;
    this.groups = cfg.groups;
    this.placement = cfg.placement;
    this.pattern = cfg.pattern;
  }

  /**
   * ★ 烘焙印章（基类统一实现）：按 pattern.fnId 查图案注册表执行。
   * 图案函数只写自己的 bbox；纯函数（Uint8ClampedArray 直写），Worker 可用。
   */
  stampInto(
    out: Uint8ClampedArray, S: number,
    originX: number, originZ: number,
    decal: PlannedDecal, seed: number,
  ): void {
    const fn = PATTERNS.get(this.pattern.fnId);
    fn?.(out, S, originX, originZ, decal, seed, this.pattern.params);
  }
}

// ============================================================
// 图案注册表（加新图案 = 注册一个函数；同 fnId 未来可接 shader 图案库）
// ============================================================

/** 图案印章函数签名（out 为 albedo RGBA 缓冲，S=分辨率） */
export type DecalStampFn = (
  out: Uint8ClampedArray, S: number,
  originX: number, originZ: number,
  decal: PlannedDecal, seed: number, params: Record<string, number>,
) => void;

const PATTERNS = new Map<string, DecalStampFn>();

/** ★ 扩展点：注册图案函数（'speckle'/'blotch' 内置；自定义图案走这里） */
export function registerDecalPattern(fnId: string, fn: DecalStampFn): void {
  if (PATTERNS.has(fnId)) throw new Error(`[TileDecal] 图案 fnId 已存在: ${fnId}`);
  PATTERNS.set(fnId, fn);
}

// ============================================================
// 库（注册表）
// ============================================================

const REGISTRY = new Map<string, TileDecalBase>();

/** ★ 扩展点：注册贴图（加内容 = 注册一个基类实例） */
export function registerDecal(decal: TileDecalBase): void {
  if (REGISTRY.has(decal.key)) throw new Error(`[TileDecal] 贴图 key 已存在: ${decal.key}`);
  REGISTRY.set(decal.key, decal);
}

export function decalByKey(key: string): TileDecalBase | undefined {
  return REGISTRY.get(key);
}

export function allDecals(): TileDecalBase[] {
  return [...REGISTRY.values()];
}

/** 按组取可用贴图（组面板消费；空组声明 = 通用；foundation = 兜底通用） */
export function decalsForGroup(groupKey: string): TileDecalBase[] {
  return [...REGISTRY.values()].filter(
    (d) => d.groups.length === 0 || d.groups.includes(groupKey) || d.groups.includes(FOUNDATION_DECAL_GROUP),
  );
}

/** 基石兜底组 key（基石组的贴图 = 任何 chunk 都可出现，与地块回退链同哲学） */
export const FOUNDATION_DECAL_GROUP = 'foundation';

// ============================================================
// 内置图案
// ============================================================

/** 碎屑斑点：bbox 内确定性撒 ~5+2v 个暗点（乘性变暗；淡到几乎无感的占位） */
registerDecalPattern('speckle', (out, S, _ox, _oz, d, seed, _params) => {
  const step = 60 / S;
  const pcx = Math.floor((d.cellX * DECAL_CELL + d.ox * DECAL_CELL) / step);
  const pcz = Math.floor((d.cellY * DECAL_CELL + d.oy * DECAL_CELL) / step);
  const pr = Math.ceil(d.scale / step) + 1;
  const count = 5 + d.variant * 2;
  const dotR = Math.max(1, Math.floor(d.scale / 60 * S * 0.10));
  const darken = 0.86 + d.variant * 0.02;
  for (let k = 0; k < count; k++) {
    const dx = (hash2(k, d.variant, seed + 9701) - 0.5) * 2 * pr;
    const dy = (hash2(k, d.variant, seed + 9702) - 0.5) * 2 * pr;
    // ★ 点中心必须取整到像素坐标（小数索引写入 Uint8ClampedArray 会静默落空）
    const ix = Math.floor(pcx + dx), iy = Math.floor(pcz + dy);
    for (let j = Math.max(0, iy - dotR); j <= Math.min(S - 1, iy + dotR); j++) {
      for (let i = Math.max(0, ix - dotR); i <= Math.min(S - 1, ix + dotR); i++) {
        const rr = (i - ix) * (i - ix) + (j - iy) * (j - iy);
        if (rr > dotR * dotR) continue;
        const o = (j * S + i) * 4;
        out[o] = Math.min(255, out[o] * darken);
        out[o + 1] = Math.min(255, out[o + 1] * darken);
        out[o + 2] = Math.min(255, out[o + 2] * darken);
      }
    }
  }
});

/** 污渍：bbox 内径向衰减的暗色软斑 */
registerDecalPattern('blotch', (out, S, _ox, _oz, d, seed, _params) => {
  const step = 60 / S;
  const pcx = Math.floor((d.cellX * DECAL_CELL + d.ox * DECAL_CELL) / step);
  const pcz = Math.floor((d.cellY * DECAL_CELL + d.oy * DECAL_CELL) / step);
  const pr = Math.ceil(d.scale / step) + 1;
  const rr = pr * pr;
  for (let j = Math.max(0, pcz - pr); j <= Math.min(S - 1, pcz + pr); j++) {
    for (let i = Math.max(0, pcx - pr); i <= Math.min(S - 1, pcx + pr); i++) {
      const dx = i - pcx, dy = j - pcz;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > rr) continue;
      const f = Math.sqrt(dist2) / pr;
      const w = (1 - f) * (1 - f) * (0.72 + hash2(i, j, seed + 9703) * 0.06);
      const o = (j * S + i) * 4;
      out[o] = Math.min(255, out[o] * (1 - w * 0.22));
      out[o + 1] = Math.min(255, out[o + 1] * (1 - w * 0.24));
      out[o + 2] = Math.min(255, out[o + 2] * (1 - w * 0.28));
    }
  }
});

// ============================================================
// 占位内容（基石组；2026-09-02 移除占位·碎屑斑点——1-7 写实风要求
// 默认地块表面干净无花纹。后续装饰 = 在此注册实例即可）
// ============================================================

// ============================================================
// 规划（地形生成完成后、预渲染前调用；纯函数零 three）
// ============================================================

/** 贴图散布网格：20×20 cell × 3m（与渲染契约的 decal 网格纹理一致） */
export const DECAL_GRID = 20;
export const DECAL_CELL = 3;

/** 单 chunk 贴图上限（预算闸门：超限丢弃，保帧不保密度） */
export const DECAL_BUDGET = 64;

export interface PlannedDecal {
  /** 贴图实例 key */
  decalKey: string;
  /** 所在 cell（网格坐标 0~19） */
  cellX: number;
  cellY: number;
  /** cell 内局部偏移（0~1） */
  ox: number;
  oy: number;
  /** 尺度（米） */
  scale: number;
  /** 变体（同种贴图不同形态；图案函数消费） */
  variant: number;
}

/** 规划上下文（保持纯函数可测） */
export interface DecalPlanContext {
  seed: number;
  cx: number;
  cz: number;
  /** 本 chunk 生效组（ChunkData.groupKey） */
  groupKey: string;
  /** 15×15 地块 id */
  blockTypes: Uint8Array;
}

/** cell 中心落在哪个地块（4m 块坐标 → id） */
function tileAtCell(ctx: DecalPlanContext, cellX: number, cellY: number): TileDef {
  const wx = ctx.cx * 60 + cellX * DECAL_CELL + DECAL_CELL / 2;
  const wz = ctx.cz * 60 + cellY * DECAL_CELL + DECAL_CELL / 2;
  const bx = Math.floor((wx - ctx.cx * 60) / 4);
  const bz = Math.floor((wz - ctx.cz * 60) / 4);
  return tileById(ctx.blockTypes[Math.max(0, Math.min(14, bz)) * 15 + Math.max(0, Math.min(14, bx))]);
}

/**
 * ★ 地形生成后散布贴图：逐 cell 判定 → 组/地块/角色过滤 → 加权抽贴图。
 * 确定性：所有随机来自 hash2(cell, salt)，同 seed 同 chunk 必复现。
 */
export function planChunkDecals(ctx: DecalPlanContext): PlannedDecal[] {
  const out: PlannedDecal[] = [];
  const defs = decalsForGroup(ctx.groupKey);
  if (defs.length === 0) return out;

  // 加权池（主打加成：出现率只看 density 总和，主打只影响"抽谁"）
  const FEATURED_BOOST = 3;
  const featuredKey = defs[Math.floor(hash2(ctx.cx, ctx.cz, ctx.seed + 9501) * defs.length)].key;
  let presenceProb = 0;
  const weights = new Map<string, number>();
  for (const d of defs) {
    presenceProb += d.placement.density;
    weights.set(d.key, d.placement.density * (d.key === featuredKey ? FEATURED_BOOST : 1));
  }
  presenceProb = Math.min(1, presenceProb);
  let total = 0;
  for (const w of weights.values()) total += w;

  for (let cy = 0; cy < DECAL_GRID && out.length < DECAL_BUDGET; cy++) {
    for (let cx = 0; cx < DECAL_GRID && out.length < DECAL_BUDGET; cx++) {
      // 每 cell 一票：presence 判定（出现率只由 density 总和决定）
      const r = hash2(cx * 3 + 1, cy * 3 + 2, ctx.seed + 9502);
      if (r >= presenceProb) continue;

       // 地块/角色过滤（cell 中心地块；liquid/pit 不在 hostRole 中 → 天然跳过）
       const tile = tileAtCell(ctx, cx, cy);
       const eligible = defs.filter((d) => {
         if (d.placement.tiles && d.placement.tiles.length > 0 && !d.placement.tiles.includes(tile.key)) return false;
         if (!d.placement.hostRole.includes(tile.genRole as DecalHostRole)) return false;
         return true;
       });
       if (eligible.length === 0) continue;

       // ★ 加权抽贴图（只在角色/地块命中的候选中抽，避免抽到本格不支持的贴图）
       let etotal = 0;
       for (const d of eligible) etotal += weights.get(d.key)!;
       let rr = hash2(cx, cy, ctx.seed + 9503) * etotal;
       let pick = eligible[0];
       for (const d of eligible) {
         rr -= weights.get(d.key)!;
         if (rr <= 0) { pick = d; break; }
       }
      const [sMin, sMax] = pick.placement.scaleRange;
      out.push({
        decalKey: pick.key,
        cellX: cx, cellY: cy,
        ox: hash2(cx * 5 + 3, cy * 5 + 4, ctx.seed + 9504),
        oy: hash2(cx * 5 + 4, cy * 5 + 3, ctx.seed + 9505),
        scale: sMin + hash2(cx, cy, ctx.seed + 9506) * (sMax - sMin),
        variant: Math.floor(hash2(cx, cy, ctx.seed + 9507) * 8),
      });
    }
  }
  return out;
}

// ============================================================
// 烘焙侧印章入口（预渲染时把贴图印进 albedo；Worker 可用）
// ============================================================

/** 把一批贴图印进 albedo 缓冲（各实例经基类 stampInto 调度到图案函数） */
export function applyDecalStamps(
  out: Uint8ClampedArray,
  S: number,
  originX: number, originZ: number,
  decals: PlannedDecal[],
  seed: number,
): void {
  if (decals.length === 0) return;
  for (const d of decals) {
    const decal = decalByKey(d.decalKey);
    if (!decal) continue;
    decal.stampInto(out, S, originX, originZ, d, seed);
  }
}