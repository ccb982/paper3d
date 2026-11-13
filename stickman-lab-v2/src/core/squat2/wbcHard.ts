/**
 * wbcHard.ts —— 浮动基 WBC 硬约束 QP（零空间降维）
 *
 * 等式：base 6 + 每脚 6D 接触 = 18 行，先精确消去。
 * 不等式：τ 上下界、8 边摩擦锥、CoP/扭转 CWC、变量边界。
 * 变量 36 → 零空间 18；ADMM 只在 18 维上跑，10~15Hz 可用。
 *
 * 用户验收：力矩够、CoP 不越界、CoM 在可控范围；不追 30Hz。
 * 关节位置限位不进 QP（执行层 drive 已负责）；若 τ/CoP 不可行，ok=false 回退 PD。
 */
import type { FloatingModel } from './floatingModel';
import { quatError } from './floatingModel';
import type { WbcInput, WbcOutput } from './wbc';

const NV = 24;
const NX = 72;
const NS = 36;
const I_FL = NV;
const I_FR = NV + 6;
const I_S = NV + 12;

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
    if (p !== k) for (let c = 0; c < n; c++) { const t = lu[k * n + c]!; lu[k * n + c] = lu[p * n + c]!; lu[p * n + c] = t; }
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
    for (let r = k + 1; r < n; r++) x[r] = x[r]! - f.lu[r * n + k]! * x[k]!;
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = x[k]!;
    for (let c = k + 1; c < n; c++) s -= f.lu[k * n + c]! * x[c]!;
    x[k] = s / f.lu[k * n + k]!;
  }
  return x;
}

/** RREF：返回 x0（最小自由变量=0 的特解）与零空间 Z (n×d) */
function reduceEqualities(Aeq: number[][], beq: number[]): { x0: Float64Array; Z: Float64Array; d: number; rank: number } | null {
  const m = Aeq.length;
  const n = Aeq[0]!.length;
  const R: number[][] = Aeq.map((row) => row.slice());
  const b = beq.slice();
  const pivotCols: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < m; c++) {
    let p = r;
    let mx = Math.abs(R[r]![c]!);
    for (let rr = r + 1; rr < m; rr++) { const v = Math.abs(R[rr]![c]!); if (v > mx) { mx = v; p = rr; } }
    if (mx < 1e-10) continue;
    if (p !== r) { [R[r], R[p]] = [R[p]!, R[r]!]; const t = b[r]!; b[r] = b[p]!; b[p] = t; }
    const d = R[r]![c]!;
    for (let cc = 0; cc < n; cc++) R[r]![cc] = R[r]![cc]! / d;
    b[r] = b[r]! / d;
    for (let rr = 0; rr < m; rr++) {
      if (rr === r) continue;
      const f = R[rr]![c]!;
      if (f === 0) continue;
      for (let cc = 0; cc < n; cc++) R[rr]![cc] = R[rr]![cc]! - f * R[r]![cc]!;
      b[rr] = b[rr]! - f * b[r]!;
    }
    pivotCols.push(c);
    r++;
  }
  if (r < m) {
    for (let rr = r; rr < m; rr++) if (Math.abs(b[rr]!) > 1e-6) return null; // 等式矛盾
  }
  const pivotSet = new Set(pivotCols);
  const freeCols: number[] = [];
  for (let c = 0; c < n; c++) if (!pivotSet.has(c)) freeCols.push(c);
  const x0 = new Float64Array(n);
  for (let i = 0; i < pivotCols.length; i++) x0[pivotCols[i]!] = b[i]!;
  const d = freeCols.length;
  const Z = new Float64Array(n * d);
  for (let j = 0; j < d; j++) {
    const f = freeCols[j]!;
    Z[f * d + j] = 1;
    for (let i = 0; i < pivotCols.length; i++) Z[pivotCols[i]! * d + j] = -R[i]![f]!;
  }
  return { x0, Z, d, rank: pivotCols.length };
}

