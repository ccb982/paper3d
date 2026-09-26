// ============================================================
// nav/EdgeFollow —— 格边跟随（方案 A：**移动消费格边图**；用户定 2026-09-25）
// ============================================================
// 统一移动代数：执行步 = 规划的**格边步**（轴对齐 E/W/S/N + canStep 校验）；
//   · 路线 → 全局格序列（floor(x/4)）→ 当前格 → 下一格：只走一格、只走一个轴；
//   · 两个轴都要走（斜向格）→ 先轴对齐走一段，下一拍再走另一轴（执行器逐步收敛）；
//   · 格内允许软转向/分离（物理外推），但**跨格只走表可走的边**。
// 设计动机（《寻路重写方案.md》§4.4.3）：寻路是格边图、移动是连续向量 → 二者不同步；
//   本模块把执行侧的同一步骤换成"格边步"，与 PassTable.canStep 完全同口径。
// ============================================================

/** 每格边长（米；与 PassTable 同格） */
export const EDGE_CELL = 4;

/** 只读格边端口（生产 = PassTable；自检 = 合成图） */
export interface EdgeGrid {
  canStep(x: number, z: number, dx: number, dz: number): boolean;
  /** ★ H2：格地表高（层判等用；生产 = PassTable.heightAt） */
  heightAt(x: number, z: number): number;
  /** ★ 可爬坡面位（可选；生产 = PassTable.climbAt）：该向 = weld 且净升 > 阈值 */
  climbAt?(x: number, z: number, dx: number, dz: number): boolean;
}

/** ★ 层容差（H2，用户定 2026-09-25）：单位 y 与该格地表差 ≤ 此值才算"在同一层" */
export const EDGE_LAYER_TOL = 0.6;

export interface CellRef {
  cx: number;
  cz: number;
}

/** 世界坐标 → 全局格（floor(x/4)；与 PassTable 的 ox（4 的倍数）1:1 对齐） */
export function cellOf(x: number, z: number): CellRef {
  return { cx: Math.floor(x / EDGE_CELL), cz: Math.floor(z / EDGE_CELL) };
}

/** 世界点序列（路线）→ 去重后的全局格序列 */
export function cellsOfRoute(route: readonly { x: number; z: number }[]): CellRef[] {
  const out: CellRef[] = [];
  for (const p of route) {
    const c = cellOf(p.x, p.z);
    const last = out[out.length - 1];
    if (!last || last.cx !== c.cx || last.cz !== c.cz) out.push(c);
  }
  return out;
}

/** 轴对齐单步（canStep 校验；两轴都需走时按"先大分量、后小分量"给一步；都被禁 → null） */
export function axisStepToward(g: EdgeGrid, x: number, z: number, ddx: number, ddz: number): { dx: number; dz: number } | null {
  const sx = ddx === 0 ? 0 : (ddx > 0 ? 1 : -1);
  const sz = ddz === 0 ? 0 : (ddz > 0 ? 1 : -1);
  if (sx === 0 && sz === 0) return null;
  // ★ 坡面优先（用户定 2026-09-26）：目标轴若为**可爬坡面**（climb 位）→ 先走该轴（正对坡面），
  //   不被"横向分量更大"抢走（否则先沿坡脚走 → 卡侧壁/来回摆）。坡面方位来自表标注。
  const xClimb = sx !== 0 && (g.climbAt?.(x, z, sx, 0) ?? false);
  const zClimb = sz !== 0 && (g.climbAt?.(x, z, 0, sz) ?? false);
  const xFirst = xClimb && !zClimb ? true : zClimb && !xClimb ? false : Math.abs(ddx) >= Math.abs(ddz);
  const opts: [number, number][] = xFirst ? [[sx, 0], [0, sz]] : [[0, sz], [sx, 0]];
  for (const [dx, dz] of opts) {
    if (dx === 0 && dz === 0) continue;
    if (!g.canStep(x, z, dx, dz)) continue;
    return { dx, dz };
  }
  return null;
}

/** ★ 路线格边跟随（H2 层感知）：从精确位置沿**规划的格序列**走一格（轴对齐 + canStep）。
 *  · 当前格在路线里但**层不匹配**（如崖底 vs 崖顶同格）→ 返回 null（**不判"在路线上"**）；
 *  · 当前格不在路线里 → 走向最近的**同层**路线格；
 *  · 已到路线末尾 → null。 */
export function edgeStepRoute(
  g: EdgeGrid, x: number, z: number, y: number, cells: readonly CellRef[],
): { dx: number; dz: number } | null {
  if (cells.length === 0) return null;
  const cur = cellOf(x, z);
  const sameLayer = (c: CellRef): boolean =>
    Math.abs(g.heightAt(c.cx * EDGE_CELL + EDGE_CELL / 2, c.cz * EDGE_CELL + EDGE_CELL / 2) - y) <= EDGE_LAYER_TOL;
  let idx = -1;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as CellRef;
    if (c.cx === cur.cx && c.cz === cur.cz) {
      if (!sameLayer(c)) return null;   // ★ H2：同格不同层 = 不在这一层（不判在路线里）
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    // 离路：走向最近的**同层**路线格
    let bi = -1, bd = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] as CellRef;
      if (!sameLayer(c)) continue;
      const d = Math.hypot(c.cx - cur.cx, c.cz - cur.cz);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return null;            // 无同层路线格 → 交上层重算
    idx = bi;
  }
  const next = cells[idx + 1];
  if (!next) return null;                          // 已到路线末尾
  return axisStepToward(g, x, z, next.cx - cur.cx, next.cz - cur.cz);
}

/** ★ 贪心格边跟随（H2 层感知；成员跟队长 / 无路线）：朝目标格走一格（轴对齐 + canStep）。 */
export function edgeStepGreedy(
  g: EdgeGrid, x: number, z: number, y: number, tx: number, tz: number,
): { dx: number; dz: number } | null {
  const cur = cellOf(x, z);
  const tgt = cellOf(tx, tz);
  if (cur.cx === tgt.cx && cur.cz === tgt.cz) {
    // ★ H2：同格还必须同层；层不符（如崖底 vs 崖顶）→ 不判"已到位"，交软跟随/重算
    const h = g.heightAt(cur.cx * EDGE_CELL + EDGE_CELL / 2, cur.cz * EDGE_CELL + EDGE_CELL / 2);
    if (Math.abs(h - y) <= EDGE_LAYER_TOL) return null;
  }
  return axisStepToward(g, x, z, tgt.cx - cur.cx, tgt.cz - cur.cz);
}
