/**
 * wbcHard.ts —— 论文级浮动基 WBC QP
 *
 * 变量：x = [q̈(24), fL(6), fR(6), sContact(12), sCwc(2)]
 * 等式：base 6 自由度动力学 + 双脚 fz 和 = mg
 * 不等式：接触加速度软约束（逐分量 slack）、CWC 软约束（每脚一个 slack）、
 *         关节力矩硬约束、q̈/力/ slack 边界
 * 成本：CoM 任务（含 J̇ν）、base 姿态任务（含 J̇ν）、姿态任务、q̈/f/τ 正则、
 *       接触 slack 高惩罚、CWC slack 高惩罚
 *
 * 对应 Kuindersma/Atlas 的 contact slack、Feng 的 soft contact/CoP、
 * Koolen 的 QP（输出加速度 + GRW，再由逆动力学得到力矩）。
 * 不使用 stale hold：QP 不可行就回退执行层，不在旧解上保持。
 */
import type { FloatingModel } from './floatingModel';
import { quatError } from './floatingModel';
import type { WbcInput, WbcOutput } from './wbc';
import { solveQP } from 'quadprog';

const NV = 24;
const NF = 12;
const I_FL = NV;
const I_FR = NV + 6;
const I_SCONTACT = NV + NF;
const NS_CONTACT = 12;
const I_SCWC = I_SCONTACT + NS_CONTACT;
const NS_CWC = 32;
const NX = I_SCWC + NS_CWC;

