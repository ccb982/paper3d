/**
 * wbcId3.ts —— 论文 ID-WBC 的最小忠实简化
 *
 * base 6 + 左右 hip2/knee2/foot2 = 12 个 q̈
 * τ = 6，fL/fR = 12
 *
 * 约束：降维完整动力学 + 6D 接触 + CWC/摩擦/CoP + τ/q̈ 限制
 * 任务：posture + CoM + base + CoP
 */
import type { FloatingModel } from './floatingModel';
import { quatError } from './floatingModel';
import { solveQP } from 'quadprog';

const NB = 6;
const NJ = 18;
const NQ = NB + NJ;
const NT = 18;
const NF = 12;
const I_T = NQ;
const I_F = I_T + NT;
const I_SC = I_F + NF;
const NS_CONTACT = 0;
const I_SW = I_SC + NS_CONTACT;
const NS_CWC = 0;
const NX = I_SW + NS_CWC;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const envContactTol = (): number => {
  const raw = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_WBC_CONTACT_TOL;
  const v = Number(raw ?? 0.5);
  return Number.isFinite(v) ? v : 0.5;
};

export interface WbcId3Input {
  model: FloatingModel;
  /** 6 个 active 关节在 24 维模型中的索引：left hip2/knee2/foot2, right ... */
  active: number[];
  qActive: number[];
  qdActive: number[];
  qTargetActive: number[];
  qMin: number[];
  qMax: number[];
  dt: number;
  tauMin: number[];
  tauMax: number[];
  com: [number, number, number];
  comVel: [number, number, number];
  comTarget: [number, number, number];
  comKp: number;
  comKd: number;
  baseTarget: Parameters<typeof quatError>[0];
  baseKp: number;
  baseKd: number;
  postureKp: number;
  postureKd: number;
  mu: number;
  qddCap: number;
  copTargets?: [number, number][];
  wCom: number;
  wBase: number;
  wPost: number;
  wTau: number;
  wForce: number;
  wQdd: number;
  wCop: number;
  wWeight: number;
  weightTarget: number;
  wNormal: number;
  wContact: number;
  wCwc: number;
}

export interface WbcId3Output {
  ok: boolean;
  tau: Float64Array;
  fL: Float64Array;
  fR: Float64Array;
  qdd: Float64Array;
  sContact: Float64Array;
  sCwc: Float64Array;
  eqViol: number;
  maxViol: number;
  tauMax: number;
  qddMax: number;
  iterations: number;
}

