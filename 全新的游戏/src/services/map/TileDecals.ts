// ============================================================
// TileDecals —— 程序化纹理贴图库（独立于地块列表，随组散布）
// ============================================================
// 定位：不是地块（不参与生成器结构/物理），是地形生成完成后、
//       渲染前叠在地块表面上的程序化纹理装饰。
//
// 架构（2026-08-26 定稿）：
//   ┌─ 库：DecalDef 注册表（内容由你逐渐填充）
//   │    每张贴图明确声明：所属组（多对多）/ 可用的地块key与角色 / 密度
//   │    / 尺度 / shader 图案函数与参数
//   ├─ 规划：planChunkDecals —— 地形生成后按块数据+组面板确定性散布
//   │    （纯函数，零 three；同 seed 同坐标必复现）
//   └─ 渲染：阶段二并入 TerrainMaterial——贴图经「decal 网格纹理」
//       传给 shader 图案层叠加，不是独立 mesh
//
// 渲染契约（阶段二实现）：
//   decal 网格纹理：20×20 cell（3m），R8 存贴图 id（0=无），
//   RGBA8 存 (局部偏移x/尺度/局部偏移y/变体)；片元着色器
//   按 uv 采样网格 → id>0 → 调该贴图的 GLSL 图案函数叠加。
//   每像素成本 = 2 次额外采样 + 一次图案求值（只在贴图内），低端可承受。
// ============================================================

import { hash2 } from './TerrainNoise';
import { tileById, type TileDef } from './Tiles';

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

export interface DecalDef {
  key: string;
  label: string;
  /** 所属风格组（多对多；空 = 任意组均可用） */
  groups: string[];
  placement: DecalPlacement;
  /**
   * 阶段二：shader 图案函数标识 + 参数。
   * fnId 在 GLSL 图案库（阶段二）注册；params 打包进 uniform 数组。
   */
  pattern: { fnId: string; params: Record<string, number> };
}

// ============================================================
// 库（注册表）
// ============================================================

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

/** 按组取可用贴图（组面板消费；空组声明 = 通用；foundation = 兜底通用） */
export function decalsForGroup(groupKey: string): DecalDef[] {
  return [...REGISTRY.values()].filter(
    (d) => d.groups.length === 0 || d.groups.includes(groupKey) || d.groups.includes(FOUNDATION_DECAL_GROUP),
  );
}

/** 基石兜底组 key（基石组的贴图 = 任何 chunk 都可出现，与地块回退链同哲学） */
export const FOUNDATION_DECAL_GROUP = 'foundation';

// ============================================================
// 占位内容（基石组；后续替换/扩充）
// ============================================================

registerDecal({
  key: 'foundation_speckle', label: '占位·碎屑斑点', groups: [FOUNDATION_DECAL_GROUP],
  placement: { hostRole: ['ground', 'platform'], density: 0.12, scaleRange: [1.2, 2.6] },
  pattern: { fnId: 'speckle', params: { depth: 0.14 } },
});

// ============================================================
// 规划（地形生成完成后、渲染前调用）
// ============================================================

/** 贴图散布网格：20×20 cell × 3m（与渲染契约的 decal 网格纹理一致） */
export const DECAL_GRID = 20;
export const DECAL_CELL = 3;

/** 单 chunk 贴图上限（预算闸门：超限丢弃，保帧不保密度） */
export const DECAL_BUDGET = 64;

export interface PlannedDecal {
  /** 贴图实例 key（多实例同 key 同变体可合并渲染参数） */
  decalKey: string;
  /** 所在 cell（网格坐标 0~19） */
  cellX: number;
  cellY: number;
  /** cell 内局部偏移（0~1） */
  ox: number;
  oy: number;
  /** 尺度（米） */
  scale: number;
  /** 变体（同种贴图不同形态；shader 图案函数消费） */
  variant: number;
}

/** 规划上下文（避免逐个穿参；保持纯函数可测） */
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
 * 阶段一已实现规划；渲染层（decal 网格纹理）阶段二接入。
 */
