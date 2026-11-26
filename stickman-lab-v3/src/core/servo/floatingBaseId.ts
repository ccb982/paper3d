import type { World } from '../world';
import { qMul, qRotateVec, qInvRotateVec, type Quat } from '../quat';

export interface FloatingContact {
  body: number;
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface FloatingBaseIdInput {
  w: World;
  qdd: number[];
  contacts: FloatingContact[];
  baseCorrect?: boolean;
}

export interface FloatingBaseIdOutput {
  tau: number[];
  baseResidual: number[];
  M: number[][];
  feasible: boolean;
}

function cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function inertiaWorld(b: { principalInertia(): { x: number; y: number; z: number }; principalInertiaLocalFrame(): { x: number; y: number; z: number; w: number } }, q: Quat, v: number[]): [number, number, number] {
  const qp = b.principalInertiaLocalFrame() as Quat;
  const qe = qMul(q, qp);
  const l = new Float64Array(3);
  qInvRotateVec(qe, v[0]!, v[1]!, v[2]!, l);
  const ii = b.principalInertia();
  const o = new Float64Array(3);
  qRotateVec(qe, ii.x * l[0]!, ii.y * l[1]!, ii.z * l[2]!, o);
  return [o[0]!, o[1]!, o[2]!];
}

function solve6(A: number[][], b: number[]): number[] | null {
  const n = 6;
  const a = A.map((row, r) => [...row, b[r]!]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[p]![col]!)) p = r;
    if (Math.abs(a[p]![col]!) < 1e-12) return null;
    if (p !== col) { const t = a[col]!; a[col] = a[p]!; a[p] = t; }
    const d = a[col]![col]!;
    for (let c = col; c <= n; c++) a[col]![c]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let c = col; c <= n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row[n]!);
}

