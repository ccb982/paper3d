export interface Squat2QpInput {
  mass: number[][];
  bias: number[];
  jCom: number[][];
  jFootL: number[][];
  jFootR: number[][];
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  bodyMass: number;
  mu: number;
  tauMin: number[];
  tauMax: number[];
  qddMin: number;
  qddMax: number;
  fnMax: number;
  kp?: number;
  kd?: number;
  wCom?: number;
  wTau?: number;
  wForce?: number;
  wBound?: number;
  wQdd?: number;
  iterations?: number;
}

export interface Squat2QpOutput {
  qdd: number[];
  tau: number[];
  fL: [number, number];
  fR: [number, number];
  contactResidual: number;
  cost: number;
  iterations: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function solve4(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, r) => [...row, b[r]!]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let r = k + 1; r < n; r++) if (Math.abs(M[r]![k]!) > Math.abs(M[p]![k]!)) p = r;
    [M[k], M[p]] = [M[p]!, M[k]!];
    const piv = M[k]![k]! || 1e-9;
    for (let c = k; c <= n; c++) M[k]![c] = M[k]![c]! / piv;
    for (let r = 0; r < n; r++) {
      if (r === k) continue;
      const f = M[r]![k]!;
      if (!f) continue;
      for (let c = k; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[k]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

export function solveSquat2Qp(i: Squat2QpInput): Squat2QpOutput {
  const n = i.mass.length;
  const kp = i.kp ?? 8;
  const kd = i.kd ?? 2.5;
  const wCom = i.wCom ?? 100;
  const wTau = i.wTau ?? 0.01;
  const wForce = i.wForce ?? 1;
  const wBound = i.wBound ?? 1000;
  const wQdd = i.wQdd ?? 0.01;
  const iterations = Math.max(1, Math.min(400, i.iterations ?? 160));
  const a = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!);
  const fn0 = Math.max(0, 0.5 * i.bodyMass * 9.81);
  const x = new Array<number>(n + 4).fill(0);
  x[n] = fn0;
  x[n + 2] = fn0;

  const Aeq: number[][] = [];
  for (const J of [i.jFootL, i.jFootR]) {
    for (const row of [0, 1]) {
      const r = new Array<number>(n + 4).fill(0);
      for (let c = 0; c < n; c++) r[c] = J[row]![c]!;
      Aeq.push(r);
    }
  }
  const AAt = Array.from({ length: Aeq.length }, () => new Array<number>(Aeq.length).fill(0));
  for (let r = 0; r < Aeq.length; r++) {
    for (let c = 0; c < Aeq.length; c++) {
      let s = 0;
      for (let k = 0; k < Aeq[r]!.length; k++) s += Aeq[r]![k]! * Aeq[c]![k]!;
      AAt[r]![c] = s + (r === c ? 1e-9 : 0);
    }
  }
  const projectEq = (v: number[]): void => {
    const av = Aeq.map((row) => row.reduce((s, c, k) => s + c * v[k]!, 0));
    const lam = solve4(AAt, av);
    for (let k = 0; k < v.length; k++) {
      let s = 0;
      for (let r = 0; r < Aeq.length; r++) s += Aeq[r]![k]! * lam[r]!;
      v[k] = v[k]! - s;
    }
  };
  const project = (v: number[]): void => {
    for (let k = 0; k < n; k++) v[k] = clamp(v[k]!, i.qddMin, i.qddMax);
    v[n] = clamp(v[n]!, 0, i.fnMax);
    v[n + 2] = clamp(v[n + 2]!, 0, i.fnMax);
    v[n + 1] = clamp(v[n + 1]!, -i.mu * v[n]!, i.mu * v[n]!);
    v[n + 3] = clamp(v[n + 3]!, -i.mu * v[n + 2]!, i.mu * v[n + 2]!);
    projectEq(v);
    v[n] = clamp(v[n]!, 0, i.fnMax);
    v[n + 2] = clamp(v[n + 2]!, 0, i.fnMax);
    v[n + 1] = clamp(v[n + 1]!, -i.mu * v[n]!, i.mu * v[n]!);
    v[n + 3] = clamp(v[n + 3]!, -i.mu * v[n + 2]!, i.mu * v[n + 2]!);
  };

  const computeTau = (v: number[]): number[] => {
    const qdd = v.slice(0, n);
    const fL: [number, number] = [v[n]!, v[n + 1]!];
    const fR: [number, number] = [v[n + 2]!, v[n + 3]!];
    const tau = new Array<number>(n).fill(0);
    for (let r = 0; r < n; r++) {
      let t = i.bias[r]!;
      for (let c = 0; c < n; c++) t += i.mass[r]![c]! * qdd[c]!;
      t -= i.jFootL[0]![r]! * fL[1]! + i.jFootL[1]![r]! * fL[0]!;
      t -= i.jFootR[0]![r]! * fR[1]! + i.jFootR[1]![r]! * fR[0]!;
      tau[r] = t;
    }
    return tau;
  };

  const evalCost = (v: number[]): number => {
    const qdd = v.slice(0, n);
    let cost = wQdd * qdd.reduce((s, q) => s + q * q, 0);
    for (let k = 0; k < 3; k++) {
      let r = -a[k]!;
      for (let c = 0; c < n; c++) r += i.jCom[k]![c]! * qdd[c]!;
      cost += wCom * r * r;
    }
    const tau = computeTau(v);
    for (let r = 0; r < n; r++) {
      cost += wTau * tau[r]! * tau[r]!;
      const over = tau[r]! > i.tauMax[r]! ? tau[r]! - i.tauMax[r]! : tau[r]! < i.tauMin[r]! ? tau[r]! - i.tauMin[r]! : 0;
      cost += wBound * over * over;
    }
    cost += wForce * ((v[n]! - fn0) ** 2 + v[n + 1]! ** 2 + (v[n + 2]! - fn0) ** 2 + v[n + 3]! ** 2);
    const fl = Math.max(0, Math.abs(v[n + 1]!) - i.mu * Math.max(0, v[n]!));
    const fr = Math.max(0, Math.abs(v[n + 3]!) - i.mu * Math.max(0, v[n + 2]!));
    cost += wBound * (fl * fl + fr * fr);
    return cost;
  };

  project(x);
  let cost = evalCost(x);
  const eps = 1e-4;
  for (let it = 0; it < iterations; it++) {
    const g = new Array<number>(x.length);
    for (let k = 0; k < x.length; k++) {
      const old = x[k]!;
      x[k] = old + eps;
      const c1 = evalCost(x);
      x[k] = old - eps;
      const c0 = evalCost(x);
      x[k] = old;
      g[k] = (c1 - c0) / (2 * eps);
    }
    let step = 0.05 / (1 + it * 0.02);
    for (let ls = 0; ls < 20; ls++) {
      const y = x.map((v, k) => v - step * g[k]!);
      project(y);
      const cy = evalCost(y);
      if (cy < cost) {
        for (let k = 0; k < x.length; k++) x[k] = y[k]!;
        cost = cy;
        break;
      }
      step *= 0.5;
    }
  }

  const qdd = x.slice(0, n);
  const fL: [number, number] = [x[n]!, x[n + 1]!];
  const fR: [number, number] = [x[n + 2]!, x[n + 3]!];
  const tau = computeTau(x);
  const contactResidual = Math.max(
    ...Aeq.map((row) => Math.abs(row.reduce((s, c, k) => s + c * x[k]!, 0))),
  );
  return { qdd, tau, fL, fR, contactResidual, cost, iterations };
}
