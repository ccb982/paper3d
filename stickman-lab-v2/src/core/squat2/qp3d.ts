export interface Squat3dInput {
  mass: number[][]; bias: number[]; jCom: number[][]; jFootL: number[][]; jFootR: number[][]; jFootAngularL: number[][]; jFootAngularR: number[][]; axis: number[][];
  com: [number, number, number]; comTarget: [number, number, number]; comVel: [number, number, number];
  bodyMass: number; mu: number; tauMin: number[]; tauMax: number[];
  q: number[]; qd: number[]; qTarget: number[]; qMin: number[]; qMax: number[]; dt: number;
  footXL: number; footXR: number; footZL: number; footZR: number;
  copMinXL: number; copMaxXL: number; copMinZL: number; copMaxZL: number;
  copMinXR: number; copMaxXR: number; copMinZR: number; copMaxZR: number;
  kp?: number; kd?: number; wCom?: number; wTau?: number; wForce?: number; wQdd?: number; wPosture?: number; wFoot?: number; iterations?: number;
}
export interface Squat3dOutput { qdd: number[]; tau: number[]; fL: number[]; fR: number[]; cost: number; maxViolation: number; iterations: number; }

function lin(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let k = 0; k < n; k++) {
    let p = k; for (let r = k + 1; r < n; r++) if (Math.abs(M[r]![k]!) > Math.abs(M[p]![k]!)) p = r;
    [M[k], M[p]] = [M[p]!, M[k]!];
    const piv = M[k]![k]! || 1e-9; for (let c = k; c <= n; c++) M[k]![c] = M[k]![c]! / piv;
    for (let r = 0; r < n; r++) { if (r === k) continue; const f = M[r]![k]!; if (!f) continue; for (let c = k; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[k]![c]!; }
  }
  return M.map((r) => r[n]!);
}

