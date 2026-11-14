/**
 * wbc.ts —— 浮动基 WBC QP（论文级）
 *
 * 变量
 *   ν̇_base(6) + ν̇_joint(18) + fL(6) + fR(6)
 *   + 软约束 slack：τ 上下界 36 + 关节位置限位 36
 *
 * 等式
 *   M_b ν̇ + h_b − Jc_bᵀ f = 0          （base 不可驱动）
 *   Jc ν̇ + J̇c ν = 0                    （每脚 6D 接触）
 *
 * 不等式
 *   τ = M_j ν̇ + h_j − Jc_jᵀ f ∈ [τmin, τmax]（带 slack）
 *   关节限位（带 slack）
 *   8 边摩擦锥 + CoP/扭转 CWC
 *
 * 成本
 *   wCom‖Jcom ν̇ − a*‖² + wBase‖Jbase ν̇ − α*‖²
 *   + wPost‖ν̇_j − q̈*‖² + wτ‖τ‖² + wq‖ν̇‖² + wSlack‖s‖²
 *
 * 求解器：OSQP 同款 ADMM（不搞有限差分 H/g）。
 */
import type { FloatingModel } from './floatingModel';
import { quatError } from './floatingModel';

export interface WbcInput {
  model: FloatingModel;
  q18: number[];
  qd18: number[];
  qMin: number[];
  qMax: number[];
  tauMin: number[];
  tauMax: number[];
  qTarget18: number[];
  comTarget: [number, number, number];
  comKp: number;
  comKd: number;
  baseTarget: Parameters<typeof quatError>[0];
  baseKp: number;
  baseKd: number;
  postureKp: number;
  postureKd: number;
  dt: number;
  mu: number;
  qddCap: number;
  wCom: number;
  wBase: number;
  wPost: number;
  wTau: number;
  wQdd: number;
  wSlack: number;
  wForce?: number;
  wPenalty?: number;
  wCwc?: number;
  wContact?: number;
  wCop?: number;
  wForceLat?: number;
  maxIter?: number;
  warm?: { x: Float64Array; z: Float64Array; y: Float64Array };
}

export interface WbcOutput {
  ok: boolean;
  nuDot: Float64Array;
  tau: Float64Array;
  fL: Float64Array;
  fR: Float64Array;
  sTau: Float64Array;
  sJoint: Float64Array;
  sCwc?: Float64Array;
  sContact?: Float64Array;
  sContactMax?: number;
  sCwcMax?: number;
  maxViolation: number;
  primalRes: number;
  dualRes: number;
  iterations: number;
  qddMax: number;
  qddJointMax: number;
  tauMax: number;
  slackMax: number;
  warmX: Float64Array;
  warmZ: Float64Array;
  warmY: Float64Array;
}

const NV = 24;
const NF = 12;
const NS_T = 36;
const NS_J = 36;
const NX = NV + NF + NS_T + NS_J; // 108
const I_FL = NV;
const I_FR = NV + 6;
const I_ST = NV + NF;
const I_SJ = I_ST + NS_T;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function luFactor(a: Float64Array, n: number): { lu: Float64Array; piv: Int32Array } | null {
  const lu = Float64Array.from(a);
  const piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let p = k;
    let mx = Math.abs(lu[k * n + k]!);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(lu[r * n + k]!);
      if (v > mx) { mx = v; p = r; }
    }
    if (mx < 1e-12) return null;
    piv[k] = p;
    if (p !== k) {
      for (let c = 0; c < n; c++) {
        const t = lu[k * n + c]!;
        lu[k * n + c] = lu[p * n + c]!;
        lu[p * n + c] = t;
      }
    }
    const d = lu[k * n + k]!;
    for (let r = k + 1; r < n; r++) {
      const f = lu[r * n + k]! / d;
      lu[r * n + k] = f;
      if (f === 0) continue;
      for (let c = k + 1; c < n; c++) lu[r * n + c] = lu[r * n + c]! - f * lu[k * n + c]!;
    }
  }
  return { lu, piv };
}