export function solveWbcHard(i: WbcInput): WbcOutput {
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

  const aCom = [
    i.comKp * (i.comTarget[0] - m.com.x) - i.comKd * m.comVel.x,
    i.comKp * (i.comTarget[2] - m.com.y) - i.comKd * m.comVel.y,
    i.comKp * (i.comTarget[1] - m.com.z) - i.comKd * m.comVel.z,
  ];
  const Jcom = new Float64Array(NX * 3);
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
  for (let a = 0; a < NV; a++) P[a * NX + a] += 2 * i.wQdd;
  for (let a = I_S; a < NX; a++) P[a * NX + a] += 2 * i.wSlack;

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

  // 等式
  const Aeq: number[][] = [];
  const beq: number[] = [];
  for (let r = 0; r < 6; r++) {
    const row = new Array<number>(NX).fill(0);
    for (let k = 0; k < NV; k++) row[k] = m.M[r * NV + k]!;
    for (let s = 0; s < 6; s++) {
      row[I_FL + s] = -m.Jc[0]![s * NV + r]!;
      row[I_FR + s] = -m.Jc[1]![s * NV + r]!;
    }
    Aeq.push(row);
    beq.push(-m.h[r]!);
  }
  for (let foot = 0; foot < 2; foot++) {
    const Jc = m.Jc[foot]!;
    const Jd = m.JdotNu[foot]!;
    for (let r = 0; r < 6; r++) {
      const row = new Array<number>(NX).fill(0);
      for (let k = 0; k < NV; k++) row[k] = Jc[r * NV + k]!;
      Aeq.push(row);
      beq.push(-Jd[r]!);
    }
  }
  const red = reduceEqualities(Aeq, beq);
  if (!red) {
    return emptyFail(NX);
  }
  const { x0, Z, d } = red;
  const x = new Float64Array(NX);
  // 不等式 Aineq x ≤ bineq
  const Aineq: number[][] = [];
  const bineq: number[] = [];
  const add = (row: number[], b: number): void => { Aineq.push(row); bineq.push(b); };
  for (let r = 0; r < 18; r++) {
    const row = Array.from(tauRows[r]!);
    const up = row.slice(); up[I_S + 2 * r] = -1;
    add(up, i.tauMax[r]! - tauConst(r));
    const dn = row.map((v) => -v); dn[I_S + 2 * r + 1] = -1;
    add(dn, -i.tauMin[r]! + tauConst(r));
  }
  for (let r = 0; r < NS; r++) { const row = new Array<number>(NX).fill(0); row[I_S + r] = -1; add(row, 0); }
  for (let foot = 0; foot < 2; foot++) {
    const o = foot === 0 ? I_FL : I_FR;
    const c = m.contact[foot]!;
    const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
    const cf = new Array<number>(NX).fill(0); cf[fz] = -1; add(cf, 0);
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const row = new Array<number>(NX).fill(0);
      row[fx] = Math.cos(th); row[fy] = Math.sin(th); row[fz] = -i.mu;
      add(row, 0);
    }
    const my1 = new Array<number>(NX).fill(0); my1[my] = 1; my1[fz] = -0.2; add(my1, 0);
    const my2 = new Array<number>(NX).fill(0); my2[my] = -1; my2[fz] = -0.2; add(my2, 0);
    const rx1 = new Array<number>(NX).fill(0); rx1
[fz] = c.point.x - c.maxX; rx1[mz] = -1; add(rx1, 0);
    const rx2 = new Array<number>(NX).fill(0); rx2[fz] = c.minX - c.point.x; rx2[mz] = 1; add(rx2, 0);
    const rz1 = new Array<number>(NX).fill(0); rz1[fz] = c.point.z - c.maxZ; rz1[mx] = 1; add(rz1, 0);
    const rz2 = new Array<number>(NX).fill(0); rz2[fz] = c.minZ - c.point.z; rz2[mx] = -1; add(rz2, 0);
    const fzMax = 3 * m.mass * 9.81;
    const fmax = new Array<number>(NX).fill(0); fmax[fz] = 1; add(fmax, fzMax);
  }
  for (let a = 0; a < NV; a++) {
    const lim = a < 6 ? 200 : i.qddCap;
    const row = new Array<number>(NX).fill(0); row[a] = 1; add(row, lim); add(row.map((v) => -v), lim);
  }
  for (let a = I_FL; a < NV + 12; a++) { const row = new Array<number>(NX).fill(0); row[a] = 1; add(row, 5000); add(row.map((v) => -v), 5000); }
  for (let a = I_S; a < NX; a++) { const row = new Array<number>(NX).fill(0); row[a] = 1; add(row, 1e6); }

  // 零空间投影
  const Hr = new Float64Array(d * d);
  const gr = new Float64Array(d);
  const Px0g = new Float64Array(NX);
  for (let a = 0; a < NX; a++) { let s = 0; for (let b = 0; b < NX; b++) s += P[a * NX + b]! * x0[b]!; Px0g[a] = s + g[a]!; }
  for (let a = 0; a < d; a++) {
    let s = 0; for (let k = 0; k < NX; k++) s += Z[k * d + a]! * Px0g[k]!; gr[a] = s;
    for (let b = 0; b < d; b++) {
      let h = 0;
      for (let k = 0; k < NX; k++) {
        const zk = Z[k * d + a]!; if (zk === 0) continue;
        for (let l = 0; l < NX; l++) { const zl = Z[l * d + b]!; if (zl !== 0) h += zk * P[k * NX + l]! * zl; }
      }
      Hr[a * d + b] = h;
    }
  }
  const Ar: Float64Array[] = [];
  const br: number[] = [];
  for (let j = 0; j < Aineq.length; j++) {
    const row = Aineq[j]!;
    let ax0 = 0;
    for (let k = 0; k < NX; k++) ax0 += row[k]! * x0[k]!;
    const rr = new Float64Array(d);
    for (let a = 0; a < d; a++) { let s = 0; for (let k = 0; k < NX; k++) s += row[k]! * Z[k * d + a]!; rr[a] = s; }
    Ar.push(rr); br.push(bineq[j]! - ax0);
  }

  // 18 维 ADMM
  const rho = 1.0, sigma = 1e-6, alphaA = 1.6, maxIter = i.maxIter ?? 800;
  const AtA = new Float64Array(d * d);
  const At = new Float64Array(d * Aineq.length);
  for (let r = 0; r < Ar.length; r++) {
    const row = Ar[r]!;
    for (let a = 0; a < d; a++) {
      const va = row[a]!; if (va === 0) continue;
      At[a * Ar.length + r] = va;
      for (let b = 0; b < d; b++) { const vb = row[b]!; if (vb !== 0) AtA[a * d + b] += va * vb; }
    }
  }
  const K = new Float64Array(d * d);
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) K[a * d + b] = Hr[a * d + b]! + rho * AtA[a * d + b]!;
  for (let a = 0; a < d; a++) K[a * d + a] += sigma;
  const fac = luFactor(K, d);
  if (!fac) return emptyFail(NX);
  let z = new Float64Array(d);
  const s = new Float64Array(Ar.length);
  const y = new Float64Array(Ar.length);
  for (let r = 0; r < Ar.length; r++) { let v = 0; const row = Ar[r]!; for (let a = 0; a < d; a++) v += row[a]! * z[a]!; s[r] = Math.min(v, br[r]!); }
  let prim = Infinity, dual = Infinity, it = 0;
  const Az = new Float64Array(Ar.length);
  for (; it < maxIter; it++) {
    const rhs = new Float64Array(d);
    for (let a = 0; a < d; a++) rhs[a] = sigma * z[a]! - gr[a]!;
    for (let r = 0; r < Ar.length; r++) { const v = rho * (s[r]! - y[r]!); if (v === 0) continue; for (let a = 0; a < d; a++) rhs[a] += At[a * Ar.length + r]! * v; }
    const zn = luSolve(fac, d, rhs);
    let p = 0;
    for (let r = 0; r < Ar.length; r++) { let v = 0; const row = Ar[r]!; for (let a = 0; a < d; a++) v += row[a]! * zn[a]!; Az[r] = v; const sr = alphaA * v + (1 - alphaA) * s[r]! + y[r]!; const sn = Math.min(sr, br[r]!); p = Math.max(p, Math.abs(v - sn)); y[r] = sr - sn; s[r] = sn; }
    let dd = 0;
    for (let a = 0; a < d; a++) { let v = gr[a]!; for (let b = 0; b < d; b++) v += Hr[a * d + b]! * zn[b]!; for (let r = 0; r < Ar.length; r++) v += At[a * Ar.length + r]! * y[r]!; dd = Math.max(dd, Math.abs(v)); }
    z = zn; prim = p; dual = dd;
    if (prim < 1e-5 && dual < 1e-4) { it++; break; }
  }
  for (let a = 0; a < NX; a++) { let v = x0[a]!; for (let j = 0; j < d; j++) v += Z[a * d + j]! * z[j]!; x[a] = v; }
  let maxViol = 0;
  for (let j = 0; j < Aineq.length; j++) { let v = 0; const row = Aineq[j]!; for (let k = 0; k < NX; k++) v += row[k]! * x[k]!; maxViol = Math.max(maxViol, v - bineq[j]!); }
  let eqViol = 0;
  for (let r = 0; r < Aeq.length; r++) { let v = 0; const row = Aeq[r]!; for (let k = 0; k < NX; k++) v += row[k]! * x[k]!; eqViol = Math.max(eqViol, Math.abs(v - beq[r]!)); }
  const nuDot = x.slice(0, NV);
  const fL = x.slice(I_FL, I_FL + 6);
  const fR = x.slice(I_FR, I_FR + 6);
  const sTau = x.slice(I_S, I_S + NS);
  let sMax = 0;
  for (const v of sTau) sMax = Math.max(sMax, v);
  const tau = new Float64Array(18);
  for (let r = 0; r < 18; r++) { let v = tauConst(r); const row = tauRows[r]!; for (let k = 0; k < NX; k++) v += row[k]! * x[k]!; tau[r] = v; }
  let qddMax = 0, qddJointMax = 0, tauMax = 0;
  for (let k = 0; k < NV; k++) qddMax = Math.max(qddMax, Math.abs(nuDot[k]!));
  for (let k = 6; k < NV; k++) qddJointMax = Math.max(qddJointMax, Math.abs(nuDot[k]!));
  for (let k = 0; k < 18; k++) tauMax = Math.max(tauMax, Math.abs(tau[k]!));
  const finite = [nuDot, tau, fL, fR].every((arr) => Array.from(arr).every((v) => Number.isFinite(v)));
  const ok = finite && eqViol < 1e-3 && maxViol < 1e-3 && sMax < 1e-3;
  return { ok, nuDot, tau, fL, fR, sTau, sJoint: new Float64Array(0), maxViolation: Math.max(maxViol, eqViol, sMax), primalRes: prim, dualRes: dual, iterations: it, qddMax, qddJointMax, tauMax, slackMax: sMax, warmX: new Float64Array(0), warmZ: new Float64Array(0), warmY: new Float64Array(0) };
}

function emptyFail(n: number): WbcOutput {
  return { ok: false, nuDot: new Float64Array(NV), tau: new Float64Array(18), fL: new Float64Array(6), fR: new Float64Array(6), sTau: new Float64Array(0), sJoint: new Float64Array(0), maxViolation: Infinity, primalRes: Infinity, dualRes: Infinity, iterations: 0, qddMax: Infinity, qddJointMax: Infinity, tauMax: Infinity, slackMax: 0, warmX: new Float64Array(n), warmZ: new Float64Array(0), warmY: new Float64Array(0) };
}
