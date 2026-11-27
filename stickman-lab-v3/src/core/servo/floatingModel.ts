import type { World } from '../world';
import { qMul, qRotateVec, qInvRotateVec, type Quat } from '../quat';
import type { FloatingContact } from './floatingBaseId';

export interface FloatingModel {
  w: World;
  nq: number;
  dofs: World['body']['dofs'];
  M: number[][];
  G: number[];
  jointSub: Set<number>[];
  bodies: Array<{ bi: number; jv: number[][]; jw: number[][] }>;
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

export function buildFloatingModel(w: World): FloatingModel {
  const dofs = w.body.dofs;
  const nq = 6 + dofs.length;
  const M = Array.from({ length: nq }, () => new Array<number>(nq).fill(0));
  const G = new Array<number>(nq).fill(0);
  const jointSub = dofs.map((d) => new Set(w.body.subtree[d.joint] ?? []));
  const bodies: Array<{ bi: number; jv: number[][]; jw: number[][] }> = [];
  for (let bi = 0; bi < w.body.bodies.length; bi++) {
    const b = w.body.bodies[bi]!;
    const m = b.mass();
    if (m <= 0) continue;
    const p = b.worldCom();
    const q = b.rotation() as Quat;
    const jv: number[][] = Array.from({ length: 3 }, (_, r) => {
      const row = new Array<number>(nq).fill(0);
      row[0] = r === 0 ? 1 : 0; row[1] = r === 1 ? 1 : 0; row[2] = r === 2 ? 1 : 0;
      row[3] = r === 0 ? 0 : r === 1 ? -p.z : p.y;
      row[4] = r === 0 ? p.z : r === 1 ? 0 : -p.x;
      row[5] = r === 0 ? -p.y : r === 1 ? p.x : 0;
      return row;
    });
    const jw: number[][] = Array.from({ length: 3 }, (_, r) => {
      const row = new Array<number>(nq).fill(0);
      row[3 + r] = 1;
      return row;
    });
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(bi)) continue;
      const d = dofs[j]!;
      const a = d.axisWorld;
      const an = d.anchorWorld;
      const v = cross(a[0]!, a[1]!, a[2]!, p.x - an[0]!, p.y - an[1]!, p.z - an[2]!);
      for (let r = 0; r < 3; r++) { jv[r]![6 + j] = v[r]!; jw[r]![6 + j] = a[r]!; }
    }
    bodies.push({ bi, jv, jw });
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
    G[3]! += -p.z * Fy;
    G[5]! += p.x * Fy;
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(bi)) continue;
      const d = dofs[j]!;
      const an = d.anchorWorld;
      const mf = cross(p.x - an[0]!, p.y - an[1]!, p.z - an[2]!, 0, Fy, 0);
      G[6 + j]! += d.axisWorld[0]! * mf[0]! + d.axisWorld[1]! * mf[1]! + d.axisWorld[2]! * mf[2]!;
    }
  }
  return { w, nq, dofs, M, G, jointSub, bodies };
}

export function buildContactJacobians(model: FloatingModel, contacts: FloatingContact[]): number[][][] {
  const { w, nq, dofs, jointSub } = model;
  return contacts.map((c) => {
    const jc = Array.from({ length: 6 }, () => new Array<number>(nq).fill(0));
    jc[0]![0] = 1; jc[1]![1] = 1; jc[2]![2] = 1;
    jc[0]![4] = c.z; jc[0]![5] = -c.y;
    jc[1]![3] = -c.z; jc[1]![5] = c.x;
    jc[2]![3] = c.y; jc[2]![4] = -c.x;
    jc[3]![3] = 1; jc[4]![4] = 1; jc[5]![5] = 1;
    for (let j = 0; j < dofs.length; j++) {
      if (!jointSub[j]!.has(c.body)) continue;
      const d = dofs[j]!;
      const a = d.axisWorld;
      const an = d.anchorWorld;
      const v = cross(a[0]!, a[1]!, a[2]!, c.x - an[0]!, c.y - an[1]!, c.z - an[2]!);
      for (let r = 0; r < 3; r++) { jc[r]![6 + j] = v[r]!; jc[3 + r]![6 + j] = a[r]!; }
    }
    return jc;
  });
}

export function generalizedVelocity(model: FloatingModel): number[] {
  const { w, nq, dofs } = model;
  const qd = new Array<number>(nq).fill(0);
  const root = w.body.root();
  const v = root.linvel();
  const av = root.angvel();
  qd[0] = v.x; qd[1] = v.y; qd[2] = v.z;
  qd[3] = av.x; qd[4] = av.y; qd[5] = av.z;
  for (let j = 0; j < dofs.length; j++) qd[6 + j] = dofs[j]!.vel;
  return qd;
}

export function computeCoriolis(model: FloatingModel, qd: number[]): number[] {
  const { w, nq, M } = model;
  const C = new Array<number>(nq).fill(0);
  for (const entry of model.bodies) {
    const b = w.body.bodies[entry.bi]!;
    const m = b.mass();
    if (m <= 0) continue;
    const v = [0, 0, 0];
    const om = [0, 0, 0];
    for (let a = 0; a < nq; a++) for (let r = 0; r < 3; r++) { v[r]! += entry.jv[r]![a]! * qd[a]!; om[r]! += entry.jw[r]![a]! * qd[a]!; }
    const ab = cross(om[0]!, om[1]!, om[2]!, v[0]!, v[1]!, v[2]!);
    const iw = inertiaWorld(b, b.rotation() as Quat, om);
    const ng = cross(om[0]!, om[1]!, om[2]!, iw[0]!, iw[1]!, iw[2]!);
    for (let a = 0; a < nq; a++) {
      let s = 0;
      for (let r = 0; r < 3; r++) s += entry.jv[r]![a]! * m * ab[r]! + entry.jw[r]![a]! * ng[r]!;
      C[a]! += s;
    }
  }
  // small mass-matrix derivative damping is not included; this is velocity bias.
  return C;
}

export function contactTaskBias(model: FloatingModel, contacts: FloatingContact[], qd: number[]): number[][] {
  const { w } = model;
  return contacts.map((c) => {
    const b = w.body.bodies[c.body]!;
    const v = b.linvel();
    const om = b.angvel();
    const qv = [v.x, v.y, v.z];
    const qw = [om.x, om.y, om.z];
    const av = cross(qw[0]!, qw[1]!, qw[2]!, qv[0]!, qv[1]!, qv[2]!);
    return [av[0]!, av[1]!, av[2]!, 0, 0, 0];
  });
}
