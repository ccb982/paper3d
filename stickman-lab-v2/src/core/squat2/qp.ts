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
  q: number[];
  qd: number[];
  qTarget: number[];
  qMin: number[];
  qMax: number[];
  dt: number;
  footXL: number;
  footXR: number;
  copMinL: number;
  copMaxL: number;
  copMinR: number;
  copMaxR: number;
  kp?: number;
  kd?: number;
  wCom?: number;
  wTau?: number;
  wForce?: number;
  wQdd?: number;
  wPosture?: number;
  iterations?: number;
}

export interface Squat2QpOutput {
  qdd: number[];
  tau: number[];
  fL: [number, number];
  fR: [number, number];
  contactResidual: number;
  maxViolation: number;
  cost: number;
  iterations: number;
}

function solveLinear(A: number[][], b: number[]): number[] {
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
  const nv = n + 4;
  const kp = i.kp ?? 8;
  const kd = i.kd ?? 2.5;
  const wCom = i.wCom ?? 100;
  const wTau = i.wTau ?? 0.01;
  const wForce = i.wForce ?? 1;
  const wQdd = i.wQdd ?? 0.01;
  const wPosture = i.wPosture ?? 100;
  const maxIt = Math.max(1, Math.min(100, i.iterations ?? 40));
  const a = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!);
  const fn0 = Math.max(0, 0.5 * i.bodyMass * 9.81);
  const Aeq: number[][] = [];
  for (const J of [i.jFootL, i.jFootR]) {
    for (const row of [0, 1]) {
      const r = new Array<number>(nv).fill(0);
      for (let c = 0; c < n; c++) r[c] = J[row]![c]!;
      Aeq.push(r);
    }
  }
  const tauCoeff = (r: number): number[] => {
    const row = new Array<number>(nv).fill(0);
    for (let c = 0; c < n; c++) row[c] = i.mass[r]![c]!;
    row[n] = -i.jFootL[1]![r]!; row[n + 1] = -i.jFootL[0]![r]!;
    row[n + 2] = -i.jFootR[1]![r]!; row[n + 3] = -i.jFootR[0]![r]!;
    return row;
  };
  const A: number[][] = [];
  const b: number[] = [];
  const addIneq = (row: number[], rhs: number): void => { A.push(row); b.push(rhs); };
  for (let r = 0; r < n; r++) {
    const pos = tauCoeff(r);
    addIneq(pos, i.tauMax[r]! - i.bias[r]!);
    addIneq(pos.map((v) => -v), -i.tauMin[r]! + i.bias[r]!);
  }
  for (const o of [n, n + 2]) {
    const r1 = new Array<number>(nv).fill(0);
    const r2 = new Array<number>(nv).fill(0);
    r1[o + 1] = 1; r1[o] = -i.mu;
    r2[o + 1] = -1; r2[o] = -i.mu;
    addIneq(r1, 0); addIneq(r2, 0);
    const r3 = new Array<number>(nv).fill(0); r3[o] = -1; addIneq(r3, 0);
  }
  for (let c = 0; c < n; c++) {
    const r1 = new Array<number>(nv).fill(0); r1[c] = 1; addIneq(r1, i.qddMax);
    const r2 = new Array<number>(nv).fill(0); r2[c] = -1; addIneq(r2, -i.qddMin);
  }
  const h2 = 0.5 * i.dt * i.dt;
  for (let c = 0; c < n; c++) {
    const r1 = new Array<number>(nv).fill(0); r1[c] = h2;
    addIneq(r1, i.qMax[c]! - i.q[c]! - i.dt * i.qd[c]!);
    const r2 = new Array<number>(nv).fill(0); r2[c] = -h2;
    addIneq(r2, i.q[c]! + i.dt * i.qd[c]! - i.qMin[c]!);
  }
  for (const side of ['L', 'R'] as const) {
    const footX = side === 'L' ? i.footXL : i.footXR;
    const copMin = side === 'L' ? i.copMinL : i.copMinR;
    const copMax = side === 'L' ? i.copMaxL : i.copMaxR;
    const footIdx = side === 'L' ? 2 : 5;
    const fnIdx = side === 'L' ? n : n + 2;
    const tc = tauCoeff(footIdx);
    const r1 = tc.map((v) => -v); r1[fnIdx] += footX - copMax;
    addIneq(r1, i.bias[footIdx]!);
    const r2 = tc.slice(); r2[fnIdx] += copMin - footX;
    addIneq(r2, -i.bias[footIdx]!);
  }

  const tauOf = (v: number[]): number[] => {
    const out = new Array<number>(n).fill(0);
    for (let r = 0; r < n; r++) {
      let t = i.bias[r]!;
      for (let c = 0; c < n; c++) t += i.mass[r]![c]! * v[c]!;
      t -= i.jFootL[0]![r]! * v[n + 1]! + i.jFootL[1]![r]! * v[n]!;
      t -= i.jFootR[0]![r]! * v[n + 3]! + i.jFootR[1]![r]! * v[n + 2]!;
      out[r] = t;
    }
    return out;
  };
  const cost = (v: number[]): number => {
    let c = wQdd * v.slice(0, n).reduce((s, q) => s + q * q, 0);
    for (let k = 0; k < n; k++) {
      const qddStar = kp * (i.qTarget[k]! - i.q[k]!) - kd * i.qd[k]!;
      c += wPosture * (v[k]! - qddStar) ** 2;
    }
    for (let k = 0; k < 3; k++) {
      let r = -a[k]!;
      for (let j = 0; j < n; j++) r += i.jCom[k]![j]! * v[j]!;
      c += wCom * r * r;
    }
    const tau = tauOf(v);
    for (let r = 0; r < n; r++) c += wTau * tau[r]! * tau[r]!;
    c += wForce * ((v[n]! - fn0) ** 2 + v[n + 1]! ** 2 + (v[n + 2]! - fn0) ** 2 + v[n + 3]! ** 2);
    return c;
  };

  const eps = 1e-5;
  const g = new Array<number>(nv).fill(0);
  const x0 = new Array<number>(nv).fill(0);
  for (let k = 0; k < nv; k++) {
    const old = x0[k]!;
    x0[k] = old + eps; const c1 = cost(x0);
    x0[k] = old - eps; const c0 = cost(x0);
    x0[k] = old; g[k] = (c1 - c0) / (2 * eps);
  }
  const H = Array.from({ length: nv }, () => new Array<number>(nv).fill(0));
  for (let r = 0; r < nv; r++) {
    for (let c = r; c < nv; c++) {
      const er = new Array<number>(nv).fill(0); er[r] = eps;
      const ec = new Array<number>(nv).fill(0); ec[c] = eps;
      const xpp = x0.map((v, k) => v + er[k]! + ec[k]!);
      const xpm = x0.map((v, k) => v + er[k]! - ec[k]!);
      const xmp = x0.map((v, k) => v - er[k]! + ec[k]!);
      const xmm = x0.map((v, k) => v - er[k]! - ec[k]!);
      const v = (cost(xpp) - cost(xpm) - cost(xmp) + cost(xmm)) / (4 * eps * eps);
      H[r]![c] = v; H[c]![r] = v;
    }
  }
  for (let k = 0; k < nv; k++) H[k]![k] = H[k]![k]! + 1e-9;

  const x = new Array<number>(nv).fill(0);
  const active: number[] = [];
  let it = 0;
  for (; it < maxIt; it++) {
    const C = [...Aeq, ...active.map((j) => A[j]!)];
    const d = C.map((row) => -row.reduce((s, v, k) => s + v * x[k]!, 0));
    const m = C.length;
    const K = Array.from({ length: nv + m }, () => new Array<number>(nv + m).fill(0));
    for (let r = 0; r < nv; r++) {
      for (let c = 0; c < nv; c++) K[r]![c] = H[r]![c]!;
      for (let c = 0; c < m; c++) K[r]![nv + c] = C[c]![r]!;
    }
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < nv; c++) K[nv + r]![c] = C[r]![c]!;
    }
    const rhs = new Array<number>(nv + m).fill(0);
    for (let r = 0; r < nv; r++) rhs[r] = -(g[r]! + H[r]!.reduce((s, v, k) => s + v * x[k]!, 0));
    for (let r = 0; r < m; r++) rhs[nv + r] = d[r]!;
    const sol = solveLinear(K, rhs);
    const p = sol.slice(0, nv);
    const lam = sol.slice(nv);
    const pn = Math.sqrt(p.reduce((s, v) => s + v * v, 0));
    if (pn < 1e-7) {
      let worst = -1, worstV = -1e-7;
      for (let r = 0; r < active.length; r++) {
        const l = lam[Aeq.length + r]!;
        if (l < worstV) { worstV = l; worst = r; }
      }
      if (worst >= 0) { active.splice(worst, 1); continue; }
      break;
    }
    let alpha = 1;
    let block = -1;
    for (let j = 0; j < A.length; j++) {
      if (active.includes(j)) continue;
      const den = A[j]!.reduce((s, v, k) => s + v * p[k]!, 0);
      if (den <= 1e-9) continue;
      const slack = b[j]! - A[j]!.reduce((s, v, k) => s + v * x[k]!, 0);
      const t = slack / den;
      if (t < alpha) { alpha = Math.max(0, t); block = j; }
    }
    for (let k = 0; k < nv; k++) x[k] = x[k]! + alpha * p[k]!;
    if (block >= 0 && alpha < 1) active.push(block);
  }

  const qdd = x.slice(0, n);
  const fL: [number, number] = [x[n]!, x[n + 1]!];
  const fR: [number, number] = [x[n + 2]!, x[n + 3]!];
  const tau = tauOf(x);
  const contactResidual = Math.max(...Aeq.map((row) => Math.abs(row.reduce((s, v, k) => s + v * x[k]!, 0))));
  const maxViolation = Math.max(0, ...A.map((row, j) => row.reduce((s, v, k) => s + v * x[k]!, 0) - b[j]!));
  return { qdd, tau, fL, fR, contactResidual, maxViolation, cost: cost(x), iterations: it };
}
