// ============================================================
// nav/ClimbVia —— 上坡点插入（共享件；用户定 2026-09-26）
// ============================================================
// 上坡点 = **可行性表构建期预处理**（`PassTable.climbRuns`：每条连续坡按宽度取段中心，
//   标在**坡面前 1m**（低侧法线上））。本件把"过坡"变成合法路线几何：
//   · 沿路线**细采样（2m）**找**真实跨可爬坡边**的位置（LOS 斜线也要命中，
//     不得用轴序格步近似——那样会错过真坡、漏插上坡点）；
//   · 跨坡时在路线上插入：① **该连续坡的中间上坡点**（`climbRunAt` 段中心，坡面前 1m）
//     → ② 跨坡点（climb=true）；同一段最多迭代数次（多坡）。
//   → 单位**任何情况都先走中间上坡点**，再正面爬升（不蹭侧壁/不推崖）。
// **长寻路（FeasibilityPath）与贪心/短寻路（S1 走廊）共用本件**，口径只有一个。
// ============================================================

import type { PassTable } from './PassTable';

const CELL = 4;
/** 细采样步长（米；与 climbAlong/canSegment 同口径） */
const STEP = 2;

export interface ViaPt {
  x: number;
  z: number;
  climb?: boolean;
}

/** 段上第一处"跨可爬坡边"：返回该坡的上坡点(前1m)/跨坡点(边中点)/越过点(继续扫描用) */
function scanClimb(
  t: PassTable, ax: number, az: number, bx: number, bz: number,
): { run: { x: number; z: number; ux: number; uz: number; width: number }; cross: { x: number; z: number }; after: { x: number; z: number } } | null {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / STEP));
  let px = ax, pz = az;
  for (let k = 1; k <= n; k++) {
    const q = k / n;
    const x = ax + (bx - ax) * q, z = az + (bz - az) * q;
    const dx = x - px, dz = z - pz;
    const sx = Math.abs(dx) < 0.4 ? 0 : dx > 0 ? 1 : -1;
    const sz = Math.abs(dz) < 0.4 ? 0 : dz > 0 ? 1 : -1;
    if ((sx !== 0 || sz !== 0) && t.climbAt(px, pz, sx, sz)) {
      const run = t.climbRunAt(px, pz, sx, sz);
      const ccx = Math.floor(px / CELL) * CELL + CELL / 2;
      const ccz = Math.floor(pz / CELL) * CELL + CELL / 2;
      const cross = { x: ccx + sx * (CELL / 2), z: ccz + sz * (CELL / 2) };
      const after = { x: cross.x + sx * 0.6, z: cross.z + sz * 0.6 };
      if (run) return { run, cross, after };
    }
    px = x; pz = z;
  }
  return null;
}

/** 在路线上插入上坡点（跨可爬坡边处；任何情况先走中间上坡点再跨）；返回新数组 */
export function viaClimbPoints(
  t: PassTable, sx: number, sz: number, pts: readonly ViaPt[],
): ViaPt[] {
  if (!t.ready) return pts as ViaPt[];
  const res: ViaPt[] = [];
  let from = { x: sx, z: sz };
  for (const q of pts) {
    let cur = { x: from.x, z: from.z };
    let guard = 0;
    while (guard++ < 6) {
      const hit = scanClimb(t, cur.x, cur.z, q.x, q.z);
      if (!hit) break;
      // ① 中间上坡点（该连续坡段中心、坡面前 1m）② 跨坡点（★）
      res.push({ x: hit.run.x, z: hit.run.z });
      res.push({ x: hit.cross.x, z: hit.cross.z, climb: true });
      cur = hit.after;
    }
    res.push(q);
    from = { x: q.x, z: q.z };
  }
  return res;
}
