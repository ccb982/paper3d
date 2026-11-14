/**
 * squatQp3.ts —— 简化版 3 关节静态/准静态 QP
 *
 * 变量：τ_hip2, τ_knee2, τ_foot2
 * 任务：posture(q→q_ik) + CoM 力 + CoP
 * 约束：力矩上下限 + CoP 支撑域
 *
 * 这是 reduced/static QP，不含 M(q)·q̈，也不做全身 18/24 维。
 */
import { solveQP } from 'quadprog';

export interface SquatQp3Input {
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  jCom: [number, number][];
  h: [number, number];
  hAnkle: number;
  q: [number, number, number];
  qd: [number, number, number];
  qIk: [number, number, number];
  tauMin: [number, number, number];
  tauMax: [number, number, number];
  kpF: number;
  kdF: number;
  kpPost: number;
  kdPost: number;
  cop: number;
  copTarget: number;
  copMin: number;
  copMax: number;
  fz: number;
  kpCop: number;
  copCap: number;
  wPost: number;
  wCom: number;
  wCop: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveSquatQp3(i: SquatQp3Input): [number, number, number] {
  const fCom: [number, number, number] = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    fCom[r] = i.kpF * (i.comTarget[r]! - i.com[r]!) - i.kdF * i.comVel[r]!;
  }

  const tauPost: [number, number, number] = [
    i.h[0] + i.kpPost * (i.qIk[0] - i.q[0]) - i.kdPost * i.qd[0],
    i.h[1] + i.kpPost * (i.qIk[1] - i.q[1]) - i.kdPost * i.qd[1],
    i.hAnkle + i.kpPost * (i.qIk[2] - i.q[2]) - i.kdPost * i.qd[2],
  ];

  const tauCop = i.hAnkle + i.kpCop * (i.copTarget - i.cop) * i.fz;
  const tLo = i.hAnkle + (i.copMin - i.cop) * i.fz * i.kpCop;
  const tHi = i.hAnkle + (i.copMax - i.cop) * i.fz * i.kpCop;
  const cap = Math.abs(i.copCap);
  const copLo = Math.max(i.tauMin[2], Math.min(tLo, tHi), i.hAnkle - cap);
  const copHi = Math.min(i.tauMax[2], Math.max(tLo, tHi), i.hAnkle + cap);

  const j0 = i.jCom[0]!, j1 = i.jCom[1]!, j2 = i.jCom[2]!;
  const bCom: [number, number, number] = [
    fCom[0] + j0[0] * i.h[0] + j0[1] * i.h[1],
    fCom[1] + j1[0] * i.h[0] + j1[1] * i.h[1],
    fCom[2] + j2[0] * i.h[0] + j2[1] * i.h[1],
  ];

  const A: number[][] = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [j0[0], j0[1], 0], [j1[0], j1[1], 0], [j2[0], j2[1], 0],
    [0, 0, 1],
  ];
  const b = [tauPost[0], tauPost[1], tauPost[2], bCom[0], bCom[1], bCom[2], tauCop];
  const w = [i.wPost, i.wPost, i.wPost, i.wCom, i.wCom, i.wCom, i.wCop];

  const D: number[][] = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  const d: number[] = new Array<number>(4).fill(0);
  for (let r = 0; r < A.length; r++) {
    const row = A[r]!;
    const br = b[r]!;
    const wr = Math.max(0, w[r]!);
    for (let a = 0; a < 3; a++) {
      if (row[a] === 0) continue;
      d[a + 1] += 2 * wr * row[a]! * br;
      for (let c = 0; c < 3; c++) D[a + 1]![c + 1] += 2 * wr * row[a]! * row[c]!;
    }
  }
  for (let a = 1; a <= 3; a++) D[a]![a] += 1e-8;

  const Aineq: number[][] = [];
  const bineq: number[] = [];
  const addIneq = (row: number[], bb: number): void => { Aineq.push(row); bineq.push(bb); };
  for (let a = 0; a < 3; a++) {
    const lo = new Array<number>(4).fill(0); lo[a + 1] = -1; addIneq(lo, -i.tauMin[a]!);
    const hi = new Array<number>(4).fill(0); hi[a + 1] = 1; addIneq(hi, i.tauMax[a]!);
  }
  {
    const lo = new Array<number>(4).fill(0); lo[3] = -1; addIneq(lo, -copLo);
    const hi = new Array<number>(4).fill(0); hi[3] = 1; addIneq(hi, copHi);
  }

  const q = Aineq.length;
  const Dmat: number[][] = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  const dvec: number[] = new Array<number>(4).fill(0);
  for (let a = 1; a <= 3; a++) {
    dvec[a] = -d[a]!;
    for (let c = 1; c <= 3; c++) Dmat[a]![c] = D[a]![c]!;
  }
  const Amat: number[][] = Array.from({ length: 4 }, () => new Array<number>(q + 1).fill(0));
  const bvec: number[] = new Array<number>(q + 1).fill(0);
  for (let j = 1; j <= q; j++) {
    const row = Aineq[j - 1]!;
    bvec[j] = -bineq[j - 1]!;
    for (let a = 1; a <= 3; a++) Amat[a]![j] = -row[a]!;
  }
  const res = solveQP(Dmat, dvec, Amat, bvec, 0);
  const fallback: [number, number, number] = [
    clamp(tauPost[0], i.tauMin[0], i.tauMax[0]),
    clamp(tauPost[1], i.tauMin[1], i.tauMax[1]),
    clamp(tauCop, i.tauMin[2], i.tauMax[2]),
  ];
  if (res.message) return fallback;
  const sol = res.solution!;
  const out: [number, number, number] = [sol[1]!, sol[2]!, sol[3]!];
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(out[a]!)) out[a] = fallback[a]!;
    out[a] = clamp(out[a]!, i.tauMin[a]!, i.tauMax[a]!);
  }
  out[2] = clamp(out[2]!, copLo, copHi);
  return out;
}