const envNum = (name: string, def: number): number => {
  const raw = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[name];
  if (raw === undefined) return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
};

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

  // CoM 任务：a* = kp(err) - kd(vel) - J̇ν（论文里的 J q̈ = a* - J̇q̇）
  const aCom = [
    i.comKp * (i.comTarget[0] - m.com.x) - i.comKd * m.comVel.x - m.JdotComNu[0]!,
    i.comKp * (i.comTarget[2] - m.com.y) - i.comKd * m.comVel.y - m.JdotComNu[1]!,
    i.comKp * (i.comTarget[1] - m.com.z) - i.comKd * m.comVel.z - m.JdotComNu[2]!,
  ];
  const Jcom = new Float64Array(NX * 3);
  for (let a = 0; a < NV; a++) {
    Jcom[a * 3 + 0] = m.Jcom[a]!;
    Jcom[a * 3 + 1] = m.Jcom[NV + a]!;
    Jcom[a * 3 + 2] = m.Jcom[2 * NV + a]!;
  }
  addTask(Jcom, 3, aCom, i.wCom);

  // base 姿态任务
  const rErr = quatError(i.baseTarget, m.baseQuat);
  const aBase = [
    i.baseKp * rErr.x - i.baseKd * m.baseOmega.x - m.JdotBaseNu[0]!,
    i.baseKp * rErr.y - i.baseKd * m.baseOmega.y - m.JdotBaseNu[1]!,
    i.baseKp * rErr.z - i.baseKd * m.baseOmega.z - m.JdotBaseNu[2]!,
  ];
  const Jbase = new Float64Array(NX * 3);
  for (let a = 0; a < NV; a++) {
    Jbase[a * 3 + 0] = m.Jbase[a]!;
    Jbase[a * 3 + 1] = m.Jbase[NV + a]!;
    Jbase[a * 3 + 2] = m.Jbase[2 * NV + a]!;
  }
  addTask(Jbase, 3, aBase, i.wBase);

  // 关节姿态任务
  const qddStar = i.q18.map((q, k) => i.postureKp * (i.qTarget18[k]! - q) - i.postureKd * i.qd18[k]!);
  const Jpost = new Float64Array(NX * 18);
  for (let k = 0; k < 18; k++) Jpost[(6 + k) * 18 + k] = 1;
  addTask(Jpost, 18, qddStar, i.wPost);

  // 论文式 CoP 任务：mz - fz*(px - copX*) = 0, mx - fz*(copZ* - pz) = 0
  const Jcop = new Float64Array(NX * 4);
  for (let foot = 0; foot < 2; foot++) {
    const o = foot === 0 ? I_FL : I_FR;
    const p = m.contact[foot]!.point;
    const fz = o + 2, mx = o + 3, mz = o + 5;
    const rowX = foot * 2 + 0;
    Jcop[mz * 4 + rowX] = 1;
    Jcop[fz * 4 + rowX] = -(p.x - p.x);
    const rowZ = foot * 2 + 1;
    Jcop[mx * 4 + rowZ] = 1;
    Jcop[fz * 4 + rowZ] = -(p.z - p.z);
  }
  addTask(Jcop, 4, [0, 0, 0, 0], i.wCop ?? 10);

  // 侧向力分配：抑制左右腿内部侧向力 fL_y - fR_y
  const Jflat = new Float64Array(NX * 1);
  Jflat[(I_FL + 1) * 1 + 0] = 1;
  Jflat[(I_FR + 1) * 1 + 0] = -1;
  addTask(Jflat, 1, [0], i.wForceLat ?? 1);
  if (envNum('SQC_WBC_TASK_DBG', 0) === 1) {
    const g = globalThis as { __WBC_TASK_DBG?: number };
    if ((g.__WBC_TASK_DBG ?? 0) < 2) {
      g.__WBC_TASK_DBG = (g.__WBC_TASK_DBG ?? 0) + 1;
      console.log('[TASK]', JSON.stringify({ com: m.com, comTarget: i.comTarget, aCom, baseQuat: m.baseQuat, baseTarget: i.baseTarget, aBase, qddStar, qddStarMax: Math.max(...qddStar.map((v) => Math.abs(v))) }));
    }
  }

  for (let a = 0; a < NV; a++) P[a * NX + a] += 2 * i.wQdd;
  for (let a = I_FL; a < I_FR + 6; a++) P[a * NX + a] += 2 * (i.wForce ?? 1e-3);
  for (let a = I_SCONTACT; a < I_SCONTACT + NS_CONTACT; a++) P[a * NX + a] += 2 * (i.wContact ?? 1e4);
  for (let a = I_SCWC; a < I_SCWC + NS_CWC; a++) P[a * NX + a] += 2 * (i.wCwc ?? 1e3);

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

  // ── 等式 ──
  const Aeq: number[][] = [];
  const beq: number[] = [];
  // base 6：M_b q̈ + h_b - Jc_bᵀ f = 0
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
  // 双脚 fz 和 = mg
  {
    const row = new Array<number>(NX).fill(0);
    row[I_FL + 2] = 1;
    row[I_FR + 2] = 1;
    Aeq.push(row);
    beq.push(m.mass * 9.81);
  }

  // ── 不等式 Aineq x ≤ bineq ──
  const Aineq: number[][] = [];
  const bineq: number[] = [];
  const add = (row: number[], b: number): void => { Aineq.push(row); bineq.push(b); };

  // 接触加速度软约束：|Jc q̈ + J̇cν| ≤ sContact
  for (let foot = 0; foot < 2; foot++) {
    const Jc = m.Jc[foot]!;
    const Jd = m.JdotNu[foot]!;
    for (let r = 0; r < 6; r++) {
      const idx = I_SCONTACT + foot * 6 + r;
      const row = new Array<number>(NX).fill(0);
      for (let k = 0; k < NV; k++) row[k] = Jc[r * NV + k]!;
      row[idx] = -1;
      add(row, -Jd[r]!);
      const row2 = new Array<number>(NX).fill(0);
      for (let k = 0; k < NV; k++) row2[k] = -Jc[r * NV + k]!;
      row2[idx] = -1;
      add(row2, Jd[r]!);
    }
  }

  // CWC 软约束：逐行 slack，定位 fz/摩擦/my/CoP 哪一行在松
  for (let foot = 0; foot < 2; foot++) {
    const o = foot === 0 ? I_FL : I_FR;
    const c = m.contact[foot]!;
    const fx = o, fy = o + 1, fz = o + 2, mx = o + 3, my = o + 4, mz = o + 5;
    const base = I_SCWC + foot * 16;
    let cwcRow = 0;
    const addC = (row: number[], bb: number): void => { row[base + cwcRow] = -1; add(row, bb); cwcRow++; };
    const cf = new Array<number>(NX).fill(0); cf[fz] = -1; addC(cf, 0);
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const row = new Array<number>(NX).fill(0);
      row[fx] = Math.cos(th); row[fy] = Math.sin(th); row[fz] = -i.mu;
      addC(row, 0);
    }
    const my1 = new Array<number>(NX).fill(0); my1[my] = 1; my1[fz] = -0.2; addC(my1, 0);
    const my2 = new Array<number>(NX).fill(0); my2[my] = -1; my2[fz] = -0.2; addC(my2, 0);
    const rx1 = new Array<number>(NX).fill(0); rx1[fz] = c.point.x - c.maxX; rx1[mz] = -1; addC(rx1, 0);
    const rx2 = new Array<number>(NX).fill(0); rx2[fz] = c.minX - c.point.x; rx2[mz] = 1; addC(rx2, 0);
    const rz1 = new Array<number>(NX).fill(0); rz1[fz] = c.point.z - c.maxZ; rz1[mx] = 1; addC(rz1, 0);
    const rz2 = new Array<number>(NX).fill(0); rz2[fz] = c.minZ - c.point.z; rz2[mx] = -1; addC(rz2, 0);
    const fzMax = 3 * m.mass * 9.81;
    const fmax = new Array<number>(NX).fill(0); fmax[fz] = 1; addC(fmax, fzMax);
  }

  // 力矩硬约束（执行器上限由 squatClean 的 capAt 传入）
  for (let r = 0; r < 18; r++) {
    const up = Array.from(tauRows[r]!);
    add(up, i.tauMax[r]! - tauConst(r));
    const dn = Array.from(tauRows[r]!, (v) => -v);
    add(dn, -i.tauMin[r]! + tauConst(r));
  }

  // q̈ 边界
  for (let a = 0; a < NV; a++) {
    const lim = a < 6 ? 200 : i.qddCap;
    const row = new Array<number>(NX).fill(0); row[a] = 1; add(row, lim); add(row.map((v) => -v), lim);
  }
  // 力边界
  for (let a = I_FL; a < I_FR + 6; a++) {
    const row = new Array<number>(NX).fill(0); row[a] = 1; add(row, 5000); add(row.map((v) => -v), 5000);
  }
  // slack 边界与正性
  for (let k = 0; k < NS_CONTACT; k++) {
    const row = new Array<number>(NX).fill(0); row[I_SCONTACT + k] = 1; add(row, 100);
    const neg = new Array<number>(NX).fill(0); neg[I_SCONTACT + k] = -1; add(neg, 0);
  }
  for (let k = 0; k < NS_CWC; k++) {
    const row = new Array<number>(NX).fill(0); row[I_SCWC + k] = 1; add(row, 1e6);
    const neg = new Array<number>(NX).fill(0); neg[I_SCWC + k] = -1; add(neg, 0);
  }

  // ── quadprog：min -dᵀx + 0.5xᵀDx, Aᵀx ≥ b；前 meq 条等式 ──
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
    if (envNum('SQC_WBC_QP_DBG', 0) === 1) console.log('[QP] message', res.message, 'meq', Aeq.length, 'q', q);
    return emptyFail(NX);
  }
  const sol = res.solution!;
  const x = new Float64Array(NX);
  for (let a = 1; a <= NX; a++) x[a - 1] = sol[a]!;
  const it = res.iterations?.[1] ?? 0;

  let maxViol = 0, maxRow = -1;
  for (let j = 0; j < Aineq.length; j++) {
    let v = 0;
    const row = Aineq[j]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    const vv = v - bineq[j]!;
    if (vv > maxViol) { maxViol = vv; maxRow = j; }
  }
  if (maxViol > 1e-3 && envNum('SQC_WBC_QP_DBG', 0) === 1) {
    const row = Aineq[maxRow]!;
    const nz: string[] = [];
    for (let k = 0; k < NX; k++) if (Math.abs(row[k] ?? 0) > 1e-9) nz.push(`${k}=${row[k]!.toFixed(1)}`);
    console.log(`[QP] maxViol=${maxViol.toFixed(2)} row=${maxRow} b=${bineq[maxRow]?.toFixed(2)} nz=${nz.slice(0, 12).join(',')}`);
  }
  let eqViol = 0;
  for (let r = 0; r < Aeq.length; r++) {
    let v = 0;
    const row = Aeq[r]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    eqViol = Math.max(eqViol, Math.abs(v - beq[r]!));
  }

  const nuDot = x.slice(0, NV);
  const fL = x.slice(I_FL, I_FL + 6);
  const fR = x.slice(I_FR, I_FR + 6);
  const sContact = x.slice(I_SCONTACT, I_SCONTACT + NS_CONTACT);
  const sCwc = x.slice(I_SCWC, I_SCWC + NS_CWC);
  let sContactMax = 0;
  for (const v of sContact) sContactMax = Math.max(sContactMax, v);
  let sCwcMax = 0, sCwcMaxIdx = -1;
  for (let k = 0; k < sCwc.length; k++) { const v = sCwc[k]!; if (v > sCwcMax) { sCwcMax = v; sCwcMaxIdx = k; } }
  if (sCwcMax > 1e-3 && envNum('SQC_WBC_CWC_DBG', 0) === 1) {
    const g = globalThis as { __WBC_CWC_DBG?: number };
    if ((g.__WBC_CWC_DBG ?? 0) < 4) {
      g.__WBC_CWC_DBG = (g.__WBC_CWC_DBG ?? 0) + 1;
      const row = sCwcMaxIdx >= 16 ? sCwcMaxIdx - 16 : sCwcMaxIdx;
      console.log(`[CWC] foot=${sCwcMaxIdx >= 16 ? 'R' : 'L'} row=${row} slack=${sCwcMax.toFixed(2)} all=${Array.from(sCwc).map((v) => v.toFixed(1)).join(',')}`);
    }
  }

  const tau = new Float64Array(18);
  for (let r = 0; r < 18; r++) {
    let v = tauConst(r);
    const row = tauRows[r]!;
    for (let k = 0; k < NX; k++) v += row[k]! * x[k]!;
    tau[r] = v;
  }
  let qddMax = 0, qddJointMax = 0, tauMax = 0;
  for (let k = 0; k < NV; k++) qddMax = Math.max(qddMax, Math.abs(nuDot[k]!));
  for (let k = 6; k < NV; k++) qddJointMax = Math.max(qddJointMax, Math.abs(nuDot[k]!));
  for (let k = 0; k < 18; k++) tauMax = Math.max(tauMax, Math.abs(tau[k]!));
  const finite = [nuDot, tau, fL, fR].every((arr) => Array.from(arr).every((v) => Number.isFinite(v)));
  const contactTol = envNum('SQC_WBC_CONTACT_TOL', 0.05);
  const cwcTol = envNum('SQC_WBC_CWC_TOL', 50);
  const ok = finite && eqViol < 1e-3 && maxViol < 1e-3 && sContactMax < contactTol && sCwcMax < cwcTol;

  return {
    ok,
    nuDot,
    tau,
    fL,
    fR,
    sTau: new Float64Array(0),
    sJoint: new Float64Array(0),
    sCwc,
    sContact,
    sContactMax,
    sCwcMax,
    maxViolation: Math.max(maxViol, eqViol, sContactMax, sCwcMax),
    primalRes: 0,
    dualRes: 0,
    iterations: it,
    qddMax,
    qddJointMax,
    tauMax,
    slackMax: Math.max(sContactMax, sCwcMax),
    warmX: new Float64Array(0),
    warmZ: new Float64Array(0),
    warmY: new Float64Array(0),
  };
}

function emptyFail(n: number): WbcOutput {
  return {
    ok: false,
    nuDot: new Float64Array(NV),
    tau: new Float64Array(18),
    fL: new Float64Array(6),
    fR: new Float64Array(6),
    sTau: new Float64Array(0),
    sJoint: new Float64Array(0),
    sCwc: new Float64Array(0),
    sContact: new Float64Array(0),
    sContactMax: Infinity,
    sCwcMax: Infinity,
    maxViolation: Infinity,
    primalRes: Infinity,
    dualRes: Infinity,
    iterations: 0,
    qddMax: Infinity,
    qddJointMax: Infinity,
    tauMax: Infinity,
    slackMax: Infinity,
    warmX: new Float64Array(n),
    warmZ: new Float64Array(0),
    warmY: new Float64Array(0),
  };
}