export function solveWbcId3(i: WbcId3Input): WbcId3Output {
  const m = i.model;
  const A = [0, 1, 2, 3, 4, 5, ...i.active];
  if (A.length !== NQ) throw new Error(`wbcId3 active ${i.active.length} != ${NJ}`);

  const Mr = new Float64Array(NQ * NQ);
  const hr = new Float64Array(NQ);
  for (let r = 0; r < NQ; r++) {
    hr[r] = m.h[A[r]!]!;
    for (let c = 0; c < NQ; c++) Mr[r * NQ + c] = m.M[A[r]! * 24 + A[c]!]!;
  }

  const JcomR = new Float64Array(3 * NQ);
  for (let c = 0; c < NQ; c++) {
    const col = A[c]!;
    JcomR[0 * NQ + c] = m.Jcom[col]!;
    JcomR[1 * NQ + c] = m.Jcom[2 * 24 + col]!;
    JcomR[2 * NQ + c] = m.Jcom[24 + col]!;
  }

  const JbaseR = new Float64Array(3 * NQ);
  for (let c = 0; c < NQ; c++) {
    const col = A[c]!;
    JbaseR[0 * NQ + c] = m.Jbase[col]!;
    JbaseR[1 * NQ + c] = m.Jbase[24 + col]!;
    JbaseR[2 * NQ + c] = m.Jbase[2 * 24 + col]!;
  }

  const JcR: Float64Array[] = [];
  const Jd: Float64Array[] = [];
  for (let foot = 0; foot < 2; foot++) {
    const Jr = new Float64Array(6 * NQ);
    for (let r = 0; r < 6; r++) for (let c = 0; c < NQ; c++) Jr[r * NQ + c] = m.Jc[foot]![r * 24 + A[c]!]!;
    JcR.push(Jr);
    Jd.push(m.JdotNu[foot]!);
  }

  const envSign = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const fSign = String(envSign.SQC_WBC_ID3_FLIP_F ?? '0') === '1' ? 1 : -1;
  const frameDbg = envSign.SQC_WBC_ID3_FRAME;
  if (String(frameDbg ?? '0') === '1') {
    const gg = globalThis as { __ID3_FRAME?: number };
    if ((gg.__ID3_FRAME ?? 0) < 2) {
      gg.__ID3_FRAME = (gg.__ID3_FRAME ?? 0) + 1;
      let mMax = 0, hMax = 0, jcMax = 0, jdMax = 0;
      for (const v of Mr) mMax = Math.max(mMax, Math.abs(v));
      for (const v of hr) hMax = Math.max(hMax, Math.abs(v));
      for (const J of JcR) for (const v of J) jcMax = Math.max(jcMax, Math.abs(v));
      for (const J of Jd) for (const v of J) jdMax = Math.max(jdMax, Math.abs(v));
      console.log(`[ID3FRAME] Mmax=${mMax.toExponential(2)} hmax=${hMax.toExponential(2)} Jcmax=${jcMax.toExponential(2)} Jdmax=${jdMax.toExponential(2)} Jd0=${Array.from(Jd[0]!).map((v) => v.toFixed(2)).join(',')} Jd1=${Array.from(Jd[1]!).map((v) => v.toFixed(2)).join(',')}`);
    }
  }
  const staticDbg = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_WBC_ID3_STATIC;
  if (String(staticDbg ?? '0') === '1') {
    const gg = globalThis as { __ID3_STATIC?: number };
    if ((gg.__ID3_STATIC ?? 0) < 2) {
      gg.__ID3_STATIC = (gg.__ID3_STATIC ?? 0) + 1;
      const fL = new Float64Array(6); fL[1] = m.mass * 9.81 / 2;
      const fR = new Float64Array(6); fR[1] = m.mass * 9.81 / 2;
      let baseRes = 0;
      for (let r = 0; r < NB; r++) {
        let v = hr[r]!;
        for (let s2 = 0; s2 < 6; s2++) v += fSign * (JcR[0]![s2 * NQ + r]! * fL[s2]! + JcR[1]![s2 * NQ + r]! * fR[s2]!);
        baseRes = Math.max(baseRes, Math.abs(v));
      }
      let tauMax = 0;
      for (let k = 0; k < NJ; k++) {
        let v = hr[NB + k]!;
        for (let s2 = 0; s2 < 6; s2++) v += fSign * (JcR[0]![s2 * NQ + NB + k]! * fL[s2]! + JcR[1]![s2 * NQ + NB + k]! * fR[s2]!);
        tauMax = Math.max(tauMax, Math.abs(v));
      }
      let jdMax = 0;
      for (let f = 0; f < 2; f++) for (const v of Jd[f]!) jdMax = Math.max(jdMax, Math.abs(v));
      console.log(`[ID3STATIC] baseRes=${baseRes.toFixed(1)} tauMax=${tauMax.toFixed(1)} JdMax=${jdMax.toFixed(2)} fz=${(m.mass * 9.81 / 2).toFixed(0)}`);
    }
  }
  const staticSolve = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_WBC_ID3_STATIC_SOLVE === '1';
  if (staticSolve) {
    const rankOf = (rows: number[][], cols: number): number => {
      const a = rows.map((r) => r.slice());
      let rank = 0;
      for (let c = 0; c < cols && rank < a.length; c++) {
        let p = rank;
        for (let r = rank + 1; r < a.length; r++) if (Math.abs(a[r]![c] ?? 0) > Math.abs(a[p]![c] ?? 0)) p = r;
        if (Math.abs(a[p]![c] ?? 0) < 1e-9) continue;
        [a[rank], a[p]] = [a[p]!, a[rank]!];
        const d = a[rank]![c]!;
        for (let cc = 0; cc < cols; cc++) a[rank]![cc] = (a[rank]![cc] ?? 0) / d;
        for (let r = 0; r < a.length; r++) {
          if (r === rank) continue;
          const f = a[r]![c] ?? 0;
          if (Math.abs(f) < 1e-12) continue;
          for (let cc = 0; cc < cols; cc++) a[r]![cc] = (a[r]![cc] ?? 0) - f * (a[rank]![cc] ?? 0);
        }
        rank++;
      }
      return rank;
    };
    const jb: number[][] = [];
    const aug: number[][] = [];
    for (let r = 0; r < 6; r++) {
      const row: number[] = [];
      for (let foot = 0; foot < 2; foot++) for (let s2 = 0; s2 < 6; s2++) row.push(JcR[foot]![s2 * NQ + r]!);
      jb.push(row.slice());
      aug.push([...row, hr[r]!]);
    }
    console.log(`[ID3RANK] rank(Jb)=${rankOf(jb, 12)} rank([Jb|h])=${rankOf(aug, 13)} h=${Array.from(hr.slice(0, 6)).map((v) => v.toFixed(1)).join(',')}`);
    const g0 = globalThis as { __ID3_STATIC_SOLVE?: number };
    if ((g0.__ID3_STATIC_SOLVE ?? 0) < 2) {
      g0.__ID3_STATIC_SOLVE = (g0.__ID3_STATIC_SOLVE ?? 0) + 1;
      for (const sgn of [1, -1]) {
        const n = 12;
        const D = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
        for (let a = 1; a <= n; a++) D[a]![a] = 2;
        const Aeq: number[][] = [];
        const beq: number[] = [];
        for (let r = 0; r < 6; r++) {
          const row = new Array<number>(n + 1).fill(0);
          for (let foot = 0; foot < 2; foot++) for (let s2 = 0; s2 < 6; s2++) row[1 + foot * 6 + s2] = JcR[foot]![s2 * NQ + r]!;
          Aeq.push(row);
          beq.push(sgn * hr[r]!);
        }
        const Aineq: number[][] = [];
        const bineq: number[] = [];
        const noCwcStatic = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_WBC_ID3_STATIC_NOCWC ?? '0') === '1';
        if (!noCwcStatic) for (let foot = 0; foot < 2; foot++) {
          const o = foot * 6;
          const c = m.contact[foot]!;
          const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
          const lin = (r: number[], b: number): void => { const row = new Array<number>(n + 1).fill(0); for (let i = 0; i < n; i++) row[1 + i] = r[i] ?? 0; Aineq.push(row); bineq.push(b); };
          { const row = new Array<number>(n).fill(0); row[fy] = -1; lin(row, 0); }
          for (let k = 0; k < 8; k++) { const th = k * Math.PI / 4; const row = new Array<number>(n).fill(0); row[fx] = Math.cos(th); row[fz] = Math.sin(th); row[fy] = -i.mu; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[my] = 1; row[fy] = -0.2; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[my] = -1; row[fy] = -0.2; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[fy] = c.point.x - c.maxX; row[mz] = -1; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[fy] = c.minX - c.point.x; row[mz] = 1; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[fy] = c.point.z - c.maxZ; row[mx] = 1; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[fy] = c.minZ - c.point.z; row[mx] = -1; lin(row, 0); }
          { const row = new Array<number>(n).fill(0); row[fy] = 1; lin(row, 3 * m.mass * 9.81); }
        }
        for (let k = 0; k < n; k++) { const lo = new Array<number>(n + 1).fill(0); lo[k + 1] = -1; Aineq.push(lo); bineq.push(5000); const hi = new Array<number>(n + 1).fill(0); hi[k + 1] = 1; Aineq.push(hi); bineq.push(5000); }
        const q = Aeq.length + Aineq.length;
        const Amat = Array.from({ length: n + 1 }, () => new Array<number>(q + 1).fill(0));
        const bvec = new Array<number>(q + 1).fill(0);
        for (let j = 1; j <= Aeq.length; j++) { bvec[j] = beq[j - 1]!; for (let a = 1; a <= n; a++) Amat[a]![j] = Aeq[j - 1]![a]!; }
        for (let j = 1; j <= Aineq.length; j++) { bvec[Aeq.length + j] = -bineq[j - 1]!; for (let a = 1; a <= n; a++) Amat[a]![Aeq.length + j] = -Aineq[j - 1]![a]!; }
        const res = solveQP(D, new Array<number>(n + 1).fill(0), Amat, bvec, Aeq.length);
        if (res.message) { console.log('[ID3SOLVE] sign', sgn, 'message', res.message); continue; }
        const sol = res.solution!;
        const f = new Float64Array(12); for (let k = 0; k < 12; k++) f[k] = sol[k + 1]!;
        let baseRes = 0;
        for (let r = 0; r < 6; r++) { let v = 0; for (let foot = 0; foot < 2; foot++) for (let s2 = 0; s2 < 6; s2++) v += JcR[foot]![s2 * NQ + r]! * f[foot * 6 + s2]!; baseRes = Math.max(baseRes, Math.abs(v - sgn * hr[r]!)); }
        let tauMax = 0;
        for (let k = 0; k < NJ; k++) { let v = 0; for (let foot = 0; foot < 2; foot++) for (let s2 = 0; s2 < 6; s2++) v += JcR[foot]![s2 * NQ + NB + k]! * f[foot * 6 + s2]!; tauMax = Math.max(tauMax, Math.abs(hr[NB + k]! - v)); }
        console.log(`[ID3SOLVE] sign=${sgn} baseRes=${baseRes.toFixed(2)} tauMax=${tauMax.toFixed(1)} fL=${Array.from(f.slice(0, 6)).map((v) => v.toFixed(0)).join(',')} fR=${Array.from(f.slice(6)).map((v) => v.toFixed(0)).join(',')}`);
      }
    }
  }
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

  const aCom: [number, number, number] = [
    i.comKp * (i.comTarget[0] - i.com[0]) - i.comKd * i.comVel[0] - m.JdotComNu[0]!,
    i.comKp * (i.comTarget[1] - i.com[1]) - i.comKd * i.comVel[1] - m.JdotComNu[2]!,
    i.comKp * (i.comTarget[2] - i.com[2]) - i.comKd * i.comVel[2] - m.JdotComNu[1]!,
  ];
  const JcomQ = new Float64Array(NX * 3);
  for (let a = 0; a < NQ; a++) for (let r = 0; r < 3; r++) JcomQ[a * 3 + r] = JcomR[r * NQ + a]!;
  addTask(JcomQ, 3, aCom, i.wCom);

  const rErr = quatError(i.baseTarget, m.baseQuat);
  const aBase: [number, number, number] = [
    i.baseKp * rErr.x - i.baseKd * m.baseOmega.x - m.JdotBaseNu[0]!,
    i.baseKp * rErr.y - i.baseKd * m.baseOmega.y - m.JdotBaseNu[1]!,
    i.baseKp * rErr.z - i.baseKd * m.baseOmega.z - m.JdotBaseNu[2]!,
  ];
  const JbaseQ = new Float64Array(NX * 3);
  for (let a = 0; a < NQ; a++) for (let r = 0; r < 3; r++) JbaseQ[a * 3 + r] = JbaseR[r * NQ + a]!;
  addTask(JbaseQ, 3, aBase, i.wBase);

  const qddStar: number[] = [];
  for (let k = 0; k < NJ; k++) qddStar.push(i.postureKp * (i.qTargetActive[k]! - i.qActive[k]!) - i.postureKd * i.qdActive[k]!);
  const Jpost = new Float64Array(NX * NJ);
  for (let k = 0; k < NJ; k++) Jpost[(NB + k) * NJ + k] = 1;
  addTask(Jpost, NJ, qddStar, i.wPost);


  for (let a = 0; a < NQ; a++) P[a * NX + a] += 2 * i.wQdd;
  for (let a = I_T; a < I_T + NT; a++) P[a * NX + a] += 2 * i.wTau;
  for (let a = I_F; a < I_F + NF; a++) P[a * NX + a] += 2 * i.wForce;
  for (let a = 0; a < NX; a++) P[a * NX + a] += 1e-8;

  const Aeq: number[][] = [];
  const beq: number[] = [];
  for (let r = 0; r < NQ; r++) {
    const row = new Array<number>(NX).fill(0);
    for (let c = 0; c < NQ; c++) row[c] = Mr[r * NQ + c]!;
    for (let s = 0; s < 6; s++) {
      row[I_F + s] = fSign * JcR[0]![s * NQ + r]!;
      row[I_F + 6 + s] = fSign * JcR[1]![s * NQ + r]!;
    }
    if (r >= NB) row[I_T + (r - NB)] = -1;
    Aeq.push(row);
    beq.push(-hr[r]!);
  }
  const envDbg = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const noContact = String(envDbg.SQC_WBC_ID3_NO_CONTACT ?? '0') === '1';
  if (!noContact) for (let foot = 0; foot < 2; foot++) {
    for (let r = 0; r < 6; r++) {
      const row = new Array<number>(NX).fill(0);
      for (let c = 0; c < NQ; c++) row[c] = JcR[foot]![r * NQ + c]!;
      Aeq.push(row);
      beq.push(-Jd[foot]![r]!);
    }
  }

  const Aineq: number[][] = [];
  const bineq: number[] = [];
  const add = (row: number[], b: number): void => { Aineq.push(row); bineq.push(b); };

  const noCwc = String(envDbg.SQC_WBC_ID3_NO_CWC ?? '0') === '1';
  if (!noCwc) for (let foot = 0; foot < 2; foot++) {
    const o = I_F + foot * 6;
    const c = m.contact[foot]!;
    const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
    const addC = (row: number[], bb: number): void => { add(row, bb); };
    const cf = new Array<number>(NX).fill(0); cf[fy] = -1; addC(cf, 0);
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const row = new Array<number>(NX).fill(0);
      row[fx] = Math.cos(th); row[fz] = Math.sin(th); row[fy] = -i.mu;
      addC(row, 0);
    }
    const my1 = new Array<number>(NX).fill(0); my1[my] = 1; my1[fy] = -0.2; addC(my1, 0);
    const my2 = new Array<number>(NX).fill(0); my2[my] = -1; my2[fy] = -0.2; addC(my2, 0);
    const rx1 = new Array<number>(NX).fill(0); rx1[fy] = c.point.x - c.maxX; rx1[mz] = -1; addC(rx1, 0);
    const rx2 = new Array<number>(NX).fill(0); rx2[fy] = c.minX - c.point.x; rx2[mz] = 1; addC(rx2, 0);
    const rz1 = new Array<number>(NX).fill(0); rz1[fy] = c.point.z - c.maxZ; rz1[mx] = 1; addC(rz1, 0);
    const rz2 = new Array<number>(NX).fill(0); rz2[fy] = c.minZ - c.point.z; rz2[mx] = -1; addC(rz2, 0);
    const fmax = new Array<number>(NX).fill(0); fmax[fy] = 1; addC(fmax, 3 * m.mass * 9.81);
  }

  const noTau = String(envDbg.SQC_WBC_ID3_NO_TAU ?? '0') === '1';
  if (!noTau) for (let k = 0; k < NT; k++) {
    const lo = new Array<number>(NX).fill(0); lo[I_T + k] = -1; add(lo, -i.tauMin[k]!);
    const hi = new Array<number>(NX).fill(0); hi[I_T + k] = 1; add(hi, i.tauMax[k]!);
  }

  const noQdd = String(envDbg.SQC_WBC_ID3_NO_QDD ?? '0') === '1';
  if (!noQdd) for (let a = 0; a < NQ; a++) {
    let loLim = -200, hiLim = 200;
    if (a >= NB) {
      const k = a - NB;
      const q = i.qActive[k]!, qd = i.qdActive[k]!, dt = Math.max(1e-4, i.dt);
      const margin = 0.01;
      hiLim = 2 * (i.qMax[k]! - margin - q - qd * dt) / (dt * dt);
      loLim = 2 * (i.qMin[k]! + margin - q - qd * dt) / (dt * dt);
      if (!Number.isFinite(hiLim)) hiLim = 1e6;
      if (!Number.isFinite(loLim)) loLim = -1e6;
    }
    if (loLim > hiLim) { const mid = 0.5 * (loLim + hiLim); loLim = mid; hiLim = mid; }
    const lo = new Array<number>(NX).fill(0); lo[a] = -1; add(lo, -loLim);
    const hi = new Array<number>(NX).fill(0); hi[a] = 1; add(hi, hiLim);
  }
  for (let a = I_F; a < I_F + NF; a++) {
    const lo = new Array<number>(NX).fill(0); lo[a] = -1; add(lo, 5000);
    const hi = new Array<number>(NX).fill(0); hi[a] = 1; add(hi, 5000);
  }

  const q = Aeq.length + Aineq.length;
  const Dmat: number[][] = Array.from({ length: NX + 1 }, () => new Array<number>(NX + 1).fill(0));
  const dvec: number[] = new Array<number>(NX + 1).fill(0);
  for (let a = 1; a <= NX; a++) {
    dvec[a] = -g[a - 1]!;
    for (let b = 1; b <= NX; b++) Dmat[a]![b] = P[(a - 1) * NX + (b - 1)]!;
    Dmat[a]![a] += 1e-8;
  }
  const Amat: number[][] = Array.from({ length: NX + 1 }, () => new Array<number>(q + 1).fill(0));
  const bvec: number[] = new Array<number>(q + 1).fill(0);
  for (let j = 1; j <= Aeq.length; j++) {
    const row = Aeq[j - 1]!;
    bvec[j] = beq[j - 1]!;
    for (let a = 1; a <= NX; a++) Amat[a]![j] = row[a - 1]!;
  }
  for (let j = 1; j <= Aineq.length; j++) {
    const row = Aineq[j - 1]!;
    bvec[Aeq.length + j] = -bineq[j - 1]!;
    for (let a = 1; a <= NX; a++) Amat[a]![Aeq.length + j] = -row[a - 1]!;
  }

  const res = solveQP(Dmat, dvec, Amat, bvec, Aeq.length);
  if (res.message) {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    if (String(env.SQC_WBC_ID3_DBG ?? '0') === '1') console.log('[ID3] message', res.message, 'NX', NX, 'Aeq', Aeq.length, 'Aineq', Aineq.length);
    return { ok: false, tau: new Float64Array(NT), fL: new Float64Array(6), fR: new Float64Array(6), qdd: new Float64Array(NQ), sContact: new Float64Array(NS_CONTACT), sCwc: new Float64Array(NS_CWC), eqViol: Infinity, maxViol: Infinity, tauMax: Infinity, qddMax: Infinity, iterations: 0 };
  }
  const sol = res.solution!;
  const x = new Float64Array(NX);
  for (let a = 1; a <= NX; a++) x[a - 1] = sol[a]!;

  let maxViol = 0;
  for (let j = 0; j < Aineq.length; j++) {
    let v = 0;
    const row = Aineq[j]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    maxViol = Math.max(maxViol, v - bineq[j]!);
  }
  let eqViol = 0;
  for (let r = 0; r < Aeq.length; r++) {
    let v = 0;
    const row = Aeq[r]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    eqViol = Math.max(eqViol, Math.abs(v - beq[r]!));
  }
  const tau = x.slice(I_T, I_T + NT);
  const fL = x.slice(I_F, I_F + 6);
  const fR = x.slice(I_F + 6, I_F + 12);
  const qdd = x.slice(0, NQ);
  const sContact = x.slice(I_SC, I_SC + NS_CONTACT);
  const sCwc = x.slice(I_SW, I_SW + NS_CWC);
  let sContactMax = 0;
  for (const v of sContact) sContactMax = Math.max(sContactMax, Math.abs(v));
  let sCwcMax = 0;
  for (const v of sCwc) sCwcMax = Math.max(sCwcMax, Math.abs(v));
  let tauMax = 0, qddMax = 0;
  for (const v of tau) tauMax = Math.max(tauMax, Math.abs(v));
  for (const v of qdd) qddMax = Math.max(qddMax, Math.abs(v));
  const finite = [tau, fL, fR, qdd].every((arr) => Array.from(arr).every((v) => Number.isFinite(v)));
  const ok = finite && eqViol < 1e-3 && maxViol < 1e-3 && sContactMax < envContactTol() && sCwcMax < 50;
  return { ok, tau, fL, fR, qdd, sContact, sCwc, eqViol, maxViol, tauMax, qddMax, iterations: res.iterations?.[1] ?? 0 };
}
