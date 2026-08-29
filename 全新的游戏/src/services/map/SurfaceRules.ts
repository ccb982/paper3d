// ============================================================
// SurfaceRules —— 地形边缘裁决与视觉面语义（纯函数唯一真源）
// ============================================================
// 架构详见《地形边缘裁决与视觉面架构.md》（2026-08-29 定稿）。
//
// 核心命题：地块之间的"过渡"不是隐式规则副作用，而是一次【边级裁决】——
//   weld  ：裁决通过 → 两侧连续过渡（低侧边界顶点拉到高侧 = 旧 max-2×2 几何）
//   cliff ：裁决不通过 → 硬突起边界（两侧各持各高，竖直落差由墙补）
//
// ★ 四条铁律：
//   1. 裁决对象是"边"（两块共享边界），角点是边的派生（硬顶点规则）
//   2. 裁决是纯函数、确定性、对称的——同 seed 同边恒同结果
//   3. 视觉面语义只有本文件一个真源，禁止消费方复刻 max-2×2 或自行插值
//   4. 消费者全部派生（网格/物理/烘焙/贴地/移动阻挡），零自行决策
//
// ★ 零 three 依赖：主线程（RasterMap/ChunkSurface/ChunkWalls）与
//   Worker（bakeCompute 快照重构）import 同一份代码 → 逐位一致由构造保证。
// ============================================================

import { tileById } from './Tiles';

// ============================================================
// 裁决结论与常量
// ============================================================

export type EdgeRuling = 'weld' | 'cliff';

/**
 * ★ β 微高差裁决带（|Δh| ≤ 带宽 → cliff）。
 * 推导见文档 §2.2：各类型对 |Δh| 分布中 (0.30, 0.38) 是空隙带——
 *   - 地面↔地面 < 0.16、同档高台 ≤ 0.30 → cliff（平面类内部露出方块感）
 *   - 异档高台 ≥ 0.70、地面↔高台 ≥ 0.93、水/坑参与 → weld（今日插值天际线）
 *   - ⚠ 水↔地面分布 (0.38, 0.62) 跨骑 0.5：带宽取 0.5 会让水岸随抖动
 *     随机台阶/斜坡——必须落在空隙带内。0.35 = 水岸维持今日插值观感。
 * ★ 与移动层 stepHeight 是同一常量（CharacterBase 大落差阻挡）：
 *   β 产生的 cliff 全部 ≤ 带宽 → 全部可自动踏过 → 默认世界可达性不变。
 */
export const EDGE_CLIFF_BAND = 0.35;

/**
 * ★ β 总开关（回归 A-B 对照 / 应急回退，文档 §6）：null = 用 EDGE_CLIFF_BAND。
 * 设为负数（-1）= 恒 weld = 旧世界（max-2×2 逐位）——
 * scripts/surface-regression.ts 的 weld 对照依赖此开关。
 */
let bandOverride: number | null = null;
export function setEdgeCliffBand(band: number | null): void {
  bandOverride = band;
}
/** 当前生效裁决带（规则链唯一取值点，勿在别处直读常量） */
export function edgeCliffBand(): number {
  return bandOverride ?? EDGE_CLIFF_BAND;
}

// ============================================================
// 块数据源（唯一抽象面：世界块坐标 → 块信息）
// ============================================================

/** 块信息：tileId（裁决用）+ 逻辑高度（L4 逐块恒定平面） */
export interface BlockInfo {
  id: number;
  h: number;
}

/**
 * 世界块坐标 → 块信息；undefined = 数据不存在（按 0 号平地/0 高兜底，
 * 与旧 heightAt 未加载回退一致。RasterMap 实现会先 ensureData 补邻域）。
 */
export interface BlockSource {
  blockAt(bx: number, bz: number): BlockInfo | undefined;
  /**
   * ★ 精修层执行口（可选）：显式裁决覆写。返回 undefined = 用默认引擎
   *   edgeRuling。默认 4 个构造点不提供 → 空精修 ≡ 旧世界逐位不变；
   *   精修层包装（Refinements.refine）提供时才生效。
   *   dir：0=+x 1=−x 2=+z 3=−z（与 edgeOf 一致）。
   */
  edgeFinal?(bx: number, bz: number, dir: 0 | 1 | 2 | 3): EdgeRuling | undefined;
}

