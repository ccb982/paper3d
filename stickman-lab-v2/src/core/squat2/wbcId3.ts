/**
 * wbcId3.ts —— 论文 ID-WBC 的最小忠实简化
 *
 * base 6 + 左右 hip2/knee2/foot2 = 12 个 q̈
 * τ = 6，fL/fR = 12
 *
 * 约束：降维完整动力学 + 6D 接触 + CWC/摩擦/CoP + τ/q̈ 限制
 * 任务：posture + CoM + base + CoP
 */
import type { FloatingModel } from './floatingModel';
import { quatError } from './floatingModel';
import { solveQP } from 'quadprog';

const NB = 6;
const NJ = 6;
const NQ = NB + NJ;
const NT = 6;
const NF = 12;
const NX = NQ + NT + NF;
const I_T = NQ;
const I_F = I_T + NT;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface WbcId3Input {
  model: FloatingModel;
  /** 6 个 active 关节在 24 维模型中的索引：left hip2/knee2/foot2, right ... */
  active: number[];
  qActive: number[];
  qdActive: number[];
  qTargetActive: number[];
  tauMin: number[];
  tauMax: number[];
  com: [number, number, number];
  comVel: [number, number, number];
  comTarget: [number, number, number];
  comKp: number;
  comKd: number;
  baseTarget: Parameters<typeof quatError>[0];
  baseKp: number;
  baseKd: number;
  postureKp: number;
  postureKd: number;
  mu: number;
  qddCap: number;
  copTargets?: [number, number][];
  wCom: number;
  wBase: number;
  wPost: number;
  wTau: number;
  wForce: number;
  wQdd: number;
  wCop: number;
}

export interface WbcId3Output {
  ok: boolean;
  tau: Float64Array;
  fL: Float64Array;
  fR: Float64Array;
  qdd: Float64Array;
  eqViol: number;
  maxViol: number;
  tauMax: number;
  qddMax: number;
  iterations: number;
}

