/**
 * staticQp.ts —— 固定脚准静态平衡 QP（接触 wrench + 关节力矩）
 *
 * 变量：左右脚各 6 维 wrench（作用在脚刚体原点）
 * 约束：浮动基 6 维力/力矩平衡；脚底 CoP/摩擦/单侧接触（事后检查）
 * 目标：min ||τ_selected||² + ε||W||²
 *
 * 关节力矩由广义力方程消除：τ = −(A_j W + g_j)。
 * 只对矢状轴 2（hip/knee/foot/spine/neck）求 τ；其余关节不写。
 */

import type { Body } from '../body';

interface Vec3 { x: number; y: number; z: number }

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }

/** 高斯消元（部分主元），n ≤ 24。 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-9) return null;
    if (piv !== col) { const t = M[piv]!; M[piv] = M[col]!; M[col] = t; }
    const p = M[col]![col]!;
    for (let c = col; c <= n; c++) M[col]![c]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

/**
 * 解固定脚静力平衡。返回每个自由度的 τ（未选中的轴为 0）。
 * 失败返回 null。
 */
export function staticQp(w: Body, gY: number): Float64Array | null {
  const body = w;
  const rootIdx = body.indexByKey.get('pelvis') ?? 0;
  if (rootIdx < 0 || !body.bodies[rootIdx]) return null;
  const root = body.bodies[rootIdx]!.translation();

  const feet = (['l', 'r'] as const).map((side) => {
    const bi = body.indexByKey.get(`foot_${side}`);
    if (bi === undefined) return null;
    const p = body.bodies[bi]!.translation();
    return { bi, p: { x: p.x, y: p.y, z: p.z } };
  });
  if (feet.some((f) => f === null)) return null;

  const sel = body.dofs.filter((d) => d.axis === 2 && /^(hip|knee|foot|spine|neck)/.test(d.name) && !d.engineMotor);
  const m = sel.length;
  const rows = 6 + m;
  const A: number[][] = Array.from({ length: rows }, () => new Array<number>(12).fill(0));
  const g: number[] = new Array<number>(rows).fill(0);

  const addWrench = (bodyIdx: number, p0: Vec3, wrench: number[], scale = 1): void => {
    const f: Vec3 = { x: wrench[0]! * scale, y: wrench[1]! * scale, z: wrench[2]! * scale };
    const mm: Vec3 = { x: wrench[3]! * scale, y: wrench[4]! * scale, z: wrench[5]! * scale };
    // base rows
    A[0]![0] += f.x; A[1]![0] += f.y; A[2]![0] += f.z;
    const rm = cross(sub(p0, { x: root.x, y: root.y, z: root.z }), f);
    const mt = { x: mm.x + rm.x, y: mm.y + rm.y, z: mm.z + rm.z };
    // 这里只按 foot 的 6 个变量填；contact 调用时传入基向量，不能直接累加固定列。
  };

  // 为每只脚建立 6 列基向量，逐列填 A/g。
  const fillContact = (colBase: number, bi: number, p0: Vec3): void => {
    for (let k = 0; k < 6; k++) {
      const wv = [0, 0, 0, 0, 0, 0]; wv[k] = 1;
      const f: Vec3 = { x: wv[0]!, y: wv[1]!, z: wv[2]! };
      const mm: Vec3 = { x: wv[3]!, y: wv[4]!, z: wv[5]! };
      // base
      A[0]![colBase + k] += f.x;
      A[1]![colBase + k] += f.y;
      A[2]![colBase + k] += f.z;
      const rm = cross(sub(p0, { x: root.x, y: root.y, z: root.z }), f);
      A[3]![colBase + k] += mm.x + rm.x;
      A[4]![colBase + k] += mm.y + rm.y;
      A[5]![colBase + k] += mm.z + rm.z;
      // selected joint rows
      for (let si = 0; si < m; si++) {
        const d = sel[si]!;
        const sub2 = body.subtree[d.joint]!;
        if (!sub2.includes(bi)) continue;
        const a = d.anchorWorld;
        const r = sub(p0, { x: a[0]!, y: a[1]!, z: a[2]! });
        const u = d.axisWorld;
        const rmj = cross(r, f);
        A[6 + si]![colBase + k] += mm.x * u[0]! + mm.y * u[1]! + mm.z * u[2]! + rmj.x * u[0]! + rmj.y * u[1]! + rmj.z * u[2]!;
      }
    }
  };

  fillContact(0, feet[0]!.bi, feet[0]!.p);
  fillContact(6, feet[1]!.bi, feet[1]!.p);

  // gravity generalized force（所有 body）
  for (let bi = 0; bi < body.bodies.length; bi++) {
    const rb = body.bodies[bi]!;
    const c = rb.worldCom();
    const mass = rb.mass();
    if (mass <= 0) continue;
    const f: Vec3 = { x: 0, y: mass * gY, z: 0 };
    const p: Vec3 = { x: c.x, y: c.y, z: c.z };
    g[0]! += f.x; g[1]! += f.y; g[2]! += f.z;
    const rm = cross(sub(p, { x: root.x, y: root.y, z: root.z }), f);
    g[3]! += rm.x; g[4]! += rm.y; g[5]! += rm.z;
    for (let si = 0; si < m; si++) {
      const d = sel[si]!;
      if (!body.subtree[d.joint]!.includes(bi)) continue;
      const a = d.anchorWorld;
      const r = sub(p, { x: a[0]!, y: a[1]!, z: a[2]! });
      const u = d.axisWorld;
      const rj = cross(r, f);
      g[6 + si]! += rj.x * u[0]! + rj.y * u[1]! + rj.z * u[2]!;
    }
  }

  // 先试 6 变量接触解：每脚 (fy, mx, mz)，无水平力；检查 CoP。
  {
    const cols = [1, 3, 5, 7, 9, 11];
    const M6: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    const b6: number[] = new Array<number>(6).fill(0);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) M6[r]![c] = A[r]![cols[c]!]!;
      b6[r] = -g[r]!;
    }
    const w6 = solve(M6, b6);
    if (w6) {
      const W = new Array<number>(12).fill(0);
      for (let c = 0; c < 6; c++) W[cols[c]!] = w6[c]!;
      let ok = true;
      for (let fi = 0; fi < 2; fi++) {
        const fy = W[fi * 6 + 1]!, mx = W[fi * 6 + 3]!, mz = W[fi * 6 + 5]!;
        if (fy <= 1 || !Number.isFinite(fy)) { ok = false; break; }
        const p0 = feet[fi]!.p;
        const copX = p0.x + mz / fy;
        const copZ = p0.z - mx / fy;
        if (Math.abs(copX - p0.x) > 0.12 || Math.abs(copZ - p0.z) > 0.06) { ok = false; break; }
      }
      if (ok) {
        const out = new Float64Array(body.dofs.length);
        for (let si = 0; si < m; si++) {
          let gq = g[6 + si]!;
          for (let i = 0; i < 12; i++) gq += A[6 + si]![i]! * W[i]!;
          out[sel[si]!.dofIndex] = -gq;
        }
        return out;
      }
    }
  }

  // 目标：min ||A_j W + g_j||² + eps||W||²；等式 A_b W = -g_b
  const H: number[][] = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const h: number[] = new Array<number>(12).fill(0);
  const eps = 1e-4;
  for (let si = 0; si < m; si++) {
    const row = A[6 + si]!;
    for (let i = 0; i < 12; i++) {
      h[i]! += row[i]! * g[6 + si]!;
      for (let j = 0; j < 12; j++) H[i]![j]! += row[i]! * row[j]!;
    }
  }
  for (let i = 0; i < 12; i++) H[i]![i]! += eps;

  // KKT: [2H A_b^T; A_b 0] [W; λ] = [-2h; -g_b]
  const n = 12 + 6;
  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rhs: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) K[i]![j] = 2 * H[i]![j]!;
    rhs[i] = -2 * h[i]!;
  }
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 12; c++) K[12 + r]![c] = A[r]![c]!;
    K[12 + r]![12 + r] = 0;
    rhs[12 + r] = -g[r]!;
    for (let c = 0; c < 12; c++) K[c]![12 + r] = A[r]![c]!;
  }
  const sol = solve(K, rhs);
  if (!sol) return null;
  const W = sol.slice(0, 12);

  const out = new Float64Array(body.dofs.length);
  for (let si = 0; si < m; si++) {
    const row = A[6 + si]!;
    let gq = g[6 + si]!;
    for (let i = 0; i < 12; i++) gq += row[i]! * W[i]!;
    const d = sel[si]!;
    out[d.dofIndex] = -gq;
  }
  return out;
}