export function planChunkDecals(ctx: DecalPlanContext): PlannedDecal[] {
  const out: PlannedDecal[] = [];
  const defs = decalsForGroup(ctx.groupKey);
  if (defs.length === 0) return out;

  // 加权池（组面板抽同款手法：主打 ×DECAL_FEATURED_BOOST）
  const FEATURED_BOOST = 3;
  const featuredKey = defs[Math.floor(hash2(ctx.cx, ctx.cz, ctx.seed + 9501) * defs.length)].key;
  // ★ 每 cell 出现概率 = 各贴图 density 之和（封顶 1）；主打只影响"抽谁"不参与出现率
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

      // 地块/角色过滤（cell 中心地块；liquid/pit 地块不在 hostRole 中 → 天然跳过）
      const tile = tileAtCell(ctx, cx, cy);
      const host = defs.find((d) => {
        if (d.placement.tiles && d.placement.tiles.length > 0 && !d.placement.tiles.includes(tile.key)) return false;
        if (!d.placement.hostRole.includes(tile.genRole as DecalHostRole)) return false;
        return true;
      });
      if (!host) continue;

      // 加权抽贴图
      let rr = hash2(cx, cy, ctx.seed + 9503) * total;
      let pick = defs[0];
      for (const d of defs) {
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
// 烘焙侧印章（预渲染时把贴图印进 albedo；与放置顺序绑定：
// 贴图全部放置完 → 触发预渲染 → 本函数消费）
// ============================================================
// 纯函数（Uint8ClampedArray 直写），Worker 可用。
// pattern.fnId 与 CPU 实现同名；阶段二 GLSL 图案库复用同一 fnId。

/** 把一批贴图印进 albedo 缓冲（RGBA 直写，只改 RGB 通道） */
export function applyDecalStamps(
  out: Uint8ClampedArray,
  S: number,
  originX: number, originZ: number,
  decals: PlannedDecal[],
  seed: number,
): void {
  if (decals.length === 0) return;
  const step = 60 / S;

  for (const d of decals) {
    const def = decalByKey(d.decalKey);
    if (!def) continue;
    // 贴图中心世界坐标（cell 角 + 局部偏移）
    const wx = originX + d.cellX * DECAL_CELL + d.ox * DECAL_CELL;
    const wz = originZ + d.cellY * DECAL_CELL + d.oy * DECAL_CELL;
    const pcx = Math.floor(wx / step);
    const pcz = Math.floor(wz / step);
    const pr = Math.ceil(d.scale / step) + 1;

    switch (def.pattern.fnId) {
      case 'speckle': stampSpeckle(out, S, pcx, pcz, pr, d, seed); break;
      case 'blotch': stampBlotch(out, S, pcx, pcz, pr, d, seed); break;
      default: break; // 未实现的 fnId 跳过（占位内容可先不渲染）
    }
  }
}

/** 碎屑斑点：bbox 内确定性撒 ~6+2v 个暗点（乘性变暗） */
function stampSpeckle(
  out: Uint8ClampedArray, S: number,
  pcx: number, pcz: number, pr: number,
  d: PlannedDecal, seed: number,
): void {
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
}

/** 污渍：bbox 内径向衰减的暗色软斑 */
function stampBlotch(
  out: Uint8ClampedArray, S: number,
  pcx: number, pcz: number, pr: number,
  d: PlannedDecal, seed: number,
): void {
  const rr = pr * pr;
  for (let j = Math.max(0, pcz - pr); j <= Math.min(S - 1, pcz + pr); j++) {
    for (let i = Math.max(0, pcx - pr); i <= Math.min(S - 1, pcx + pr); i++) {
      const dx = i - pcx, dy = j - pcz;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > rr) continue;
      const f = Math.sqrt(dist2) / pr;
      const w = (1 - f) * (1 - f) * (0.72 + hash2(i, j, seed + 9703) * 0.06); // 径向衰减+微颗粒
      const o = (j * S + i) * 4;
      out[o] = Math.min(255, out[o] * (1 - w * 0.22));
      out[o + 1] = Math.min(255, out[o + 1] * (1 - w * 0.24));
      out[o + 2] = Math.min(255, out[o + 2] * (1 - w * 0.28));
    }
  }
}