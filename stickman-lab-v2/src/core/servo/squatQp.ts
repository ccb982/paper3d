export interface SquatQpInput {
  mass: [number, number, number][];
  bodyMass: number;
  bias: [number, number, number];
  jCom: [number, number, number][];
  jFootL: [number, number, number][];
  jFootR: [number, number, number][];
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  mu: number;
  tauMin: [number, number, number];
  tauMax: [number, number, number];
  fnMax: number;
  kp?: number;
  kd?: number;
  wCom?: number;
  wTau?: number;
  wContact?: number;
  wForce?: number;
  wBound?: number;
  wQdd?: number;
  iterations?: number;
}

export interface SquatQpOutput {
  qdd: [number, number, number];
  tau: [number, number, number];
  fL: [number, number];
  fR: [number, number];
  cost: number;
  iterations: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const dot3 = (a: [number, number, number], b: [number, number, number]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function solveSquatQp(i: SquatQpInput): SquatQpOutput {
  const kp = i.kp ?? 8;
  const kd = i.kd ?? 2.5;
  const wCom = i.wCom ?? 100;
  const wTau = i.wTau ?? 1;
  const wContact = i.wContact ?? 100;
  const wForce = i.wForce ?? 1;
  const wBound = i.wBound ?? 1000;
  const wQdd = i.wQdd ?? 0.01;
  const iterations = Math.max(1, Math.min(400, i.iterations ?? 160));
  const a: [number, number, number] = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!) as [number, number, number];
  const fn0 = Math.max(0, 0.5 * i.bodyMass * 9.81);
  const x: number[] = [0, 0, 0, fn0, 0, fn0, 0];

  const evalCost = (v: number[]): number => {
    const qdd: [number, number, number] = [v[0]!, v[1]!, v[2]!];
    const fL: [number, number] = [v[3]!, v[4]!];
    const fR: [number, number] = [v[5]!, v[6]!];
    let cost = wQdd * (v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!);
    for (let k = 0; k < 3; k++) {
      const r = dot3(i.jCom[k]!, qdd) - a[k]!;
      cost += wCom * r * r;
    }
    const tau: [number, number, number] = [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      let t = i.bias[r]!;
      for (let c = 0; c < 3; c++) t += i.mass[r]![c]! * qdd[c]!;
      t -= i.jFootL[0]![r]! * fL[1]! + i.jFootL[1]![r]! * fL[0]!;
      t -= i.jFootR[0]![r]! * fR[1]! + i.jFootR[1]![r]! * fR[0]!;
      tau[r] = t;
      cost += wTau * t * t;
      const over = t > i.tauMax[r]! ? t - i.tauMax[r]! : t < i.tauMin[r]! ? t - i.tauMin[r]! : 0;
      cost += wBound * over * over;
    }
    for (let r = 0; r < 3; r++) {
      if (r > 1) continue;
      const cl = dot3(i.jFootL[r]!, qdd);
      const cr = dot3(i.jFootR[r]!, qdd);
      cost += wContact * (cl * cl + cr * cr);
    }
    cost += wForce * ((fL[0]! - fn0) ** 2 + fL[1]! ** 2 + (fR[0]! - fn0) ** 2 + fR[1]! ** 2);
    const fl = Math.max(0, Math.abs(fL[1]!) - i.mu * Math.max(0, fL[0]!));
    const fr = Math.max(0, Math.abs(fR[1]!) - i.mu * Math.max(0, fR[0]!));
    cost += wBound * (fl * fl + fr * fr);
    if (fL[0]! < 0) cost += wBound * fL[0]! * fL[0]!;
    if (fR[0]! < 0) cost += wBound * fR[0]! * fR[0]!;
    return cost;
  };

  const project = (v: number[]): void => {
    for (let k = 0; k < 3; k++) v[k] = clamp(v[k]!, -100, 100);
    v[3] = clamp(v[3]!, 0, i.fnMax);
    v[5] = clamp(v[5]!, 0, i.fnMax);
    v[4] = clamp(v[4]!, -i.mu * v[3]!, i.mu * v[3]!);
    v[6] = clamp(v[6]!, -i.mu * v[5]!, i.mu * v[5]!);
  };

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
      if (cy < cost) { for (let k = 0; k < x.length; k++) x[k] = y[k]!; cost = cy; break; }
      step *= 0.5;
    }
  }

  const qdd: [number, number, number] = [x[0]!, x[1]!, x[2]!];
  const fL: [number, number] = [x[3]!, x[4]!];
  const fR: [number, number] = [x[5]!, x[6]!];
  const tau: [number, number, number] = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    let t = i.bias[r]!;
    for (let c = 0; c < 3; c++) t += i.mass[r]![c]! * qdd[c]!;
    t -= i.jFootL[0]![r]! * fL[1]! + i.jFootL[1]![r]! * fL[0]!;
    t -= i.jFootR[0]![r]! * fR[1]! + i.jFootR[1]![r]! * fR[0]!;
    tau[r] = clamp(t, i.tauMin[r]!, i.tauMax[r]!);
  }
  return { qdd, tau, fL, fR, cost, iterations };
}