/** 缺块兜底（0 号平地 / 0 高——与旧 heightAt 未加载回退逐位一致） */
export const MISSING_BLOCK: BlockInfo = { id: 0, h: 0 };

// ============================================================
// 边级裁决（规则链：TileDef 覆盖 → β 微高差 → 兜底 weld）
// ============================================================

/**
 * ★ 边裁决（对称：edgeRuling(a,b) ≡ edgeRuling(b,a)）。
 * 规则链（首条命中即结论；扩展位见文档 §2.1——风格组规则按越具体越靠前
 * 插在角色对规则与 β 之间）：
 *   1.  任一侧 edgePolicy 'hard' → cliff（两侧 hard 优先于 smooth）
 *   1'. 任一侧 edgePolicy 'smooth'（且无 hard）→ weld
 *   1.5 角色对规则（α 对表首实例，2026-08-29）：仅 ground↔ground 允许
 *       落入 β 判硬；其余角色对（高台/水/坑参与）一律 weld——
 *       设计意图"只有地面用硬边界，其余用插值"。
 *   2.  β 微高差：|Δh| ≤ EDGE_CLIFF_BAND → cliff
 *   3.  兜底 → weld
 */
export function edgeRuling(a: BlockInfo, b: BlockInfo): EdgeRuling {
  const ta = tileById(a.id);
  const tb = tileById(b.id);
  const pa = ta.physics.edgePolicy;
  const pb = tb.physics.edgePolicy;
  if (pa === 'hard' || pb === 'hard') return 'cliff';
  if (pa === 'smooth' || pb === 'smooth') return 'weld';
  if (ta.genRole !== 'ground' || tb.genRole !== 'ground') return 'weld';
  return Math.abs(a.h - b.h) <= edgeCliffBand() ? 'cliff' : 'weld';
}

/**
 * ★ 精修层对外唯一执行口（《架构设计.md》§8.0 edgeFinal）：
 * 块 (bx,bz) 与 dir 方向邻边的最终裁决。优先取 src.edgeFinal 显式覆写
 * （命中即定，不落规则链）；否则回落默认引擎 edgeRuling。
 * 所有消费者（cornerHeight/sampleSurface/edgeOf/墙）一律改问本函数，
 * 禁止直接调 edgeRuling——见第五铁律「唯一判点不变式」。
 */
export function finalRuling(src: BlockSource, bx: number, bz: number, dir: 0 | 1 | 2 | 3): EdgeRuling {
  const ov = src.edgeFinal?.(bx, bz, dir);
  if (ov !== undefined) return ov;
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  return edgeRuling(src.blockAt(bx, bz) ?? MISSING_BLOCK, src.blockAt(bx + dx, bz + dz) ?? MISSING_BLOCK);
}

// ============================================================
// 视觉面语义：硬顶点 → 单元四角归属 → 贴地采样
// ============================================================

/** 米格 cell → 块坐标（4m 块；cell 恒属于唯一块） */
function blockCoordOfCell(cx: number, cz: number): { bx: number; bz: number } {
  return { bx: Math.floor(cx / 4), bz: Math.floor(cz / 4) };
}

/**
 * ★ 角点插值许可（文档 §3.2，2026-08-29 定稿，取代旧"全局硬顶点"规则）：
 * 块 (bcx,bz) 在角点 (vx,vz) 处的高度——
 *   B 在 V 处的边界边段（与异块共享的边段，0~2 条；同块内段不计）任一
 *   裁决为 cliff → 返回 hB（自持：硬边直达角点，零插值——"左右两边都是
 *   硬切换（含一边硬一边坡）就不许插值"）；
 *   全部为 weld（两边皆有插值边；含 0 条边界段的内角）→ 返回 max(环绕
 *   2×2 格)（与旧公式逐位一致）。
 * 纯函数、对称、确定性；主线程与 Worker 同一份代码。
 */
