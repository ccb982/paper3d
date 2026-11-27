import type { World } from '../world';
import { solveQP } from 'quadprog';
import type { FloatingContact } from './floatingBaseId';
import {
  buildContactJacobians,
  buildFloatingModel,
  computeCoriolis,
  contactTaskBias,
  generalizedVelocity,
} from './floatingModel';

export interface FullTsidInput {
  w: World;
  contacts: FloatingContact[];
  contactAccDes?: number[][];
  wDes?: number[];
  tauPrev?: number[];
  wQdd?: number;
  wWrench?: number;
  wTau?: number;
  contactHard?: boolean;
  contactWeight?: number;
}

export interface FullTsidOutput {
  tau: number[];
  qdd: number[];
  W: number[];
  feasible: boolean;
  message: string;
  baseResidual: number[];
  contactResidual: number[];
}

export function solveFullTsid(i: FullTsidInput): FullTsidOutput {
  const model = buildFloatingModel(i.w);
  const { nq, dofs, M, G } = model;
  const nc = i.contacts.length;
  const nd = dofs.length;
  const n = nq + 6 * nc + nd;
  const qd = generalizedVelocity(model);
  const C = computeCoriolis(model, qd);
  const Jc = buildContactJacobians(model, i.contacts);
  const bias = contactTaskBias(model, i.contacts, qd);

  const D = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  const d = new Array<number>(n + 1).fill(0);
  const wq = Math.max(1e-6, i.wQdd ?? 1);
  const ww = Math.max(1e-6, i.wWrench ?? 10);
  const wt = Math.max(1e-6, i.wTau ?? 0.01);
  for (let k = 0; k < nq; k++) D[k + 1]![k + 1] = wq;
  for (let k = 0; k < 6 * nc; k++) {
    const idx = nq + k;
    D[idx + 1]![idx + 1] = ww;
    d[idx + 1] = ww * (i.wDes?.[k] ?? 0);
  }
  for (let k = 0; k < nd; k++) {
    const idx = nq + 6 * nc + k;
    D[idx + 1]![idx + 1] = wt;
    d[idx + 1] = wt * (i.tauPrev?.[k] ?? 0);
  }

  const contactHard = i.contactHard !== false;
  const wc = Math.max(0, i.contactWeight ?? 0);
  if (!contactHard && wc > 0) {
    for (let ci = 0; ci < nc; ci++) {
      for (let a = 0; a < 6; a++) {
        const target = (i.contactAccDes?.[ci]?.[a] ?? 0) - bias[ci]![a]!;
        for (let r = 0; r < nq; r++) {
          const jr = Jc[ci]![a]![r]!;
          if (Math.abs(jr) < 1e-12) continue;
          d[r + 1] += wc * jr * target;
          for (let c = 0; c < nq; c++) D[r + 1]![c + 1] += wc * jr * Jc[ci]![a]![c]!;
        }
      }
    }
  }
  const eqCols: number[][] = [];
  const eqB: number[] = [];
  for (let r = 0; r < nq; r++) {
    const col = new Array<number>(n).fill(0);
    for (let c = 0; c < nq; c++) col[c] = M[r]![c]!;
    for (let ci = 0; ci < nc; ci++) for (let a = 0; a < 6; a++) col[nq + ci * 6 + a] = -Jc[ci]![a]![r]!;
    if (r >= 6) col[nq + 6 * nc + (r - 6)] = -1;
    eqCols.push(col);
    eqB.push(-(C[r]! + G[r]!));
  }
  if (contactHard) {
    for (let ci = 0; ci < nc; ci++) {
      for (let a = 0; a < 6; a++) {
        const col = new Array<number>(n).fill(0);
        for (let c = 0; c < nq; c++) col[c] = Jc[ci]![a]![c]!;
        eqCols.push(col);
        eqB.push((i.contactAccDes?.[ci]?.[a] ?? 0) - bias[ci]![a]!);
      }
    }
  }

  const ineqCols: number[][] = [];
  const ineqB: number[] = [];
  const add = (coeff: number[], b: number): void => { ineqCols.push(coeff); ineqB.push(b); };
  for (let ci = 0; ci < nc; ci++) {
    const c = i.contacts[ci]!;
    const b = nq + ci * 6;
    const fzMin = c.fzMin ?? 0;
    const mu = c.mu ?? 0.7;
    const hx = c.halfX ?? 0.12;
    const hz = c.halfZ ?? 0.06;
    const row = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void => {
      const col = new Array<number>(n).fill(0);
      col[b] = fx; col[b + 1] = fy; col[b + 2] = fz; col[b + 3] = tx; col[b + 4] = ty; col[b + 5] = tz;
      add(col, 0);
    };
    const one = new Array<number>(n).fill(0); one[b + 1] = 1; add(one, fzMin);
    row(-1, mu, 0, 0, 0, 0); row(1, mu, 0, 0, 0, 0);
    row(0, mu, -1, 0, 0, 0); row(0, mu, 1, 0, 0, 0);
    row(0, hz, 0, -1, 0, 0); row(0, hz, 0, 1, 0, 0);
    row(0, hx, 0, 0, 0, -1); row(0, hx, 0, 0, 0, 1);
  }
  for (let j = 0; j < nd; j++) {
    const d0 = dofs[j]!;
    const idx = nq + 6 * nc + j;
    const lo = new Array<number>(n).fill(0); lo[idx] = 1; add(lo, -Math.abs(d0.tauMax));
    const hi = new Array<number>(n).fill(0); hi[idx] = -1; add(hi, -Math.abs(d0.tauMax));
  }

  const Amat: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(eqCols.length + ineqCols.length + 1).fill(0));
  const bvec: number[] = [0];
  const all = [...eqCols, ...ineqCols];
  for (let k = 0; k < all.length; k++) {
    for (let r = 0; r < n; r++) Amat[r + 1]![k + 1] = all[k]![r]!;
    bvec.push(eqB[k] ?? ineqB[k - eqCols.length] ?? 0);
  }
  const qp = solveQP(D, d, Amat, bvec, eqCols.length);
  if (qp.message) return { tau: [], qdd: [], W: [], feasible: false, message: qp.message, baseResidual: [], contactResidual: [] };
  const qdd = qp.solution.slice(1, nq + 1);
  const W = qp.solution.slice(nq + 1, nq + 6 * nc + 1);
  const tau = qp.solution.slice(nq + 6 * nc + 1, n + 1);
  const dynRes = new Array<number>(nq).fill(0);
  for (let r = 0; r < nq; r++) {
    let s = C[r]! + G[r]!;
    for (let c = 0; c < nq; c++) s += M[r]![c]! * qdd[c]!;
    for (let ci = 0; ci < nc; ci++) for (let a = 0; a < 6; a++) s -= Jc[ci]![a]![r]! * W[ci * 6 + a]!;
    if (r >= 6) s -= tau[r - 6]!;
    dynRes[r] = s;
  }
  const contactResidual = new Array<number>(6 * nc).fill(0);
  for (let ci = 0; ci < nc; ci++) for (let a = 0; a < 6; a++) {
    let s = bias[ci]![a]! - (i.contactAccDes?.[ci]?.[a] ?? 0);
    for (let c = 0; c < nq; c++) s += Jc[ci]![a]![c]! * qdd[c]!;
    contactResidual[ci * 6 + a] = s;
  }
  return { tau, qdd, W, feasible: true, message: '', baseResidual: dynRes.slice(0, 6), contactResidual };
}