export function solveWbcId3(i: WbcId3Input): WbcId3Output {
  const m = i.model;
  const A = [0, 1, 2, 3, 4, 5, ...i.active];
  if (A.length !== NQ) throw new Error(`wbcId3 active ${i.active.length} != ${NJ}`);

  const Mr = new Float64Array(NQ * NQ);
  const hr = new Float64Array(NQ);
  for (let r = 0; r < NQ; r++) {
    hr[r] = m.h[A[r]!]!;
    for (let c = 0; c < NQ; c++) Mr[r * NQ + c] = m.M[A[r]! * 24 + A[c]!]!;
  }

  const JcomR = new Float64Array(3 * NQ);
  for (let c = 0; c < NQ; c++) {
    const col = A[c]!;
    JcomR[0 * NQ + c] = m.Jcom[col]!;
    JcomR[1 * NQ + c] = m.Jcom[2 * 24 + col]!;
    JcomR[2 * NQ + c] = m.Jcom[24 + col]!;
  }

  const JbaseR = new Float64Array(3 * NQ);
  for (let c = 0; c < NQ; c++) {
    const col = A[c]!;
    JbaseR[0 * NQ + c] = m.Jbase[col]!;
    JbaseR[1 * NQ + c] = m.Jbase[24 + col]!;
    JbaseR[2 * NQ + c] = m.Jbase[2 * 24 + col]!;
  }

  const JcR: Float64Array[] = [];
  const Jd: Float64Array[] = [];
  for (let foot = 0; foot < 2; foot++) {
    const Jr = new Float64Array(6 * NQ);
    for (let r = 0; r < 6; r++) for (let c = 0; c < NQ; c++) Jr[r * NQ + c] = m.Jc[foot]![r * 24 + A[c]!]!;
    JcR.push(Jr);
    Jd.push(m.JdotNu[foot]!);
  }

  const P = new Float64Array(NX * NX);
  const g = new Float64Array(NX);
  const addTask = (J: Float64Array, rows: number, target: number[], weight: number): void => {
    for (let r = 0; r < rows; r++) {
      for (let a = 0; a < NX; a++) {
        const ja = J[a * rows + r] ?? 0;
        if (ja === 0) continue;
        g[a] += -2 * weight * ja * target[r]!;
        for (let b = 0; b < NX; b++) {
          const jb = J[b * rows + r] ?? 0;
          if (jb !== 0) P[a * NX + b] += 2 * weight * ja * jb;
        }
      }
    }
  };

  const aCom: [number, number, number] = [
    i.comKp * (i.comTarget[0] - i.com[0]) - i.comKd * i.comVel[0] - m.JdotComNu[0]!,
    i.comKp * (i.comTarget[1] - i.com[1]) - i.comKd * i.comVel[1] - m.JdotComNu[2]!,
    i.comKp * (i.comTarget[2] - i.com[2]) - i.comKd * i.comVel[2] - m.JdotComNu[1]!,
  ];
  const JcomQ = new Float64Array(NX * 3);
  for (let a = 0; a < NQ; a++) for (let r = 0; r < 3; r++) JcomQ[a * 3 + r] = JcomR[r * NQ + a]!;
  addTask(JcomQ, 3, aCom, i.wCom);

  const rErr = quatError(i.baseTarget, m.baseQuat);
  const aBase: [number, number, number] = [
    i.baseKp * rErr.x - i.baseKd * m.baseOmega.x - m.JdotBaseNu[0]!,
    i.baseKp * rErr.y - i.baseKd * m.baseOmega.y - m.JdotBaseNu[1]!,
    i.baseKp * rErr.z - i.baseKd * m.baseOmega.z - m.JdotBaseNu[2]!,
  ];
  const JbaseQ = new Float64Array(NX * 3);
  for (let a = 0; a < NQ; a++) for (let r = 0; r < 3; r++) JbaseQ[a * 3 + r] = JbaseR[r * NQ + a]!;
  addTask(JbaseQ, 3, aBase, i.wBase);

  const qddStar: number[] = [];
  for (let k = 0; k < NJ; k++) qddStar.push(i.postureKp * (i.qTargetActive[k]! - i.qActive[k]!) - i.postureKd * i.qdActive[k]!);
  const Jpost = new Float64Array(NX * NJ);
  for (let k = 0; k < NJ; k++) Jpost[(NB + k) * NJ + k] = 1;
  addTask(Jpost, NJ, qddStar, i.wPost);

  if (i.copTargets && i.wCop > 0) {
    const Jcop = new Float64Array(NX * 4);
    const target = [0, 0, 0, 0];
    for (let foot = 0; foot < 2; foot++) {
      const o = I_F + foot * 6;
      const p = m.contact[foot]!.point;
      const ct = i.copTargets[foot]!;
      const tx = ct ? ct[0] : p.x;
      const tz = ct ? ct[1] : p.z;
      const fx = o + 1, mx = o + 3, mz = o + 5;
      Jcop[mz * 4 + foot * 2] = 1;
      Jcop[fx * 4 + foot * 2] = -(p.x - tx);
      Jcop[mx * 4 + foot * 2 + 1] = 1;
      Jcop[fx * 4 + foot * 2 + 1] = -(tz - p.z);
    }
    addTask(Jcop, 4, target, i.wCop);
  }

  for (let a = 0; a < NQ; a++) P[a * NX + a] += 2 * i.wQdd;
  for (let a = I_T; a < I_T + NT; a++) P[a * NX + a] += 2 * i.wTau;
  for (let a = I_F; a < I_F + NF; a++) P[a * NX + a] += 2 * i.wForce;
  for (let a = 0; a < NX; a++) P[a * NX + a] += 1e-8;

  const Aeq: number[][] = [];
  const beq: number[] = [];
  for (let r = 0; r < NQ; r++) {
    const row = new Array<number>(NX).fill(0);
    for (let c = 0; c < NQ; c++) row[c] = Mr[r * NQ + c]!;
    for (let s = 0; s < 6; s++) {
      row[I_F + s] = -JcR[0]![s * NQ + r]!;
      row[I_F + 6 + s] = -JcR[1]![s * NQ + r]!;
    }
    if (r >= NB) row[I_T + (r - NB)] = -1;
    Aeq.push(row);
    beq.push(-hr[r]!);
  }
  for (let foot = 0; foot < 2; foot++) {
    for (let r = 0; r < 6; r++) {
      const row = new Array<number>(NX).fill(0);
      for (let c = 0; c < NQ; c++) row[c] = JcR[foot]![r * NQ + c]!;
      Aeq.push(row);
      beq.push(-Jd[foot]![r]!);
    }
  }

  const Aineq: number[][] = [];
  const bineq: number[] = [];
  const add = (row: number[], b: number): void => { Aineq.push(row); bineq.push(b); };

  for (let foot = 0; foot < 2; foot++) {
    const o = I_F + foot * 6;
    const c = m.contact[foot]!;
    const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
    const cf = new Array<number>(NX).fill(0); cf[fy] = -1; add(cf, 0);
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const row = new Array<number>(NX).fill(0);
      row[fx] = Math.cos(th); row[fz] = Math.sin(th); row[fy] = -i.mu;
      add(row, 0);
    }
    const my1 = new Array<number>(NX).fill(0); my1[my] = 1; my1[fy] = -0.2; add(my1, 0);
    const my2 = new Array<number>(NX).fill(0); my2[my] = -1; my2[fy] = -0.2; add(my2, 0);
    const rx1 = new Array<number>(NX).fill(0); rx1[fy] = c.point.x - c.maxX; rx1[mz] = -1; add(rx1, 0);
    const rx2 = new Array<number>(NX).fill(0); rx2[fy] = c.minX - c.point.x; rx2[mz] = 1; add(rx2, 0);
    const rz1 = new Array<number>(NX).fill(0); rz1[fy] = c.point.z - c.maxZ; rz1[mx] = 1; add(rz1, 0);
    const rz2 = new Array<number>(NX).fill(0); rz2[fy] = c.minZ - c.point.z; rz2[mx] = -1; add(rz2, 0);
    const fmax = new Array<number>(NX).fill(0); fmax[fy] = 1; add(fmax, 3 * m.mass * 9.81);
  }

  for (let k = 0; k < NT; k++) {
    const lo = new Array<number>(NX).fill(0); lo[I_T + k] = -1; add(lo, -i.tauMin[k]!);
    const hi = new Array<number>(NX).fill(0); hi[I_T + k] = 1; add(hi, i.tauMax[k]!);
  }

  for (let a = 0; a < NQ; a++) {
    const lim = a < NB ? 200 : i.qddCap;
    const lo = new Array<number>(NX).fill(0); lo[a] = -1; add(lo, -lim);
    const hi = new Array<number>(NX).fill(0); hi[a] = 1; add(hi, lim);
  }
  for (let a = I_F; a < I_F + NF; a++) {
    const lo = new Array<number>(NX).fill(0); lo[a] = -1; add(lo, -5000);
    const hi = new Array<number>(NX).fill(0); hi[a] = 1; add(hi, 5000);
  }

  const q = Aeq.length + Aineq.length;
  const Dmat: number[][] = Array.from({ length: NX + 1 }, () => new Array<number>(NX + 1).fill(0));
  const dvec: number[] = new Array<number>(NX + 1).fill(0);
  for (let a = 1; a <= NX; a++) {
    dvec[a] = -g[a - 1]!;
    for (let b = 1; b <= NX; b++) Dmat[a]![b] = P[(a - 1) * NX + (b - 1)]!;
    Dmat[a]![a] += 1e-8;
  }
  const Amat: number[][] = Array.from({ length: NX + 1 }, () => new Array<number>(q + 1).fill(0));
  const bvec: number[] = new Array<number>(q + 1).fill(0);
  for (let j = 1; j <= Aeq.length; j++) {
    const row = Aeq[j - 1]!;
    bvec[j] = beq[j - 1]!;
    for (let a = 1; a <= NX; a++) Amat[a]![j] = row[a - 1]!;
  }
  for (let j = 1; j <= Aineq.length; j++) {
    const row = Aineq[j - 1]!;
    bvec[Aeq.length + j] = -bineq[j - 1]!;
    for (let a = 1; a <= NX; a++) Amat[a]![Aeq.length + j] = -row[a - 1]!;
  }

  const res = solveQP(Dmat, dvec, Amat, bvec, Aeq.length);
  if (res.message) {
    return { ok: false, tau: new Float64Array(6), fL: new Float64Array(6), fR: new Float64Array(6), qdd: new Float64Array(NQ), eqViol: Infinity, maxViol: Infinity, tauMax: Infinity, qddMax: Infinity, iterations: 0 };
  }
  const sol = res.solution!;
  const x = new Float64Array(NX);
  for (let a = 1; a <= NX; a++) x[a - 1] = sol[a]!;

  let maxViol = 0;
  for (let j = 0; j < Aineq.length; j++) {
    let v = 0;
    const row = Aineq[j]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    maxViol = Math.max(maxViol, v - bineq[j]!);
  }
  let eqViol = 0;
  for (let r = 0; r < Aeq.length; r++) {
    let v = 0;
    const row = Aeq[r]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    eqViol = Math.max(eqViol, Math.abs(v - beq[r]!));
  }
  const tau = x.slice(I_T, I_T + NT);
  const fL = x.slice(I_F, I_F + 6);
  const fR = x.slice(I_F + 6, I_F + 12);
  const qdd = x.slice(0, NQ);
  let tauMax = 0, qddMax = 0;
  for (const v of tau) tauMax = Math.max(tauMax, Math.abs(v));
  for (const v of qdd) qddMax = Math.max(qddMax, Math.abs(v));
  const finite = [tau, fL, fR, qdd].every((arr) => Array.from(arr).every((v) => Number.isFinite(v)));
  const ok = finite && eqViol < 1e-3 && maxViol < 1e-3;
  return { ok, tau, fL, fR, qdd, eqViol, maxViol, tauMax, qddMax, iterations: res.iterations?.[1] ?? 0 };
}