export function cornerHeight(src: BlockSource, bcx: number, bcz: number, vx: number, vz: number): number {
  const B = src.blockAt(bcx, bcz) ?? MISSING_BLOCK;
  const p00 = blockCoordOfCell(vx - 1, vz - 1);
  const p10 = blockCoordOfCell(vx, vz - 1);
  const p01 = blockCoordOfCell(vx - 1, vz);
  const p11 = blockCoordOfCell(vx, vz);
  const b00 = src.blockAt(p00.bx, p00.bz) ?? MISSING_BLOCK;
  const b10 = src.blockAt(p10.bx, p10.bz) ?? MISSING_BLOCK;
  const b01 = src.blockAt(p01.bx, p01.bz) ?? MISSING_BLOCK;
  const b11 = src.blockAt(p11.bx, p11.bz) ?? MISSING_BLOCK;
  // B 占据的每格向 V 贡献两条面向邻格的边段；异块段才计入（同块段是内段）
  const own = (p: { bx: number; bz: number }) => p.bx === bcx && p.bz === bcz;
  const o00 = own(p00), o10 = own(p10), o01 = own(p01), o11 = own(p11);
  // dir：从 B 所在块 (bcx,bcz) 指向邻块 pn 的方向（0=+x 1=−x 2=+z 3=−z）
  const dirOf = (pn: { bx: number; bz: number }): 0 | 1 | 2 | 3 => {
    const dbx = pn.bx - bcx, dbz = pn.bz - bcz;
    if (dbx === 1) return 0; if (dbx === -1) return 1;
    if (dbz === 1) return 2; return 3;
  };
  let cliff = false;
  const seg = (o: boolean, n: boolean, pn: { bx: number; bz: number }) => {
    if (o && !n && finalRuling(src, bcx, bcz, dirOf(pn)) === 'cliff') cliff = true;
  };
  seg(o00, o10, p10); seg(o10, o00, p00);   // 横向共享边段
  seg(o01, o11, p11); seg(o11, o01, p01);
  seg(o00, o01, p01); seg(o01, o00, p00);   // 纵向共享边段
  seg(o10, o11, p11); seg(o11, o10, p10);
  if (cliff) return B.h;
  return Math.max(b00.h, b10.h, b01.h, b11.h);
}

/**
 * ★ 视觉面一致采样（文档 §3.1）：查询点所在 cell 的四角按
 * 【块归属】取高后三角形插值——与网格渲染逐位一致。
 * 对角线 (lx,lz+1)-(lx+1,lz)，fx+fz≤1 取 T1=△(h00,h01,h10)
 * （PlaneGeometry 真实剖分，2026-08-26 Raycaster 实测约定，勿改）。
 */
export function sampleSurface(src: BlockSource, x: number, z: number): number {
  const gx = Math.floor(x);
  const gz = Math.floor(z);
  const fx = x - gx;
  const fz = z - gz;
  const { bx, bz } = blockCoordOfCell(gx, gz);
  const h00 = cornerHeight(src, bx, bz, gx, gz);
  const h10 = cornerHeight(src, bx, bz, gx + 1, gz);
  const h01 = cornerHeight(src, bx, bz, gx, gz + 1);
  const h11 = cornerHeight(src, bx, bz, gx + 1, gz + 1);
  if (fx + fz <= 1) {
    return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  }
  return h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
}

// ============================================================
// 边信息（墙生成 / 可遍历性消费）
// ============================================================

export interface EdgeInfo {
  /** 裁决结论 */
  ruling: EdgeRuling;
  /** 落差 = 高侧 − 低侧（≥ 0） */
  drop: number;
  /** 高侧块（drop=0 时 = low） */
  high: BlockInfo;
  /** 低侧块 */
  low: BlockInfo;
}

/**
 * 块 (bx,bz) 与 (dir 方向邻块) 的边信息。
 * dir：0=+x 1=−x 2=+z 3=−z（与 ChunkWalls 扫描方向表对应）。
 * 缺邻块按 MISSING_BLOCK 兜底（与旧 heightAt 越界回退一致）。
 */
export function edgeOf(src: BlockSource, bx: number, bz: number, dir: 0 | 1 | 2 | 3): EdgeInfo {
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  const a = src.blockAt(bx, bz) ?? MISSING_BLOCK;
  const b = src.blockAt(bx + dx, bz + dz) ?? MISSING_BLOCK;
  const drop = a.h - b.h;
  const high = drop >= 0 ? a : b;
  const low = drop >= 0 ? b : a;
  return { ruling: finalRuling(src, bx, bz, dir), drop: Math.abs(drop), high, low };
}