function luSolve(f: { lu: Float64Array; piv: Int32Array }, n: number, b: Float64Array): Float64Array {
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    const p = f.piv[k]!;
    if (p !== k) { const t = x[k]!; x[k] = x[p]!; x[p] = t; }
    const d = f.lu[k * n + k]!;
    for (let r = k + 1; r < n; r++) x[r] = x[r]! - f.lu[r * n + k]! * x[k]!;
    void d;
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = x[k]!;
    for (let c = k + 1; c < n; c++) s -= f.lu[k * n + c]! * x[c]!;
    x[k] = s / f.lu[k * n + k]!;
  }
  return x;
}

export function solveWbc(i: WbcInput): WbcOutput {
  const m = i.model;
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

  // 任务：CoM / base 姿态 / 姿态
  const aCom = [
    i.comKp * (i.comTarget[0] - m.com.x) - i.comKd * m.comVel.x,
    i.comKp * (i.comTarget[2] - m.com.y) - i.comKd * m.comVel.y,
    i.comKp * (i.comTarget[1] - m.com.z) - i.comKd * m.comVel.z,
  ];
  const Jcom = new Float64Array(NX * 3);
  // model Jcom 行顺序 x/y/z；任务顺序 x/y/z
  for (let a = 0; a < NV; a++) {
    Jcom[a * 3 + 0] = m.Jcom[a]!;
    Jcom[a * 3 + 1] = m.Jcom[NV + a]!;
    Jcom[a * 3 + 2] = m.Jcom[2 * NV + a]!;
  }
  addTask(Jcom, 3, aCom, i.wCom);

  const rErr = quatError(i.baseTarget, m.baseQuat);
  const aBase = [
    i.baseKp * rErr.x - i.baseKd * m.baseOmega.x,
    i.baseKp * rErr.y - i.baseKd * m.baseOmega.y,
    i.baseKp * rErr.z - i.baseKd * m.baseOmega.z,
  ];
  const Jbase = new Float64Array(NX * 3);
  for (let a = 0; a < NV; a++) {
    Jbase[a * 3 + 0] = m.Jbase[a]!;
    Jbase[a * 3 + 1] = m.Jbase[NV + a]!;
    Jbase[a * 3 + 2] = m.Jbase[2 * NV + a]!;
  }
  addTask(Jbase, 3, aBase, i.wBase);

  const qddStar = i.q18.map((q, k) => i.postureKp * (i.qTarget18[k]! - q) - i.postureKd * i.qd18[k]!);
  const Jpost = new Float64Array(NX * 18);
  for (let k = 0; k < 18; k++) Jpost[(6 + k) * 18 + k] = 1;
  addTask(Jpost, 18, qddStar, i.wPost);

  // 正则
  for (let a = 0; a < NV; a++) P[a * NX + a] += 2 * i.wQdd;
  for (let a = I_ST; a < NX; a++) P[a * NX + a] += 2 * i.wSlack;
  for (let a = I_FL; a < I_FR + 6; a++) P[a * NX + a] += 2 * (i.wForce ?? 1e-3);

  // τ 行
  const tauRow = (r: number): Float64Array => {
    const row = new Float64Array(NX);
    for (let k = 0; k < NV; k++) row[k] = m.M[(6 + r) * NV + k]!;
    for (let s = 0; s < 6; s++) {
      row[I_FL + s] = -m.Jc[0]![s * NV + (6 + r)]!;
      row[I_FR + s] = -m.Jc[1]![s * NV + (6 + r)]!;
    }
    return row;
  };
  const tauConst = (r: number): number => m.h[6 + r]!;
  const tauRows: Float64Array[] = [];
  for (let r = 0; r < 18; r++) {
    const row = tauRow(r);
    tauRows.push(row);
    const c = tauConst(r);
    for (let a = 0; a < NX; a++) {
      if (row[a] === 0) continue;
      g[a] += 2 * i.wTau * row[a]! * c;
      for (let b = 0; b < NX; b++) if (row[b] !== 0) P[a * NX + b] += 2 * i.wTau * row[a]! * row[b]!;
    }
  }

  for (let a = 0; a < NX; a++) P[a * NX + a] += 1e-8;

  // 约束 A x ∈ [l,u]
  const A: Float64Array[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  const add = (row: Float64Array, l: number, u: number): void => { A.push(row); lo.push(l); hi.push(u); };

  // base 动力学 6
  for (let r = 0; r < 6; r++) {
    const row = new Float64Array(NX);
    for (let k = 0; k < NV; k++) row[k] = m.M[r * NV + k]!;
    for (let s = 0; s < 6; s++) {
      row[I_FL + s] = -m.Jc[0]![s * NV + r]!;
      row[I_FR + s] = -m.Jc[1]![s * NV + r]!;
    }
    add(row, -m.h[r]!, -m.h[r]!);
  }
  {
    const row = new Float64Array(NX);
    row[I_FL + 2] = 1; row[I_FR + 2] = 1;
    add(row, m.mass * 9.81, m.mass * 9.81);
  }
  // 接触 6D ×2
  for (let foot = 0; foot < 2; foot++) {
    const Jc = m.Jc[foot]!;
    const Jd = m.JdotNu[foot]!;
    for (let r = 0; r < 6; r++) {
      const row = new Float64Array(NX);
      for (let k = 0; k < NV; k++) row[k] = Jc[r * NV + k]!;
      add(row, -Jd[r]!, -Jd[r]!);
    }
  }
  // τ 上下界（带 slack）
  for (let r = 0; r < 18; r++) {
    const row = tauRows[r]!;
    const c = tauConst(r);
    const up = row.slice(); up[I_ST + 2 * r] = -1;
    add(up, -Infinity, i.tauMax[r]! - c);
    const dn = row.map((v) => -v); dn[I_ST + 2 * r + 1] = -1;
    add(dn, -Infinity, -i.tauMin[r]! + c);
  }
  // 关节位置限位（带 slack）
  for (let r = 0; r < 18; r++) {
    const dt = Math.max(1e-4, i.dt);
    const qddMax = (i.qMax[r]! - i.q18[r]! - dt * i.qd18[r]!) * 2 / (dt * dt);
    const qddMin = (i.qMin[r]! - i.q18[r]! - dt * i.qd18[r]!) * 2 / (dt * dt);
    const up = new Float64Array(NX); up[6 + r] = 1; up[I_SJ + 2 * r] = -1;
    add(up, -Infinity, clamp(qddMax, -i.qddCap, i.qddCap));
    const dn = new Float64Array(NX); dn[6 + r] = -1; dn[I_SJ + 2 * r + 1] = -1;
    add(dn, -Infinity, -clamp(qddMin, -i.qddCap, i.qddCap));
  }
  // slack ≥ 0（作为约束行）
  for (let r = 0; r < NS_T + NS_J; r++) {
    const row = new Float64Array(NX); row[I_ST + r] = 1;
    add(row, 0, Infinity);
  }
  // 摩擦/CoP/CWC
  for (let foot = 0; foot < 2; foot++) {
    const o = foot === 0 ? I_FL : I_FR;
    const c = m.contact[foot]!;
    const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
    const cf = new Float64Array(NX); cf[fz] = -1; add(cf, -Infinity, 0);
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const row = new Float64Array(NX);
      row[fx] = Math.cos(th);
      row[fy] = Math.sin(th);
      row[fz] = -i.mu;
      add(row, -Infinity, 0);
    }
    const my1 = new Float64Array(NX); my1[my] = 1; my1[fz] = -0.2; add(my1, -Infinity, 0);
    const my2 = new Float64Array(NX); my2[my] = -1; my2[fz] = -0.2; add(my2, -Infinity, 0);
    const rx1 = new Float64Array(NX); rx1[fz] = c.point.x - c.maxX; rx1[mz] = -1; add(rx1, -Infinity, 0);
    const rx2 = new Float64Array(NX); rx2[fz] = c.minX - c.point.x; rx2[mz] = 1; add(rx2, -Infinity, 0);
    const rz1 = new Float64Array(NX); rz1[fz] = c.point.z - c.maxZ; rz1[mx] = 1; add(rz1, -Infinity, 0);
    const rz2 = new Float64Array(NX); rz2[fz] = c.minZ - c.point.z; rz2[mx] = -1; add(rz2, -Infinity, 0);
    const fzMax = 3 * m.mass * 9.81;
    const fmax = new Float64Array(NX); fmax[fz] = 1; add(fmax, -Infinity, fzMax);
  }
  // 变量边界（帮助 ADMM 条件数）
  for (let a = 0; a < NV; a++) {
    const row = new Float64Array(NX); row[a] = 1;
    add(row, -500, 500);
  }
  for (let a = I_FL; a < I_ST; a++) {
    const row = new Float64Array(NX); row[a] = 1;
    add(row, -5000, 5000);
  }

  // ---------- OSQP ADMM ----------
  const n = NX;
  const nc = A.length;
  let rho = 1.0;
  const sigma = 1e-6;
  const alpha = 1.6;
  const maxIter = i.maxIter ?? 4000;
  const AtA = new Float64Array(n * n);
  const At = new Float64Array(n * nc);
  for (let r = 0; r < nc; r++) {
    const row = A[r]!;
    for (let a = 0; a < n; a++) {
      const va = row[a]!;
      if (va === 0) continue;
      At[a * nc + r] = va;
      for (let b = 0; b < n; b++) {
        const vb = row[b]!;
        if (vb !== 0) AtA[a * n + b] += va * vb;
      }
    }
  }
  const buildFac = (rr: number): ReturnType<typeof luFactor> => {
    const K = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) K[a * n + b] = P[a * n + b]! + rr * AtA[a * n + b]!;
    for (let a = 0; a < n; a++) K[a * n + a] += sigma;
    return luFactor(K, n);
  };
  let fac = buildFac(rho);
  if (!fac) {
    return { ok: false, nuDot: new Float64Array(NV), tau: new Float64Array(18), fL: new Float64Array(6), fR: new Float64Array(6), sTau: new Float64Array(NS_T), sJoint: new Float64Array(NS_J), maxViolation: Infinity, primalRes: Infinity, dualRes: Infinity, iterations: 0, qddMax: Infinity, qddJointMax: Infinity, tauMax: Infinity, slackMax: Infinity, warmX: new Float64Array(NX), warmZ: new Float64Array(nc), warmY: new Float64Array(nc) };
  }
  let x = i.warm ? Float64Array.from(i.warm.x) : new Float64Array(n);
  let z = i.warm && i.warm.z.length === nc ? Float64Array.from(i.warm.z) : new Float64Array(nc);
  let y = i.warm && i.warm.y.length === nc ? Float64Array.from(i.warm.y) : new Float64Array(nc);
  if (!i.warm) {
    for (let r = 0; r < nc; r++) {
      const row = A[r]!;
      let s = 0;
      for (let a = 0; a < n; a++) s += row[a]! * x[a]!;
      z[r] = clamp(s, lo[r]!, hi[r]!);
    }
  }
  let prim = Infinity;
  let dual = Infinity;
  let it = 0;
  const Ax = new Float64Array(nc);
  for (; it < maxIter; it++) {
    const rhs = new Float64Array(n);
    for (let a = 0; a < n; a++) rhs[a] = sigma * x[a]! - g[a]!;
    for (let r = 0; r < nc; r++) {
      const v = rho * (z[r]! - y[r]!);
      if (v === 0) continue;
      for (let a = 0; a < n; a++) rhs[a] += At[a * nc + r]! * v;
    }
    const xn = luSolve(fac, n, rhs);
    for (let r = 0; r < nc; r++) {
      let s = 0;
      const row = A[r]!;
      for (let a = 0; a < n; a++) s += row[a]! * xn[a]!;
      Ax[r] = s;
    }
    let p = 0;
    for (let r = 0; r < nc; r++) {
      const zr = alpha * Ax[r]! + (1 - alpha) * z[r]! + y[r]!;
      const zn = clamp(zr, lo[r]!, hi[r]!);
      p = Math.max(p, Math.abs(Ax[r]! - zn));
      y[r] = zr - zn;
      z[r] = zn;
    }
    // dual residual: P x + g + A^T y
    let d = 0;
    for (let a = 0; a < n; a++) {
      let s = g[a]!;
      for (let b = 0; b < n; b++) s += P[a * n + b]! * xn[b]!;
      for (let r = 0; r < nc; r++) s += At[a * nc + r]! * y[r]!;
      d = Math.max(d, Math.abs(s));
    }
    x = xn;
    prim = p;
    dual = d;
    if (prim < 1e-4 && dual < 1e-4) { it++; break; }
    if (it > 0 && it % 30 === 0) {
      let nr = rho;
      if (prim > 10 * Math.max(1e-12, dual)) nr = Math.min(1e3, rho * 2);
      else if (dual > 10 * Math.max(1e-12, prim)) nr = Math.max(1e-3, rho / 2);
      if (nr !== rho) {
        const oldR = rho;
        rho = nr;
        for (let r = 0; r < nc; r++) y[r] = y[r]! * (oldR / rho);
        const nf = buildFac(rho);
        if (nf) fac = nf;
      }
    }
  }

  let maxViol = 0;
  for (let r = 0; r < nc; r++) {
    const row = A[r]!;
    let s = 0;
    for (let a = 0; a < n; a++) s += row[a]! * x[a]!;
    maxViol = Math.max(maxViol, lo[r]! - s, s - hi[r]!);
  }
  maxViol = Math.max(0, maxViol);
  const nuDot = x.slice(0, NV);
  const fL = x.slice(I_FL, I_FL + 6);
  const fR = x.slice(I_FR, I_FR + 6);
  const sTau = x.slice(I_ST, I_ST + NS_T);
  const sJoint = x.slice(I_SJ, I_SJ + NS_J);
  const tau = new Float64Array(18);
  for (let r = 0; r < 18; r++) {
    const row = tauRows[r]!;
    let s = tauConst(r);
    for (let a = 0; a < n; a++) s += row[a]! * x[a]!;
    tau[r] = s;
  }
  let qddMax = 0;
  for (let k = 0; k < NV; k++) qddMax = Math.max(qddMax, Math.abs(nuDot[k]!));
  let qddJointMax = 0;
  for (let k = 6; k < NV; k++) qddJointMax = Math.max(qddJointMax, Math.abs(nuDot[k]!));
  let tauMax = 0;
  for (let k = 0; k < 18; k++) tauMax = Math.max(tauMax, Math.abs(tau[k]!));
  let slackMax = 0;
  for (const v of sTau) slackMax = Math.max(slackMax, v);
  for (const v of sJoint) slackMax = Math.max(slackMax, v);
  const finite = [nuDot, tau, fL, fR, sTau, sJoint].every((arr) => Array.from(arr).every((v) => Number.isFinite(v)));
  const ok = finite && maxViol < 1e-3 && Number.isFinite(prim) && Number.isFinite(dual);
  return { ok, nuDot, tau, fL, fR, sTau, sJoint, maxViolation: maxViol, primalRes: prim, dualRes: dual, iterations: it, qddMax, qddJointMax, tauMax, slackMax, warmX: x, warmZ: z, warmY: y };
}
