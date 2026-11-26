import { solveQP } from 'quadprog';

export interface WrenchQpFoot {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  halfX: number;
  halfZ: number;
  mu: number;
  fzMin: number;
}

export interface WrenchQpInput {
  feet: WrenchQpFoot[];
  baseA: number[][];
  baseB: number[];
  iters?: number;
  weights?: number[];
  ankleWeight?: number;
  pressureWeight?: number;
  pressureRatio?: number;
  baseWeight?: number;
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

function projectFoot(w: number[], f: WrenchQpFoot, base: number): void {
  const fz = Math.max(f.fzMin, w[base + 1]!);
  const mu = Math.max(0, f.mu);
  const hx = Math.max(0.005, f.halfX);
  const hz = Math.max(0.005, f.halfZ);
  w[base] = Math.max(-mu * fz, Math.min(mu * fz, w[base]!));
  w[base + 1] = fz;
  w[base + 2] = Math.max(-mu * fz, Math.min(mu * fz, w[base + 2]!));
  w[base + 3] = Math.max(-hz * fz, Math.min(hz * fz, w[base + 3]!));
  w[base + 4] = w[base + 4]!;
  w[base + 5] = Math.max(-hx * fz, Math.min(hx * fz, w[base + 5]!));
}

export function solveSupportWrenchQp(i: WrenchQpInput): number[] {
  const n = i.feet.length * 6;
  const w = new Array<number>(n).fill(0);
  for (let fi = 0; fi < i.feet.length; fi++) {
    const f = i.feet[fi]!;
    w[fi * 6] = f.fx; w[fi * 6 + 1] = f.fy; w[fi * 6 + 2] = f.fz;
    w[fi * 6 + 3] = f.tx; w[fi * 6 + 4] = f.ty; w[fi * 6 + 5] = f.tz;
    projectFoot(w, f, fi * 6);
  }
  const A = i.baseA;
  if (A.length !== 6 || A[0]?.length !== n) return w;
  const weights = i.weights ?? new Array<number>(n).fill(1);
  const Dmat: number[][] = Array.from({ length: n + 1 }, (_, ri) => new Array<number>(n + 1).fill(0));
  const dvec: number[] = new Array<number>(n + 1).fill(0);
  for (let k = 0; k < n; k++) {
    const wt = Math.max(1e-3, weights[k] ?? 1);
    Dmat[k + 1]![k + 1] = wt;
    dvec[k + 1] = wt * w[k]!;
  }
  const baseW = Math.max(0, i.baseWeight ?? 0);
  if (baseW > 0) {
    for (let r = 0; r < 6; r++) {
      const ar = A[r] ?? [];
      const br = i.baseB[r] ?? 0;
      for (let a = 0; a < n; a++) {
        dvec[a + 1] += baseW * ar[a]! * br;
        for (let c = 0; c < n; c++) Dmat[a + 1]![c + 1] += baseW * ar[a]! * ar[c]!;
      }
    }
  }
  const ankleW = Math.max(0, i.ankleWeight ?? 0);
  if (ankleW > 0) {
    for (let fi = 0; fi < i.feet.length; fi++) {
      const b = fi * 6;
      Dmat[b + 4]![b + 4] += ankleW * 0.25;
      Dmat[b + 6]![b + 6] += ankleW;
    }
  }
  const pressureW = Math.max(0, i.pressureWeight ?? 0);
  if (pressureW > 0 && i.feet.length >= 2) {
    const rho = Math.max(0, Math.min(1, i.pressureRatio ?? 0.5));
    const a = 1 - rho, b = rho;
    Dmat[2]![2] += pressureW * a * a;
    Dmat[8]![8] += pressureW * b * b;
    Dmat[2]![8] -= pressureW * a * b;
    Dmat[8]![2] -= pressureW * a * b;
  }
  const cols: number[][] = [];
  const bvec: number[] = [0];
  if (baseW === 0) {
    for (let r = 0; r < 6; r++) {
      cols.push((A[r] ?? new Array<number>(n).fill(0)));
      bvec.push(i.baseB[r] ?? 0);
    }
  }
  for (let fi = 0; fi < i.feet.length; fi++) {
    const f = i.feet[fi]!;
    const b = fi * 6;
    const row = (coeff: [number, number, number, number, number, number]): void => {
      const col = new Array<number>(n).fill(0);
      for (let r = 0; r < 6; r++) col[b + r] = coeff[r]!;
      cols.push(col);
    };
    row([0, 1, 0, 0, 0, 0]); bvec.push(f.fzMin);
    row([-1, f.mu, 0, 0, 0, 0]); bvec.push(0);
    row([1, f.mu, 0, 0, 0, 0]); bvec.push(0);
    row([0, f.mu, -1, 0, 0, 0]); bvec.push(0);
    row([0, f.mu, 1, 0, 0, 0]); bvec.push(0);
    row([0, f.halfZ, 0, -1, 0, 0]); bvec.push(0);
    row([0, f.halfZ, 0, 1, 0, 0]); bvec.push(0);
    row([0, f.halfX, 0, 0, 0, -1]); bvec.push(0);
    row([0, f.halfX, 0, 0, 0, 1]); bvec.push(0);
  }
  const Amat: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(cols.length + 1).fill(0));
  for (let k = 0; k < cols.length; k++) for (let r = 0; r < n; r++) Amat[r + 1]![k + 1] = cols[k]![r]!;
  const qp = solveQP(Dmat, dvec, Amat, bvec, baseW === 0 ? 6 : 0);
  if (!qp.message) {
    for (let k = 0; k < n; k++) w[k] = qp.solution[k + 1]!;
    return w;
  }
  const At = Array.from({ length: n }, (_, k) => Array.from({ length: 6 }, (_, r) => (A[r]![k] ?? 0) / Math.max(1e-3, weights[k] ?? 1)));
  const G = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += A[r]![k]! * At[k]![c]!;
    return s + (r === c ? 1e-6 : 0);
  }));
  const iters = Math.max(1, i.iters ?? 8);
  for (let it = 0; it < iters; it++) {
    const res = new Array<number>(6).fill(0);
    for (let r = 0; r < 6; r++) {
      let s = i.baseB[r] ?? 0;
      for (let k = 0; k < n; k++) s -= A[r]![k]! * w[k]!;
      res[r] = s;
    }
    const y = solve6(G, res);
    if (!y) break;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let r = 0; r < 6; r++) s += At[k]![r]! * y[r]!;
      w[k]! += s;
    }
    for (let fi = 0; fi < i.feet.length; fi++) projectFoot(w, i.feet[fi]!, fi * 6);
  }
  return w;
}
