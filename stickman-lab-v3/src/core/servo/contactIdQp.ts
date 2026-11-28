import { solveQP } from 'quadprog';

export interface ContactIdContact {
  jacobian: number[][];
  halfX: number;
  halfZ: number;
  mu: number;
  fzMin: number;
  wrenchRef?: number[];
}

export interface ContactIdQpInput {
  massMatrix: number[][];
  gravity: number[];
  qddTarget: number[];
  contacts: ContactIdContact[];
  torqueMax: number[];
  torqueRef?: number[];
  qddWeight?: number;
  tauWeight?: number;
  wrenchWeight?: number;
}

export interface ContactIdQpOutput {
  qdd: number[];
  tau: number[];
  wrenches: number[][];
  feasible: boolean;
  message: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveContactIdQp(i: ContactIdQpInput): ContactIdQpOutput {
  const nq = i.massMatrix.length;
  const ndof = Math.max(0, i.torqueMax.length);
  const nc = i.contacts.length;
  if (nq === 0 || nc === 0) return { qdd: [], tau: [], wrenches: [], feasible: false, message: 'no system' };
  const nv = nq + ndof + nc * 6;
  const D: number[][] = Array.from({ length: nv + 1 }, () => new Array<number>(nv + 1).fill(0));
  const d: number[] = new Array<number>(nv + 1).fill(0);
  const qw = Math.max(1e-6, i.qddWeight ?? 1);
  const tw = Math.max(1e-6, i.tauWeight ?? 0.01);
  const ww = Math.max(1e-6, i.wrenchWeight ?? 1);
  for (let a = 0; a < nq; a++) { D[a + 1]![a + 1] = qw; d[a + 1] = qw * (i.qddTarget[a] ?? 0); }
  for (let j = 0; j < ndof; j++) { const k = nq + j; D[k + 1]![k + 1] = tw; d[k + 1] = tw * (i.torqueRef?.[j] ?? 0); }
  for (let ci = 0; ci < nc; ci++) for (let r = 0; r < 6; r++) {
    const k = nq + ndof + ci * 6 + r;
    D[k + 1]![k + 1] = ww;
    d[k + 1] = ww * (i.contacts[ci]!.wrenchRef?.[r] ?? 0);
  }
  const rows: number[][] = [];
  const b: number[] = [];
  const add = (row: number[], rhs: number): void => { rows.push(row); b.push(rhs); };
  for (let a = 0; a < nq; a++) {
    const row = new Array<number>(nv).fill(0);
    for (let c = 0; c < nq; c++) row[c] = i.massMatrix[a]?.[c] ?? 0;
    if (a >= 6 && ndof > 0) row[nq + a - 6] = -1;
    for (let ci = 0; ci < nc; ci++) for (let r = 0; r < 6; r++) row[nq + ndof + ci * 6 + r] = -(i.contacts[ci]!.jacobian[r]?.[a] ?? 0);
    add(row, (i.gravity[a] ?? 0));
  }
  const meq = rows.length;
  for (let ci = 0; ci < nc; ci++) {
    const base = nq + ndof + ci * 6;
    const f = i.contacts[ci]!;
    const mu = Math.max(0, f.mu);
    const hx = Math.max(1e-4, f.halfX);
    const hz = Math.max(1e-4, f.halfZ);
    const addI = (coeff: [number, number, number, number, number, number], rhs: number): void => {
      const row = new Array<number>(nv).fill(0);
      for (let r = 0; r < 6; r++) row[base + r] = coeff[r]!;
      rows.push(row); b.push(rhs);
    };
    addI([0, 1, 0, 0, 0, 0], f.fzMin);
    addI([-1, mu, 0, 0, 0, 0], 0);
    addI([1, mu, 0, 0, 0, 0], 0);
    addI([0, mu, -1, 0, 0, 0], 0);
    addI([0, mu, 1, 0, 0, 0], 0);
    addI([0, hz, 0, -1, 0, 0], 0);
    addI([0, hz, 0, 1, 0, 0], 0);
    addI([0, hx, 0, 0, 0, -1], 0);
    addI([0, hx, 0, 0, 0, 1], 0);
  }
  for (let j = 0; j < ndof; j++) {
    const row = new Array<number>(nv).fill(0);
    row[nq + j] = 1;
    rows.push(row); b.push(-Math.abs(i.torqueMax[j] ?? 0));
    const row2 = new Array<number>(nv).fill(0);
    row2[nq + j] = -1;
    rows.push(row2); b.push(-Math.abs(i.torqueMax[j] ?? 0));
  }
  const Amat: number[][] = Array.from({ length: nv + 1 }, () => new Array<number>(rows.length + 1).fill(0));
  for (let k = 0; k < rows.length; k++) for (let a = 0; a < nv; a++) Amat[a + 1]![k + 1] = rows[k]![a]!;
  const qp = solveQP(D, d, Amat, [0, ...b], meq);
  if (qp.message) return { qdd: [], tau: [], wrenches: [], feasible: false, message: qp.message };
  const x = qp.solution;
  const qdd = Array.from({ length: nq }, (_, a) => x[a + 1] ?? 0);
  const tau = Array.from({ length: ndof }, (_, j) => x[nq + j + 1] ?? 0);
  const wrenches = Array.from({ length: nc }, (_, ci) => Array.from({ length: 6 }, (_, r) => x[nq + ndof + ci * 6 + r + 1] ?? 0));
  const finite = [...qdd, ...tau, ...wrenches.flat()].every(Number.isFinite);
  for (let ci = 0; ci < nc; ci++) {
    const f = i.contacts[ci]!;
    const W = wrenches[ci]!;
    const fy = W[1]!;
    const mu = Math.max(0, f.mu);
    if (fy < f.fzMin - 1e-7 || Math.abs(W[0]!) > mu * fy + 1e-7 || Math.abs(W[2]!) > mu * fy + 1e-7) return { qdd, tau, wrenches, feasible: false, message: 'CWC' };
    if (Math.abs(W[5]!) > Math.max(0, f.halfX) * fy + 1e-7) return { qdd, tau, wrenches, feasible: false, message: 'CoP' };
  }
  for (let j = 0; j < ndof; j++) if (Math.abs(tau[j]!) > Math.abs(i.torqueMax[j] ?? 0) + 1e-7) return { qdd, tau, wrenches, feasible: false, message: 'tau' };
  return { qdd, tau, wrenches, feasible: finite, message: finite ? '' : 'nonfinite' };
}

export function solveContactIdWrenchQp(i: ContactIdQpInput): ContactIdQpOutput {
  const nq = i.massMatrix.length;
  const ndof = Math.max(0, i.torqueMax.length);
  const nc = i.contacts.length;
  if (nq < 6 || nc === 0) return { qdd: [], tau: [], wrenches: [], feasible: false, message: 'no system' };
  const nv = nc * 6;
  const D: number[][] = Array.from({ length: nv + 1 }, () => new Array<number>(nv + 1).fill(0));
  const d: number[] = new Array<number>(nv + 1).fill(0);
  for (let ci = 0; ci < nc; ci++) for (let r = 0; r < 6; r++) {
    const k = ci * 6 + r;
    D[k + 1]![k + 1] = 1;
    d[k + 1] = i.contacts[ci]!.wrenchRef?.[r] ?? 0;
  }
  const rows: number[][] = [];
  const b: number[] = [];
  for (let a = 0; a < 6; a++) {
    const row = new Array<number>(nv).fill(0);
    for (let ci = 0; ci < nc; ci++) for (let r = 0; r < 6; r++) row[ci * 6 + r] = -(i.contacts[ci]!.jacobian[r]?.[a] ?? 0);
    let rhs = i.gravity[a] ?? 0;
    for (let c = 0; c < nq; c++) rhs -= (i.massMatrix[a]?.[c] ?? 0) * (i.qddTarget[c] ?? 0);
    rows.push(row); b.push(rhs);
  }
  const meq = rows.length;
  for (let ci = 0; ci < nc; ci++) {
    const base = ci * 6;
    const f = i.contacts[ci]!;
    const mu = Math.max(0, f.mu);
    const hx = Math.max(1e-4, f.halfX);
    const hz = Math.max(1e-4, f.halfZ);
    const addI = (coeff: [number, number, number, number, number, number], rhs: number): void => {
      const row = new Array<number>(nv).fill(0);
      for (let r = 0; r < 6; r++) row[base + r] = coeff[r]!;
      rows.push(row); b.push(rhs);
    };
    addI([0, 1, 0, 0, 0, 0], f.fzMin);
    addI([-1, mu, 0, 0, 0, 0], 0);
    addI([1, mu, 0, 0, 0, 0], 0);
    addI([0, mu, -1, 0, 0, 0], 0);
    addI([0, mu, 1, 0, 0, 0], 0);
    addI([0, hz, 0, -1, 0, 0], 0);
    addI([0, hz, 0, 1, 0, 0], 0);
    addI([0, hx, 0, 0, 0, -1], 0);
    addI([0, hx, 0, 0, 0, 1], 0);
  }
  const Amat: number[][] = Array.from({ length: nv + 1 }, () => new Array<number>(rows.length + 1).fill(0));
  for (let k = 0; k < rows.length; k++) for (let a = 0; a < nv; a++) Amat[a + 1]![k + 1] = rows[k]![a]!;
  const qp = solveQP(D, d, Amat, [0, ...b], meq);
  if (qp.message) return { qdd: [], tau: [], wrenches: [], feasible: false, message: qp.message };
  const W: number[][] = [];
  for (let ci = 0; ci < nc; ci++) W.push(Array.from({ length: 6 }, (_, r) => qp.solution[ci * 6 + r + 1] ?? 0));
  const tau: number[] = [];
  const qdd = i.qddTarget.slice();
  for (let j = 0; j < ndof; j++) {
    const a = 6 + j;
    let v = i.gravity[a] ?? 0;
    for (let c = 0; c < nq; c++) v -= (i.massMatrix[a]?.[c] ?? 0) * (qdd[c] ?? 0);
    for (let ci = 0; ci < nc; ci++) for (let r = 0; r < 6; r++) v += (i.contacts[ci]!.jacobian[r]?.[a] ?? 0) * W[ci]![r]!;
    tau.push(-v);
  }
  const feasible = W.every((row) => row.every(Number.isFinite));
  return { qdd, tau, wrenches: W, feasible, message: feasible ? '' : 'nonfinite' };
}
