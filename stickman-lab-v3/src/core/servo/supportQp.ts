export interface SupportQpFoot {
  active: boolean;
  x: number;
  y: number;
  halfX: number;
  fzRef: number;
  copXRef: number;
  fzMax: number;
  fzMin?: number;
  mu: number;
}

export interface SupportQpInput {
  mass: number;
  gravity: number;
  comX: number;
  comY: number;
  aX: number;
  aY: number;
  lDotZ: number;
  feet: [SupportQpFoot, SupportQpFoot];
  prevFz?: [number, number];
  weights?: { fz?: number; fx?: number; tau?: number; rate?: number };
}

export interface SupportQpOutput {
  feasible: boolean;
  fz: [number, number];
  fx: [number, number];
  tauZ: [number, number];
  copX: [number, number];
  totalFz: number;
  totalFx: number;
  totalMz: number;
  momentSlack: number;
  momentResidual: number;
}

const N = 7;
const M = 3;
const EPS = 1e-9;
const FEAS_TOL = 1e-5;

function zeros(n: number, m: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0));
}

function solveLinear(mat: number[][], rhs: number[]): number[] | null {
  const n = mat.length;
  const a = mat.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![col]!) < EPS) return null;
    if (pivot !== col) {
      const t = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = t;
    }
    const p = a[col]![col]!;
    for (let c = col; c <= n; c++) a[col]![c]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let c = col; c <= n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row[n]!);
}

function invert(mat: number[][]): number[][] | null {
  const n = mat.length;
  const a = mat.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-9) return null;
    if (pivot !== col) {
      const t = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = t;
    }
    const p = a[col]![col]!;
    for (let c = 0; c < 2 * n; c++) a[col]![c]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (Math.abs(f) < 1e-14) continue;
      for (let c = 0; c < 2 * n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row.slice(n));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function feasible(x: number[], C: number[][], d: number[]): boolean {
  for (let i = 0; i < C.length; i++) {
    if (dot(C[i]!, x) > d[i]! + FEAS_TOL * Math.max(1, Math.abs(d[i]!))) return false;
  }
  return true;
}

function equalityOk(x: number[], A: number[][], b: number[]): boolean {
  for (let i = 0; i < A.length; i++) {
    if (Math.abs(dot(A[i]!, x) - b[i]!) > FEAS_TOL * Math.max(1, Math.abs(b[i]!))) return false;
  }
  return true;
}

interface Reduced {
  x0: number[];
  Z: number[][];
}

function reduceEquality(A: number[][], b: number[]): Reduced | null {
  const m = A.length;
  const n = A[0]!.length;
  const AAT = zeros(m, m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) AAT[i]![j] = dot(A[i]!, A[j]!);
  }
  const lambda = solveLinear(AAT, b);
  if (!lambda) return null;
  const x0 = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) x0[j]! += A[i]![j]! * lambda[i]!;
  }
  const q: number[][] = [];
  for (const row of A) {
    let v = [...row];
    for (const qv of q) {
      const s = dot(v, qv);
      v = v.map((val, i) => val - s * qv[i]!);
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > 1e-9) q.push(v.map((val) => val / norm));
  }
  if (q.length < m) return null;
  const Z: number[][] = [];
  for (let i = 0; i < n; i++) {
    let v = new Array<number>(n).fill(0);
    v[i] = 1;
    for (const qv of q) {
      const s = dot(v, qv);
      v = v.map((val, j) => val - s * qv[j]!);
    }
    for (const zv of Z) {
      const s = dot(v, zv);
      v = v.map((val, j) => val - s * zv[j]!);
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > 1e-8) {
      Z.push(v.map((val) => val / norm));
      if (Z.length === n - q.length) break;
    }
  }
  if (Z.length !== n - q.length) return null;
  return { x0, Z };
}

