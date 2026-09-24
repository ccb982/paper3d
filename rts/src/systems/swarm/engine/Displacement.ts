// ============================================================
// engine/Displacement.ts —— 位移命令（重写 P3；用户定 2026-09-24）
// ============================================================
// 位移命令 = **径向 + 切向同时发力** 得到一个目标位置 → 再经**长距离寻路检测** → 下发。
//   · 径向（飞船方向）：前近 / 拉开距离（改 r）
//   · 切向：同兵种间距（只改 θ，r 不变）
//   · 长寻路检测：目标必须可达（canReach 注入）；不可达 → 逐档向中心缩近
// **作用对象只有队长**（引擎只指挥队长；成员跟队长走）。
// 纯函数（无状态）→ 可独立自检。
// ============================================================

import { spreadFix, type SpreadPt } from './Spread';

export interface MoveInput {
  /** 本队（队长）当前位置 */
  x: number;
  z: number;
  /** 径向中心（飞船 / 玩家；由 Positions 单源提供） */
  cx: number;
  cz: number;
  /** 径向目标半径（前近/拉远后的理想距离；0 = 保持当前 r） */
  rTarget: number;
  /** 环夹取 [ringMin, ringMax]（0 = 不限制） */
  ringMin: number;
  ringMax: number;
  /** 同兵种兄弟目标（切向散开用） */
  siblings: readonly SpreadPt[];
  role: string;
  id: number;
  /** 长距离寻路检测（注入；缺省跳过） */
  canReach?: (x: number, z: number) => boolean;
  /** 不可达时缩近步长（米） */
  pullback?: number;
}

export interface MoveResult {
  x: number;
  z: number;
  /** 径向被调整（前近/拉开/夹环/缩近） */
  radial: boolean;
  /** 切向被调整（同兵种错开） */
  tangential: boolean;
  /** 长寻路检测通过 */
  reachable: boolean;
  /** 可下发（可达 → true） */
  ok: boolean;
}

export function composeMove(inp: MoveInput): MoveResult {
  // ① 径向：把当前点投到 rTarget 圆上（保持角）
  const rx = inp.x - inp.cx;
  const rz = inp.z - inp.cz;
  const r = Math.hypot(rx, rz);
  let x = inp.x;
  let z = inp.z;
  let radial = false;
  const rT = inp.rTarget > 0 ? inp.rTarget : r;
  if (r > 1e-3 && Math.abs(r - rT) > 0.5) {
    const k = rT / r;
    x = inp.cx + rx * k;
    z = inp.cz + rz * k;
    radial = true;
  }
  // ② 切向：与同兵种散开（极坐标滑动，半径不变）
  let tangential = false;
  if (inp.siblings.length) {
    const fixed = spreadFix([...inp.siblings, { id: inp.id, role: inp.role, x, z }], { x: inp.cx, z: inp.cz });
    for (const f of fixed) {
      if (f.id !== inp.id) continue;
      if (f.moved > 1e-3) {
        x = f.x;
        z = f.z;
        tangential = true;
      }
      break;
    }
  }
  // ③ 环夹取（事态范围）
  if (inp.ringMax > 0) {
    const dx = x - inp.cx;
    const dz = z - inp.cz;
    const d = Math.hypot(dx, dz);
    if (d > inp.ringMax && d > 1e-3) {
      const k = inp.ringMax / d;
      x = inp.cx + dx * k;
      z = inp.cz + dz * k;
      radial = true;
    }
  }
  // ④ 长距离寻路检测：不可达 → 逐档向中心缩近
  let reachable = inp.canReach ? inp.canReach(x, z) : true;
  if (!reachable && inp.canReach) {
    const step = inp.pullback ?? 20;
    for (let i = 1; i <= 3 && !reachable; i++) {
      const dx = x - inp.cx;
      const dz = z - inp.cz;
      const d = Math.hypot(dx, dz);
      if (d <= 1e-3) break;
      const k = Math.max(0, d - step * i) / d;
      const tx = inp.cx + dx * k;
      const tz = inp.cz + dz * k;
      if (inp.canReach(tx, tz)) {
        x = tx;
        z = tz;
        reachable = true;
        radial = true;
      }
    }
  }
  return { x, z, radial, tangential, reachable, ok: reachable };
}