export function solveSquat3d(i: Squat3dInput): Squat3dOutput {
  const n = i.mass.length, nv = n + 12, fL = n, fR = n + 6;
  const kp = i.kp ?? 8, kd = i.kd ?? 2.5, wCom = i.wCom ?? 100, wTau = i.wTau ?? 0.01, wForce = i.wForce ?? 1, wQdd = i.wQdd ?? 0.01, wPost = i.wPosture ?? 100, wFoot = i.wFoot ?? 100;
  const maxIt = Math.max(1, Math.min(40, i.iterations ?? 12));
  const a = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!);
  const fn0 = 0.5 * i.bodyMass * 9.81;
  const tauCoeff = (r: number): number[] => {
    const row = new Array<number>(nv).fill(0);
    for (let c = 0; c < n; c++) row[c] = i.mass[r]![c]!;
    row[fL] = -i.jFootL[0]![r]!; row[fL + 1] = -i.jFootL[1]![r]!; row[fL + 2] = -i.jFootL[2]![r]!;
    row[fL + 3] = -i.axis[r]![0]!; row[fL + 4] = -i.axis[r]![1]!; row[fL + 5] = -i.axis[r]![2]!;
    row[fR] = -i.jFootR[0]![r]!; row[fR + 1] = -i.jFootR[1]![r]!; row[fR + 2] = -i.jFootR[2]![r]!;
    row[fR + 3] = -i.axis[r]![0]!; row[fR + 4] = -i.axis[r]![1]!; row[fR + 5] = -i.axis[r]![2]!;
    return row;
  };
  const tauOf = (v: number[]): number[] => {
    const out = new Array<number>(n).fill(0);
    for (let r = 0; r < n; r++) out[r] = i.bias[r]! + tauCoeff(r).reduce((s, c, k) => s + c * v[k]!, 0);
    return out;
  };
  const cost = (v: number[]): number => {
    let c = wQdd * v.slice(0, n).reduce((s, q) => s + q * q, 0);
    for (let k = 0; k < 3; k++) { let r = -a[k]!; for (let j = 0; j < n; j++) r += i.jCom[k]![j]! * v[j]!; c += wCom * r * r; }
    for (let k = 0; k < n; k++) { const qs = kp * (i.qTarget[k]! - i.q[k]!) - kd * i.qd[k]!; c += wPost * (v[k]! - qs) ** 2; }
    for (const JA of [i.jFootAngularL, i.jFootAngularR]) for (const row of JA) { let r = 0; for (let k = 0; k < n; k++) r += row[k]! * v[k]!; c += wFoot * r * r; }
    const tau = tauOf(v); for (let r = 0; r < n; r++) c += wTau * tau[r]! * tau[r]!;
    for (const o of [fL, fR]) c += wForce * (v[o]! ** 2 + v[o + 1]! ** 2 + (v[o + 2]! - fn0) ** 2 + v[o + 3]! ** 2 + v[o + 4]! ** 2 + v[o + 5]! ** 2);
    return c;
  };
  const Aeq: number[][] = [], beq: number[] = [], A: number[][] = [], b: number[] = [];
  const add = (row: number[], rhs: number): void => { A.push(row); b.push(rhs); };
  for (const [J, off] of [[i.jFootL, fL], [i.jFootR, fR]] as const) {
    for (let r = 0; r < 3; r++) { const row = new Array<number>(nv).fill(0); for (let c = 0; c < n; c++) row[c] = J[r]![c]!; Aeq.push(row); beq.push(0); }
    void off;
  }
  { const row = new Array<number>(nv).fill(0); row[fL + 2] = 1; row[fR + 2] = 1; Aeq.push(row); beq.push(0.9 * i.bodyMass * 9.81); }
  for (let r = 0; r < n; r++) { const pos = tauCoeff(r); add(pos, i.tauMax[r]! - i.bias[r]!); add(pos.map((v) => -v), -i.tauMin[r]! + i.bias[r]!); }
  const friction = (o: number): void => {
    for (const s of [1, -1]) {
      const x = new Array<number>(nv).fill(0); x[o] = s; x[o + 2] = -i.mu; add(x, 0);
      const y = new Array<number>(nv).fill(0); y[o + 1] = s; y[o + 2] = -i.mu; add(y, 0);
    }
    const nf = new Array<number>(nv).fill(0); nf[o + 2] = -1; add(nf, 0);
  };
  friction(fL); friction(fR);
  for (const [o, fx, fz, minX, maxX, minZ, maxZ] of [[fL, i.footXL, i.footZL, i.copMinXL, i.copMaxXL, i.copMinZL, i.copMaxZL], [fR, i.footXR, i.footZR, i.copMinXR, i.copMaxXR, i.copMinZR, i.copMaxZR]] as const) {
    const rx1 = new Array<number>(nv).fill(0); rx1[o + 2] = fx - maxX; rx1[o + 5] = -1; add(rx1, 0);
    const rx2 = new Array<number>(nv).fill(0); rx2[o + 2] = minX - fx; rx2[o + 5] = 1; add(rx2, 0);
    const rz1 = new Array<number>(nv).fill(0); rz1[o + 2] = fz - maxZ; rz1[o + 3] = 1; add(rz1, 0);
    const rz2 = new Array<number>(nv).fill(0); rz2[o + 2] = minZ - fz; rz2[o + 3] = -1; add(rz2, 0);
  }
  const h2 = 0.5 * i.dt * i.dt;
  for (let c = 0; c < n; c++) {
    const r1 = new Array<number>(nv).fill(0); r1[c] = h2; add(r1, i.qMax[c]! - i.q[c]! - i.dt * i.qd[c]!);
    const r2 = new Array<number>(nv).fill(0); r2[c] = -h2; add(r2, i.q[c]! + i.dt * i.qd[c]! - i.qMin[c]!);
  }
  const x = new Array<number>(nv).fill(0); x[fL + 2] = fn0; x[fR + 2] = fn0;
  const viol = (v: number[]): number => {
    let c = 0;
    for (let r = 0; r < Aeq.length; r++) { const q = Aeq[r]!.reduce((s, a, k) => s + a * v[k]!, 0) - beq[r]!; c += q * q; }
    for (let j = 0; j < A.length; j++) { const q = A[j]!.reduce((s, a, k) => s + a * v[k]!, 0) - b[j]!; if (q > 0) c += q * q; }
    return c;
  };
  const eps = 1e-5, g = new Array<number>(nv).fill(0);
  for (let k = 0; k < nv; k++) { const o = x[k]!; x[k] = o + eps; const c1 = cost(x); x[k] = o - eps; const c0 = cost(x); x[k] = o; g[k] = (c1 - c0) / (2 * eps); }
  const H = Array.from({ length: nv }, () => new Array<number>(nv).fill(0));
  for (let r = 0; r < nv; r++) for (let c = r; c < nv; c++) {
    const er = new Array<number>(nv).fill(0); er[r] = eps; const ec = new Array<number>(nv).fill(0); ec[c] = eps;
    const xpp = x.map((v, k) => v + er[k]! + ec[k]!), xpm = x.map((v, k) => v + er[k]! - ec[k]!), xmp = x.map((v, k) => v - er[k]! + ec[k]!), xmm = x.map((v, k) => v - er[k]! - ec[k]!);
    const val = (cost(xpp) - cost(xpm) - cost(xmp) + cost(xmm)) / (4 * eps * eps); H[r]![c] = val; H[c]![r] = val;
  }
  for (let k = 0; k < nv; k++) H[k]![k] = H[k]![k]! + 1e-9;
  const active: number[] = [];
  let it = 0;
  for (; it < maxIt; it++) {
    const C = [...Aeq, ...active.map((j) => A[j]!)];
    const d = C.map((row, r) => (r < beq.length ? beq[r]! : 0) - row.reduce((s, v, k) => s + v * x[k]!, 0));
    const m = C.length, K = Array.from({ length: nv + m }, () => new Array<number>(nv + m).fill(0));
    for (let r = 0; r < nv; r++) { for (let c = 0; c < nv; c++) K[r]![c] = H[r]![c]!; for (let c = 0; c < m; c++) K[r]![nv + c] = C[c]![r]!; }
    for (let r = 0; r < m; r++) for (let c = 0; c < nv; c++) K[nv + r]![c] = C[r]![c]!;
    const rhs = new Array<number>(nv + m).fill(0);
    for (let r = 0; r < nv; r++) rhs[r] = -(g[r]! + H[r]!.reduce((s, v, k) => s + v * x[k]!, 0));
    for (let r = 0; r < m; r++) rhs[nv + r] = d[r]!;
    const sol = lin(K, rhs), p = sol.slice(0, nv), lam = sol.slice(nv);
    if (Math.sqrt(p.reduce((s, v) => s + v * v, 0)) < 1e-7) {
      let w = -1, wv = -1e-7; for (let r = 0; r < active.length; r++) if (lam[Aeq.length + r]! < wv) { wv = lam[Aeq.length + r]!; w = r; }
      if (w >= 0) { active.splice(w, 1); continue; } break;
    }
    let alpha = 1, block = -1;
    for (let j = 0; j < A.length; j++) { if (active.includes(j)) continue; const den = A[j]!.reduce((s, v, k) => s + v * p[k]!, 0); if (den <= 1e-9) continue; const slack = b[j]! - A[j]!.reduce((s, v, k) => s + v * x[k]!, 0); const t = slack / den; if (t < alpha) { alpha = Math.max(0, t); block = j; } }
    for (let k = 0; k < nv; k++) x[k] = x[k]! + alpha * p[k]!;
    if (block >= 0 && alpha < 1) active.push(block);
  }
  const qdd = x.slice(0, n), fLo = x.slice(fL, fL + 6), fRo = x.slice(fR, fR + 6), tau = tauOf(x);
  const maxViolation = Math.max(0, ...A.map((row, j) => row.reduce((s, v, k) => s + v * x[k]!, 0) - b[j]!));
  return { qdd, tau, fL: fLo, fR: fRo, cost: cost(x), maxViolation, iterations: it };
}