function hildreth(
  Hz: number[][], gz: number[], Cz: number[][], dz: number[],
): { z: number[]; ok: boolean } {
  const n = Hz.length;
  const Hinv = invert(Hz);
  if (!Hinv) return { z: new Array<number>(n).fill(0), ok: false };
  const k = Cz.length;
  const Q = zeros(k, k);
  const p = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) s += Cz[i]![a]! * Hinv[a]![b]! * Cz[j]![b]!;
      }
      Q[i]![j] = s;
    }
    let s = dz[i]!;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) s += Cz[i]![a]! * Hinv[a]![b]! * gz[b]!;
    }
    p[i] = s;
  }
  const lambda = new Array<number>(k).fill(0);
  for (let iter = 0; iter < 80; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < k; i++) {
      const qii = Q[i]![i]!;
      if (qii < 1e-12) continue;
      let sum = p[i]!;
      for (let j = 0; j < k; j++) {
        if (j !== i) sum += Q[i]![j]! * lambda[j]!;
      }
      const next = Math.max(0, -sum / qii);
      maxDelta = Math.max(maxDelta, Math.abs(next - lambda[i]!));
      lambda[i] = next;
    }
    if (maxDelta < 1e-6) break;
  }
  const rhs = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    rhs[a] = gz[a]!;
    for (let i = 0; i < k; i++) rhs[a]! += Cz[i]![a]! * lambda[i]!;
  }
  const z = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) z[a]! -= Hinv[a]![b]! * rhs[b]!;
  }
  return { z, ok: true };
}

