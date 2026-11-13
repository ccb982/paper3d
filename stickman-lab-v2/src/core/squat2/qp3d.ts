export interface Squat3dInput {
  mass: number[][];
  bias: number[];
  jCom: number[][];
  jFootL: number[][];
  jFootR: number[][];
  axis: number[][];
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  bodyMass: number;
  mu: number;
  tauMin: number[];
  tauMax: number[];
  q: number[];
  qd: number[];
  qTarget: number[];
  qMin: number[];
  qMax: number[];
  dt: number;
  footXL: number; footXR: number; footZL: number; footZR: number;
  copMinXL: number; copMaxXL: number; copMinZL: number; copMaxZL: number;
  copMinXR: number; copMaxXR: number; copMinZR: number; copMaxZR: number;
  kp?: number; kd?: number;
  wCom?: number; wTau?: number; wForce?: number; wQdd?: number; wPosture?: number;
  iterations?: number;
}

export interface Squat3dOutput {
  qdd: number[];
  tau: number[];
  fL: number[];
  fR: number[];
  cost: number;
  maxViolation: number;
  iterations: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveSquat3d(i: Squat3dInput): Squat3dOutput {
  const n = i.mass.length;
  const nv = n + 12;
  const fL = n, fR = n + 6;
  const kp = i.kp ?? 8, kd = i.kd ?? 2.5;
  const wCom = i.wCom ?? 100, wTau = i.wTau ?? 0.01, wForce = i.wForce ?? 1, wQdd = i.wQdd ?? 0.01, wPost = i.wPosture ?? 100;
  const maxIt = Math.max(1, Math.min(300, i.iterations ?? 120));
  const a = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!);
  const fn0 = 0.5 * i.bodyMass * 9.81;
  const x = new Array<number>(nv).fill(0);
  x[fL + 2] = fn0; x[fR + 2] = fn0;
  const tauOf = (v: number[]): number[] => {
    const out = new Array<number>(n).fill(0);
    for (let r = 0; r < n; r++) {
      let t = i.bias[r]!;
      for (let c = 0; c < n; c++) t += i.mass[r]![c]! * v[c]!;
      t -= i.jFootL[0]![r]! * v[fL]! + i.jFootL[1]![r]! * v[fL + 1]! + i.jFootL[2]![r]! * v[fL + 2]!;
      t -= i.jFootR[0]![r]! * v[fR]! + i.jFootR[1]![r]! * v[fR + 1]! + i.jFootR[2]![r]! * v[fR + 2]!;
      t -= i.axis[r]![0]! * (v[fL + 3]! + v[fR + 3]!) + i.axis[r]![1]! * (v[fL + 4]! + v[fR + 4]!) + i.axis[r]![2]! * (v[fL + 5]! + v[fR + 5]!);
      out[r] = t;
    }
    return out;
  };
  const cost = (v: number[]): number => {
    let c = wQdd * v.slice(0, n).reduce((s, q) => s + q * q, 0);
    for (let k = 0; k < 3; k++) {
      let r = -a[k]!;
      for (let j = 0; j < n; j++) r += i.jCom[k]![j]! * v[j]!;
      c += wCom * r * r;
    }
    for (let k = 0; k < n; k++) {
      const qs = kp * (i.qTarget[k]! - i.q[k]!) - kd * i.qd[k]!;
      c += wPost * (v[k]! - qs) ** 2;
    }
    const tau = tauOf(v);
    for (let r = 0; r < n; r++) c += wTau * tau[r]! * tau[r]!;
    for (const off of [fL, fR]) {
      c += wForce * ((v[off]! ** 2 + v[off + 1]! ** 2 + (v[off + 2]! - fn0) ** 2 + v[off + 3]! ** 2 + v[off + 4]! ** 2 + v[off + 5]! ** 2));
    }
    return c;
  };
  const violation = (v: number[]): number => {
    let c = 0;
    for (const [J, off] of [[i.jFootL, fL], [i.jFootR, fR]] as const) {
      for (let r = 0; r < 3; r++) {
        let q = 0; for (let k = 0; k < n; k++) q += J[r]![k]! * v[k]!;
        c += q * q;
      }
      const fz = v[off + 2]!;
      if (fz < 0) c += fz * fz;
      for (const s of [1, -1]) {
        const fx = s * v[off]! - i.mu * fz;
        const fy = s * v[off + 1]! - i.mu * fz;
        if (fx > 0) c += fx * fx;
        if (fy > 0) c += fy * fy;
      }
    }
    const sumFz = v[fL + 2]! + v[fR + 2]! - 0.9 * i.bodyMass * 9.81;
    c += sumFz * sumFz;
    const tau = tauOf(v);
    for (let r = 0; r < n; r++) {
      const over = tau[r]! > i.tauMax[r]! ? tau[r]! - i.tauMax[r]! : tau[r]! < i.tauMin[r]! ? tau[r]! - i.tauMin[r]! : 0;
      if (over !== 0) c += over * over;
      const h2 = 0.5 * i.dt * i.dt;
      const qn = i.q[r]! + i.dt * i.qd[r]! + h2 * v[r]!;
      if (qn < i.qMin[r]!) { const e = qn - i.qMin[r]!; c += e * e; }
      if (qn > i.qMax[r]!) { const e = qn - i.qMax[r]!; c += e * e; }
    }
    return c;
  };
  const eps = 1e-4;
  for (let it = 0; it < maxIt; it++) {
    const g = new Array<number>(nv).fill(0);
    for (let k = 0; k < nv; k++) {
      const old = x[k]!;
      x[k] = old + eps; const c1 = cost(x) + 1e6 * violation(x);
      x[k] = old - eps; const c0 = cost(x) + 1e6 * violation(x);
      x[k] = old; g[k] = (c1 - c0) / (2 * eps);
    }
    let step = 0.02 / (1 + it * 0.02);
    for (let ls = 0; ls < 12; ls++) {
      const y = x.map((v, k) => v - step * g[k]!);
      for (let k = 0; k < n; k++) y[k] = clamp(y[k]!, -100, 100);
      for (const off of [fL, fR]) {
        y[off + 2] = clamp(y[off + 2]!, 0, i.bodyMass * 9.81 * 2);
        y[off] = clamp(y[off]!, -i.mu * y[off + 2]!, i.mu * y[off + 2]!);
        y[off + 1] = clamp(y[off + 1]!, -i.mu * y[off + 2]!, i.mu * y[off + 2]!);
      }
      if (cost(y) + 1e6 * violation(y) < cost(x) + 1e6 * violation(x)) {
        for (let k = 0; k < nv; k++) x[k] = y[k]!;
        break;
      }
      step *= 0.5;
    }
  }
  const qdd = x.slice(0, n);
  const fLo = x.slice(fL, fL + 6);
  const fRo = x.slice(fR, fR + 6);
  const tau = tauOf(x);
  return { qdd, tau, fL: fLo, fR: fRo, cost: cost(x), maxViolation: violation(x), iterations: maxIt };
}
