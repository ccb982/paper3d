import type { World } from '../world';
import { qMul, qRotateVec, qInvRotateVec, type Quat } from '../quat';

export interface ContactWrench6 {
  fx: number; fy: number; fz: number;
  tx: number; ty: number; tz: number;
}

export interface LegJacobian6 {
  dofs: number[];
  names: string[];
  J: number[][];
}

export interface FootSupportBox {
  halfX: number;
  halfZ: number;
  mu: number;
}

export function buildLegJacobian6(w: World, side: 'l' | 'r', cx: number, cy: number, cz: number): LegJacobian6 {
  const names: string[] = [];
  const dofs: number[] = [];
  const cols: number[][] = [];
  for (const j of ['hip', 'knee', 'foot'] as const) {
    for (const ax of [0, 1, 2] as const) {
      const name = `${j}_${side}`;
      const i = w.body.dofByName(name, ax);
      if (i < 0) continue;
      const d = w.body.dofs[i]!;
      const a = d.axisWorld;
      const an = d.anchorWorld;
      const rx = cx - an[0]!, ry = cy - an[1]!, rz = cz - an[2]!;
      const axx = a[0]!, axy = a[1]!, axz = a[2]!;
      const col = [
        axy * rz - axz * ry,
        axz * rx - axx * rz,
        axx * ry - axy * rx,
        axx, axy, axz,
      ];
      names.push(`${name}/${ax}`);
      dofs.push(i);
      cols.push(col);
    }
  }
  const J = Array.from({ length: 6 }, (_, r) => cols.map((c) => c[r]!));
  return { dofs, names, J };
}

export function wrenchToJointTorques(jac: LegJacobian6, w: ContactWrench6): number[] {
  const v = [w.fx, w.fy, w.fz, w.tx, w.ty, w.tz];
  const n = jac.dofs.length;
  const out = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let r = 0; r < 6; r++) out[j]! += jac.J[r]![j]! * v[r]!;
  }
  return out;
}

function crossVec(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function inertiaWith(q: Quat, b: { principalInertia(): { x: number; y: number; z: number }; principalInertiaLocalFrame(): { x: number; y: number; z: number; w: number } }, v: number[]): number[] {
  const qp = b.principalInertiaLocalFrame() as Quat;
  const qe = qMul(q, qp);
  const l = new Float64Array(3);
  qInvRotateVec(qe, v[0]!, v[1]!, v[2]!, l);
  const I = b.principalInertia();
  const o = new Float64Array(3);
  qRotateVec(qe, I.x * l[0]!, I.y * l[1]!, I.z * l[2]!, o);
  return [o[0]!, o[1]!, o[2]!];
}

export function legMassMatrix(w: World, side: 'l' | 'r'): { dofs: number[]; M: number[][] } {
  const dofs: number[] = [];
  const axis: number[][] = [];
  const anchor: number[][] = [];
  const subs: Set<number>[] = [];
  for (const j of ['hip', 'knee', 'foot'] as const) {
    for (const ax of [0, 1, 2] as const) {
      const name = `${j}_${side}`;
      const i = w.body.dofByName(name, ax);
      if (i < 0) continue;
      const d = w.body.dofs[i]!;
      dofs.push(i);
      axis.push([d.axisWorld[0]!, d.axisWorld[1]!, d.axisWorld[2]!]);
      anchor.push([d.anchorWorld[0]!, d.anchorWorld[1]!, d.anchorWorld[2]!]);
      subs.push(new Set(w.body.subtree[d.joint] ?? []));
    }
  }
  const n = dofs.length;
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let bi = 0; bi < w.body.bodies.length; bi++) {
    const b = w.body.bodies[bi]!;
    const m = b.mass();
    if (m <= 0) continue;
    const p = b.worldCom();
    const q = b.rotation() as Quat;
    const Jv: number[][] = [];
    const Jw: number[][] = [];
    for (let j = 0; j < n; j++) {
      if (!subs[j]!.has(bi)) { Jv.push([0, 0, 0]); Jw.push([0, 0, 0]); continue; }
      Jv.push(crossVec(axis[j]![0]!, axis[j]![1]!, axis[j]![2]!, p.x - anchor[j]![0]!, p.y - anchor[j]![1]!, p.z - anchor[j]![2]!));
      Jw.push(axis[j]!);
    }
    for (let a = 0; a < n; a++) {
      for (let c = 0; c < n; c++) {
        const va = Jv[a]!, vc = Jv[c]!;
        M[a]![c]! += m * (va[0]! * vc[0]! + va[1]! * vc[1]! + va[2]! * vc[2]!);
        if (subs[a]!.has(bi) && subs[c]!.has(bi)) {
          const iw = inertiaWith(q, b, axis[c]!);
          M[a]![c]! += axis[a]![0]! * iw[0]! + axis[a]![1]! * iw[1]! + axis[a]![2]! * iw[2]!;
        }
      }
    }
  }
  return { dofs, M };
}

