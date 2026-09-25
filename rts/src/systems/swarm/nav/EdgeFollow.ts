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
}

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
function axisStep(g: EdgeGrid, x: number, z: number, ddx: number, ddz: number): { dx: number; dz: number } | null {
  const sx = ddx === 0 ? 0 : (ddx > 0 ? 1 : -1);
  const sz = ddz === 0 ? 0 : (ddz > 0 ? 1 : -1);
  if (sx === 0 && sz === 0) return null;
  const xFirst = Math.abs(ddx) >= Math.abs(ddz);
  const opts: [number, number][] = xFirst ? [[sx, 0], [0, sz]] : [[0, sz], [sx, 0]];
  for (const [dx, dz] of opts) {
    if (dx === 0 && dz === 0) continue;
    if (!g.canStep(x, z, dx, dz)) continue;
    return { dx, dz };
  }
  return null;
}

/** ★ 路线格边跟随：从精确位置沿**规划的格序列**走一格（轴对齐 + canStep）。
 *  当前格不在路线里 → 走向路线里最近的格（回到路上）；已到路线末尾 → null。 */
export function edgeStepRoute(
  g: EdgeGrid, x: number, z: number, cells: readonly CellRef[],
): { dx: number; dz: number } | null {
  if (cells.length === 0) return null;
  const cur = cellOf(x, z);
  let idx = -1;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as CellRef;
    if (c.cx === cur.cx && c.cz === cur.cz) { idx = i; break; }
  }
  if (idx < 0) {
    // 离路：走向最近的路线格
    let bi = 0, bd = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] as CellRef;
      const d = Math.hypot(c.cx - cur.cx, c.cz - cur.cz);
      if (d < bd) { bd = d; bi = i; }
    }
    idx = bi;
  }
  const next = cells[idx + 1];
  if (!next) return null;                          // 已到路线末尾
  return axisStep(g, x, z, next.cx - cur.cx, next.cz - cur.cz);
}

/** ★ 贪心格边跟随（成员跟队长 / 无路线）：朝目标格走一格（轴对齐 + canStep；大分量优先）。 */
export function edgeStepGreedy(
  g: EdgeGrid, x: number, z: number, tx: number, tz: number,
): { dx: number; dz: number } | null {
  const cur = cellOf(x, z);
  const tgt = cellOf(tx, tz);
  if (cur.cx === tgt.cx && cur.cz === tgt.cz) return null;   // 同格：软跟随处理
  return axisStep(g, x, z, tgt.cx - cur.cx, tgt.cz - cur.cz);
}