export function solveFloatingBaseId(i: FloatingBaseIdInput): FloatingBaseIdOutput {
  const w = i.w;
  const dofs = w.body.dofs;
  const nq = 6 + dofs.length;
  const M = Array.from({ length: nq }, () => new Array<number>(nq).fill(0));
  const G = new Array<number>(nq).fill(0);
  const jointSub = dofs.map((d) => new Set(w.body.subtree[d.joint] ?? []));
  for (let bi = 0; bi < w.body.bodies.length; bi++) {
    const b = w.body.bodies[bi]!;
    const m = b.mass();
    if (m <= 0) continue;
    const p = b.worldCom();
    const q = b.rotation() as Quat;
    const JvRows: number[][] = [
      [1, 0, 0, 0, p.z, -p.y],
      [0, 1, 0, -p.z, 0, p.x],
      [0, 0, 1, p.y, -p.x, 0],
    ];
    const JwRows: number[][] = [
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 1],
    ];
    const jv: number[][] = Array.from({ length: 3 }, () => new Array<number>(nq).fill(0));
    const jw: number[][] = Array.from({ length: 3 }, () => new Array<number>(nq).fill(0));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { jv[r]![c] = JvRows[r]![c]!; jw[r]![c] = JwRows[r]![c]!; }
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(bi)) continue;
      const d = dofs[j]!;
      const a = d.axisWorld;
      const an = d.anchorWorld;
      const v = cross(a[0]!, a[1]!, a[2]!, p.x - an[0]!, p.y - an[1]!, p.z - an[2]!);
      for (let r = 0; r < 3; r++) { jv[r]![6 + j] = v[r]!; jw[r]![6 + j] = a[r]!; }
    }
    const iw0 = inertiaWorld(b, q, [1, 0, 0]);
    const iw1 = inertiaWorld(b, q, [0, 1, 0]);
    const iw2 = inertiaWorld(b, q, [0, 0, 1]);
    for (let a = 0; a < nq; a++) {
      for (let c = 0; c < nq; c++) {
        let s = m * (jv[0]![a]! * jv[0]![c]! + jv[1]![a]! * jv[1]![c]! + jv[2]![a]! * jv[2]![c]!);
        const wx = jw[0]![c]!, wy = jw[1]![c]!, wz = jw[2]![c]!;
        const ix = iw0[0]! * wx + iw1[0]! * wy + iw2[0]! * wz;
        const iy = iw0[1]! * wx + iw1[1]! * wy + iw2[1]! * wz;
        const iz = iw0[2]! * wx + iw1[2]! * wy + iw2[2]! * wz;
        s += jw[0]![a]! * ix + jw[1]![a]! * iy + jw[2]![a]! * iz;
        M[a]![c]! += s;
      }
    }
    const Fy = -m * 9.81;
    G[1]! += Fy;
    G[3]! += p.y * 0 - p.z * Fy;
    G[4]! += p.z * 0 - p.x * 0;
    G[5]! += p.x * Fy - p.y * 0;
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(bi)) continue;
      const d = dofs[j]!;
      const an = d.anchorWorld;
      const r = [p.x - an[0]!, p.y - an[1]!, p.z - an[2]!];
      const mf = cross(r[0]!, r[1]!, r[2]!, 0, Fy, 0);
      G[6 + j]! += d.axisWorld[0]! * mf[0]! + d.axisWorld[1]! * mf[1]! + d.axisWorld[2]! * mf[2]!;
    }
  }
  const qdd = i.qdd ?? [];
  const rhs = new Array<number>(nq).fill(0);
  for (let a = 0; a < nq; a++) {
    let s = G[a]!;
    for (let c = 0; c < nq; c++) s += M[a]![c]! * (qdd[c] ?? 0);
    rhs[a] = s;
  }
  const jcs: number[][][] = [];
  const Ws: number[][] = [];
  for (const c of i.contacts) {
    const b = w.body.bodies[c.body]!;
    const q = b.rotation() as Quat;
    const jc: number[][] = Array.from({ length: 6 }, () => new Array<number>(nq).fill(0));
    const JvRows: number[][] = [
      [1, 0, 0, 0, c.z, -c.y],
      [0, 1, 0, -c.z, 0, c.x],
      [0, 0, 1, c.y, -c.x, 0],
    ];
    const JwRows: number[][] = [
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 1],
    ];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { jc[r]![k] = JvRows[r]![k]!; jc[3 + r]![k] = JwRows[r]![k]!; }
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(c.body)) continue;
      const d = dofs[j]!;
      const a = d.axisWorld;
      const an = d.anchorWorld;
      const v = cross(a[0]!, a[1]!, a[2]!, c.x - an[0]!, c.y - an[1]!, c.z - an[2]!);
      for (let r = 0; r < 3; r++) { jc[r]![6 + j] = v[r]!; jc[3 + r]![6 + j] = a[r]!; }
    }
    const W = [c.fx, c.fy, c.fz, c.tx, c.ty, c.tz];
    jcs.push(jc);
    Ws.push(W);
    for (let a = 0; a < nq; a++) {
      let s = 0;
      for (let r = 0; r < 6; r++) s += jc[r]![a]! * W[r]!;
      rhs[a]! += s;
    }
  }
  if (i.baseCorrect && jcs.length > 0) {
    const nc = jcs.length;
    const Jb = Array.from({ length: 6 }, () => new Array<number>(6 * nc).fill(0));
    for (let ci = 0; ci < nc; ci++) {
      const jc = jcs[ci]!;
      for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) Jb[r]![ci * 6 + k] = jc[r]![k]!;
    }
    const A = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => {
      let sum = 0;
      for (let k = 0; k < 6 * nc; k++) sum += Jb[r]![k]! * Jb[c]![k]!;
      return sum + (r === c ? 1e-6 : 0);
    }));
    const target = rhs.slice(0, 6).map((v) => -v);
    const y = solve6(A, target);
    if (y) {
      const dW = new Array<number>(6 * nc).fill(0);
      for (let k = 0; k < 6 * nc; k++) {
        let sum = 0;
        for (let r = 0; r < 6; r++) sum += Jb[r]![k]! * y[r]!;
        dW[k] = sum;
      }
      for (let ci = 0; ci < nc; ci++) {
        for (let r = 0; r < 6; r++) Ws[ci]![r]! += dW[ci * 6 + r]!;
        for (let a = 0; a < nq; a++) {
          let sum = 0;
          for (let r = 0; r < 6; r++) sum += jcs[ci]![r]![a]! * dW[ci * 6 + r]!;
          rhs[a]! += sum;
        }
      }
    }
  }
  const tau = new Array<number>(dofs.length).fill(0);
  for (let j = 0; j < dofs.length; j++) tau[j] = rhs[6 + j]!;
  return { tau, baseResidual: rhs.slice(0, 6), M, feasible: true };
}
