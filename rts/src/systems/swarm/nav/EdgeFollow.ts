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
  /** ★ 统一评分（可选；生产 = TerrainScoring.scoreAt）：对角同分量时择高分轴 */
  scoreAt?(x: number, z: number): number | null;
  /** ★ 上坡点（可选；生产 = PassTable.climbRunAt）：该向可爬 → 该连续坡的中间上坡点（前 1m） */
  climbRunAt?(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number; rise: number } | null;
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

/** 轴对齐单步（canStep 校验；两轴都需走时按"先大分量、后小分量"给一步；都被禁 → null） */
export function axisStepToward(g: EdgeGrid, x: number, z: number, ddx: number, ddz: number): { dx: number; dz: number } | null {
  const sx = ddx === 0 ? 0 : (ddx > 0 ? 1 : -1);
  const sz = ddz === 0 ? 0 : (ddz > 0 ? 1 : -1);
  if (sx === 0 && sz === 0) return null;
  // ★ 坡面优先（用户定 2026-09-26）：目标轴若为**可爬坡面**（climb 位）→ 先走该轴（正对坡面），
  //   不被"横向分量更大"抢走（否则先沿坡脚走 → 卡侧壁/来回摆）。坡面方位来自表标注。
  const xClimb = sx !== 0 && (g.climbAt?.(x, z, sx, 0) ?? false);
  const zClimb = sz !== 0 && (g.climbAt?.(x, z, 0, sz) ?? false);
  let xFirst = xClimb && !zClimb ? true : zClimb && !xClimb ? false : Math.abs(ddx) >= Math.abs(ddz);
  // ★ 对角几乎同分量 → 用**统一评分**择轴（贪心消费地形/掩体/事态×舰距）
  if (!xClimb && !zClimb && sx !== 0 && sz !== 0 && g.scoreAt
    && Math.abs(Math.abs(ddx) - Math.abs(ddz)) <= 1) {
    const s0 = g.scoreAt(x + (xFirst ? sx : 0) * EDGE_CELL, z + (xFirst ? 0 : sz) * EDGE_CELL) ?? -Infinity;
    const s1 = g.scoreAt(x + (xFirst ? 0 : sx) * EDGE_CELL, z + (xFirst ? sz : 0) * EDGE_CELL) ?? -Infinity;
    if (s1 > s0 + 1e-6) xFirst = !xFirst;
  }
  let opts: [number, number][] = xFirst ? [[sx, 0], [0, sz]] : [[0, sz], [sx, 0]];
  // ★ 贪心也走去坡点（用户定 2026-09-26）：本步为可爬坡边 → 朝**中间上坡点**（前 1m）走
  if ((xClimb || zClimb) && g.climbRunAt) {
    const run = g.climbRunAt(x, z, xClimb ? sx : 0, zClimb ? sz : 0);
    if (run) {
      const rdx = run.x - x, rdz = run.z - z;
      const rax = rdx === 0 ? 0 : rdx > 0 ? 1 : -1;
      const raz = rdz === 0 ? 0 : rdz > 0 ? 1 : -1;
      const rFirst = Math.abs(rdx) >= Math.abs(rdz);
      opts = rFirst ? [[rax, 0], [0, raz]] : [[0, raz], [rax, 0]];
    }
  }
  for (const [dx, dz] of opts) {
    if (dx === 0 && dz === 0) continue;
    if (!g.canStep(x, z, dx, dz)) continue;
    return { dx, dz };
  }
  return null;
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