function invertN(mat: number[][]): number[][] | null {
  const n = mat.length;
  const a = mat.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[p]![col]!)) p = r;
    if (Math.abs(a[p]![col]!) < 1e-12) return null;
    if (p !== col) { const t = a[col]!; a[col] = a[p]!; a[p] = t; }
    const d = a[col]![col]!;
    for (let c = 0; c < 2 * n; c++) a[col]![c]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let c = 0; c < 2 * n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row.slice(n));
}

export function projectContactNullM(jac: LegJacobian6, M: number[][], tau: number[], lambda = 1e-6): number[] {
  const n = jac.dofs.length;
  const Mi = invertN(M.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0))));
  if (!Mi) return [...tau];
  const MJt = Array.from({ length: n }, () => new Array<number>(6).fill(0));
  for (let a = 0; a < n; a++) for (let r = 0; r < 6; r++) {
    let s = 0;
    for (let b = 0; b < n; b++) s += Mi[a]![b]! * jac.J[r]![b]!;
    MJt[a]![r] = s;
  }
  const G = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    let s = 0;
    for (let a = 0; a < n; a++) s += jac.J[r]![a]! * MJt[a]![c]!;
    G[r]![c] = s + (r === c ? lambda : 0);
  }
  const Gi = invertN(G);
  if (!Gi) return [...tau];
  const Jbar = Array.from({ length: n }, () => new Array<number>(6).fill(0));
  for (let a = 0; a < n; a++) for (let r = 0; r < 6; r++) {
    let s = 0;
    for (let c = 0; c < 6; c++) s += MJt[a]![c]! * Gi[c]![r]!;
    Jbar[a]![r] = s;
  }
  const out = [...tau];
  for (let a = 0; a < n; a++) {
    let c0 = 0;
    for (let r = 0; r < 6; r++) for (let b = 0; b < n; b++) c0 += jac.J[r]![b]! * tau[b]! * Jbar[a]![r]!;
    out[a]! -= c0;
  }
  return out;
}

export function footCwcRows(box: FootSupportBox): { A: number[][]; b: number[] } {
  const A: number[][] = [];
  const b: number[] = [];
  const add = (coeff: number[], rhs: number): void => { A.push(coeff); b.push(rhs); };
  add([0, 0, -1, 0, 0, 0], 0);
  add([-box.mu, 0, -1, 0, 0, 0], 0);
  add([box.mu, 0, -1, 0, 0, 0], 0);
  add([0, -box.mu, -1, 0, 0, 0], 0);
  add([0, box.mu, -1, 0, 0, 0], 0);
  add([0, 0, -box.halfX, -1, 0, 0], 0);
  add([0, 0, -box.halfX, 1, 0, 0], 0);
  add([0, 0, -box.halfZ, 0, -1, 0], 0);
  add([0, 0, -box.halfZ, 0, 1, 0], 0);
  add([0, 0, -box.mu * (box.halfX + box.halfZ), 0, 0, -1], 0);
  add([0, 0, -box.mu * (box.halfX + box.halfZ), 0, 0, 1], 0);
  return { A, b };
}

export function wrenchFeasible(w: ContactWrench6, box: FootSupportBox): boolean {
  const { A, b } = footCwcRows(box);
  const v = [w.fx, w.fy, w.fz, w.tx, w.ty, w.tz];
  for (let i = 0; i < A.length; i++) {
    if (A[i]!.reduce((s, a, j) => s + a * v[j]!, 0) > b[i]! + 1e-9) return false;
  }
  return true;
}

function invert6(m: number[][]): number[][] | null {
  const a = m.map((row, i) => [...row, ...Array.from({ length: 6 }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < 6; col++) {
    let p = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[p]![col]!)) p = r;
    if (Math.abs(a[p]![col]!) < 1e-12) return null;
    if (p !== col) { const t = a[col]!; a[col] = a[p]!; a[p] = t; }
    const d = a[col]![col]!;
    for (let c = 0; c < 12; c++) a[col]![c]! /= d;
    for (let r = 0; r < 6; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let c = 0; c < 12; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row.slice(6));
}

export function projectContactNull(jac: LegJacobian6, tau: number[], lambda = 1e-6): number[] {
  const G = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < jac.dofs.length; k++) s += jac.J[i]![k]! * jac.J[j]![k]!;
      G[i]![j] = s + (i === j ? lambda : 0);
    }
  }
  const Gi = invert6(G);
  if (!Gi) return [...tau];
  const out = [...tau];
  for (let k = 0; k < jac.dofs.length; k++) {
    let correction = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) correction += jac.J[i]![k]! * Gi[i]![j]! * (() => {
        let s = 0;
        for (let q = 0; q < jac.dofs.length; q++) s += jac.J[j]![q]! * tau[q]!;
        return s;
      })();
    }
    out[k]! -= correction;
  }
  return out;
}