export function solveSupportQp(input: SupportQpInput): SupportQpOutput {
  const fzRef: [number, number] = [Math.max(0, input.feet[0].fzRef), Math.max(0, input.feet[1].fzRef)];
  const copRef: [number, number] = [
    Math.max(input.feet[0].x - input.feet[0].halfX, Math.min(input.feet[0].x + input.feet[0].halfX, input.feet[0].copXRef)),
    Math.max(input.feet[1].x - input.feet[1].halfX, Math.min(input.feet[1].x + input.feet[1].halfX, input.feet[1].copXRef)),
  ];
  const tauRef: [number, number] = [
    (copRef[0] - input.feet[0].x) * fzRef[0],
    (copRef[1] - input.feet[1].x) * fzRef[1],
  ];
  const xRef = [fzRef[0], 0, tauRef[0], fzRef[1], 0, tauRef[1], 0];
  const wFz = Math.max(1e-6, input.weights?.fz ?? 1);
  const wFx = Math.max(1e-6, input.weights?.fx ?? 0.2);
  const wTau = Math.max(1e-6, input.weights?.tau ?? 0.01);
  const wRate = Math.max(0, input.weights?.rate ?? 0);
  const wSlack = Math.max(1, input.weights?.fz ?? 1) * 1e4;
  const H = zeros(N, N);
  const g = new Array<number>(N).fill(0);
  for (let i = 0; i < 2; i++) {
    const base = 3 * i;
    H[base]![base] = wFz;
    g[base] = -wFz * xRef[base]!;
    H[base + 1]![base + 1] = wFx;
    H[base + 2]![base + 2] = wTau;
    g[base + 2] = -wTau * xRef[base + 2]!;
    const prev = input.prevFz?.[i];
    if (wRate > 0 && prev !== undefined && Number.isFinite(prev)) {
      H[base]![base] += wRate;
      g[base] += -wRate * prev;
    }
  }
  H[6]![6] = wSlack;

  const A: number[][] = [
    [1, 0, 0, 1, 0, 0, 0],
    [0, 1, 0, 0, 1, 0, 0],
    [
      input.feet[0].x - input.comX,
      -(input.feet[0].y - input.comY),
      1,
      input.feet[1].x - input.comX,
      -(input.feet[1].y - input.comY),
      1,
      1,
    ],
  ];
  const b: number[] = [
    Math.max(0, input.mass * (input.gravity + input.aY)),
    input.mass * input.aX,
    input.lDotZ,
  ];

  const C: number[][] = [];
  const d: number[] = [];
  const add = (coeff: number[], rhs: number): void => {
    while (coeff.length < N) coeff.push(0);
    coeff.length = N;
    C.push(coeff);
    d.push(rhs);
  };
  for (let i = 0; i < 2; i++) {
    const base = 3 * i;
    const foot = input.feet[i]!;
    const fzMax = foot.active ? Math.max(0, foot.fzMax) : 0;
    const fzMin = foot.active ? Math.max(0, Math.min(fzMax, foot.fzMin ?? 0)) : 0;
    const mu = Math.max(0, foot.mu);
    const halfX = Math.max(0, foot.halfX);
    const lower = new Array<number>(N).fill(0);
    lower[base] = -1;
    add(lower, -fzMin);
    const upper = new Array<number>(N).fill(0);
    upper[base] = 1;
    add(upper, fzMax);
    const fxPos = new Array<number>(N).fill(0);
    fxPos[base] = -mu;
    fxPos[base + 1] = 1;
    add(fxPos, 0);
    const fxNeg = new Array<number>(N).fill(0);
    fxNeg[base] = -mu;
    fxNeg[base + 1] = -1;
    add(fxNeg, 0);
    const tauPos = new Array<number>(N).fill(0);
    tauPos[base] = -halfX;
    tauPos[base + 2] = 1;
    add(tauPos, 0);
    const tauNeg = new Array<number>(N).fill(0);
    tauNeg[base] = -halfX;
    tauNeg[base + 2] = -1;
    add(tauNeg, 0);
  }

  const reduced = reduceEquality(A, b);
  let x = new Array<number>(N).fill(0);
  let feasibleOut = false;
  if (reduced) {
    const { x0, Z } = reduced;
    const nz = Z.length;
    const Hz = zeros(nz, nz);
    const gz = new Array<number>(nz).fill(0);
    const Cz = zeros(C.length, nz);
    const dz = new Array<number>(C.length).fill(0);
    const Hx0g = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      let s = g[i]!;
      for (let j = 0; j < N; j++) s += H[i]![j]! * x0[j]!;
      Hx0g[i] = s;
    }
    for (let a = 0; a < nz; a++) {
      for (let b = 0; b < nz; b++) {
        let s = 0;
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) s += Z[a]![i]! * H[i]![j]! * Z[b]![j]!;
        }
        Hz[a]![b] = s;
      }
      let s = 0;
      for (let i = 0; i < N; i++) s += Z[a]![i]! * Hx0g[i]!;
      gz[a] = s;
    }
    for (let c = 0; c < C.length; c++) {
      for (let a = 0; a < nz; a++) {
        let s = 0;
        for (let i = 0; i < N; i++) s += C[c]![i]! * Z[a]![i]!;
        Cz[c]![a] = s;
      }
      let s = d[c]!;
      for (let i = 0; i < N; i++) s -= C[c]![i]! * x0[i]!;
      dz[c] = s;
    }
    const sol = hildreth(Hz, gz, Cz, dz);
    if (sol.ok) {
      x = [...x0];
      for (let a = 0; a < nz; a++) {
        for (let i = 0; i < N; i++) x[i]! += Z[a]![i]! * sol.z[a]!;
      }
      feasibleOut = feasible(x, C, d) && equalityOk(x, A, b);
    }
  }
  if (!feasibleOut) {
    if (!reduced) {
      const AAT = zeros(M, M);
      for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) AAT[i]![j] = dot(A[i]!, A[j]!);
      const lambda = solveLinear(AAT, b);
      if (lambda) {
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < M; i++) x[j]! += A[i]![j]! * lambda[i]!;
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const base = 3 * i;
      const foot = input.feet[i]!;
      const fzMax = foot.active ? Math.max(0, foot.fzMax) : 0;
      const fzMin = foot.active ? Math.max(0, Math.min(fzMax, foot.fzMin ?? 0)) : 0;
      const fz = Math.max(fzMin, Math.min(fzMax, x[base]!));
      const fxLim = foot.active ? foot.mu * fz : 0;
      const tauLim = foot.active ? foot.halfX * fz : 0;
      x[base] = fz;
      x[base + 1] = Math.max(-fxLim, Math.min(fxLim, x[base + 1]!));
      x[base + 2] = Math.max(-tauLim, Math.min(tauLim, x[base + 2]!));
    }
    feasibleOut = feasible(x, C, d) && equalityOk(x, A, b);
  }

  const fz: [number, number] = [Math.max(0, x[0]!), Math.max(0, x[3]!)];
  const fx: [number, number] = [x[1]!, x[4]!];
  const tauZ: [number, number] = [x[2]!, x[5]!];
  const copX: [number, number] = [
    fz[0] > 1e-6 ? input.feet[0].x + tauZ[0] / fz[0] : input.feet[0].x,
    fz[1] > 1e-6 ? input.feet[1].x + tauZ[1] / fz[1] : input.feet[1].x,
  ];
  const totalMz =
    (input.feet[0].x - input.comX) * fz[0] -
    (input.feet[0].y - input.comY) * fx[0] + tauZ[0] +
    (input.feet[1].x - input.comX) * fz[1] -
    (input.feet[1].y - input.comY) * fx[1] + tauZ[1];
  const momentSlack = x[6]!;
  return {
    feasible: feasibleOut,
    fz,
    fx,
    tauZ,
    copX,
    totalFz: fz[0] + fz[1],
    totalFx: fx[0] + fx[1],
    totalMz,
    momentSlack,
    momentResidual: totalMz + momentSlack - input.lDotZ,
  };
}
