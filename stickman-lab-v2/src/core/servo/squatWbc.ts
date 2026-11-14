/**
 * squatWbc.ts —— 蹲姿命令层（正式）
 *
 * 命令层只输出基础力矩：
 *   CoM 段：CoM 空间 PD/前馈力 → J_comᵀ → hip2/knee2
 *   CoP 段：CoP 误差 P/D → 踝力矩 → foot2
 *
 * 执行层：
 *   muscle: τ = 基础力矩 + (−b·qd) + (−k·softzone)
 *   drive.td = −B·ω
 *
 * 两段都是 reduced inverse dynamics：h + JᵀF，不含 M·q̈ 和显式 Jcᵀf。
 * 动态/多接触场景再升级完整 ID；QP 不是命令层的必需品。
 */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const finite = (v: number): boolean => Number.isFinite(v);

export interface SquatHipDynamicsInput {
  /** CoM 顺序 x / z / y（与 jCom 行一致） */
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  /** 期望 CoM 速度；默认 0，用于阻尼/前馈 */
  comVelTarget?: [number, number, number];
  /** CoM 空间 PD：N/m 与 N·s/m */
  kpF?: number;
  kdF?: number;
  /** 额外任务力前馈（N，x/z/y） */
  forceFeed?: [number, number, number];
  /** 3 行 × 2 列：行 = CoM 的 x/z/y，列 = hip2/knee2 */
  jCom: [number, number][];
  /** hip2 / knee2 的静态载荷（同执行层符号） */
  h: [number, number];
  tauMin: [number, number];
  tauMax: [number, number];
  /** 可选的关节姿态次级任务（低权重，用于选蹲姿） */
  q?: [number, number];
  qd?: [number, number];
  qTarget?: [number, number];
  postureKp?: number;
  postureKd?: number;
  postureWeight?: number;
}

/** CoM 空间 PD/前馈力 → Jᵀ → 关节基础力矩。 */
export function solveSquatHipDynamics(i: SquatHipDynamicsInput): [number, number] {
  const kpF = i.kpF ?? 600;
  const kdF = i.kdF ?? 60;
  const vTarget = i.comVelTarget ?? [0, 0, 0];
  const feed = i.forceFeed ?? [0, 0, 0];
  const f: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const e = i.comTarget[k]! - i.com[k]!;
    const ev = (vTarget[k] ?? 0) - i.comVel[k]!;
    const v = kpF * e + kdF * ev + (feed[k] ?? 0);
    f[k] = finite(v) ? v : 0;
  }
  const out: [number, number] = [i.h[0], i.h[1]];
  for (let k = 0; k < 3; k++) {
    const j = i.jCom[k]!;
    out[0] += (j[0] ?? 0) * f[k];
    out[1] += (j[1] ?? 0) * f[k];
  }
  const pw = Math.max(0, i.postureWeight ?? 0);
  if (pw > 0 && i.q && i.qd && i.qTarget) {
    const pkp = i.postureKp ?? 20;
    const pkd = i.postureKd ?? 1;
    for (let k = 0; k < 2; k++) {
      const tp = pkp * (i.qTarget[k]! - i.q[k]!) - pkd * i.qd[k]!;
      out[k] += pw * (finite(tp) ? tp : 0);
    }
  }
  for (let k = 0; k < 2; k++) {
    if (!finite(out[k]!)) out[k] = i.h[k]!;
    out[k] = clamp(out[k]!, i.tauMin[k]!, i.tauMax[k]!);
  }
  return out;
}

export interface SquatShankDynamicsInput {
  cop: number;
  copTarget: number;
  /** CoP 速度/期望速度，用于 D 项；默认 0 */
  copVel?: number;
  copVelTarget?: number;
  copMin: number;
  copMax: number;
  fz: number;
  /** foot2 的静态载荷（同 applied 符号） */
  h: number;
  /** 可选踝力矩前馈（同 applied 符号） */
  tauFeed?: number;
  tauMin: number;
  tauMax: number;
  /** CoP P 增益（本项目 foot2 力矩正方向与 CoP 正方向相反，默认负） */
  kpCop?: number;
  /** CoP D 增益（无量纲，乘 fz） */
  kdCop?: number;
  /** 相对基础力矩的附加力矩上限 */
  copCap?: number;
  /** 可选的踝关节姿态次级任务（低权重） */
  q?: number;
  qd?: number;
  qTarget?: number;
  postureKp?: number;
  postureKd?: number;
  postureWeight?: number;
}

/** CoP 位置 P/D → foot2 基础力矩；支撑域与 Δτ 双向钳位。 */
export function solveSquatShankDynamics(i: SquatShankDynamicsInput): number {
  const kpCop = i.kpCop ?? -3;
  const kdCop = i.kdCop ?? 0;
  const cap = Math.abs(i.copCap ?? 80);
  const fz = Math.max(0, finite(i.fz) ? i.fz : 0);
  const cop = finite(i.cop) ? i.cop : 0;
  const copTarget = finite(i.copTarget) ? i.copTarget : cop;
  const copVel = finite(i.copVel ?? 0) ? (i.copVel ?? 0) : 0;
  const copVelTarget = finite(i.copVelTarget ?? 0) ? (i.copVelTarget ?? 0) : 0;
  const loCop = Math.min(i.copMin, i.copMax);
  const hiCop = Math.max(i.copMin, i.copMax);
  const h = finite(i.h) ? i.h : 0;
  const tauFeed = finite(i.tauFeed ?? 0) ? (i.tauFeed ?? 0) : 0;
  const base = h + tauFeed;
  const pTerm = (copTarget - cop) * fz * kpCop;
  const dTerm = (copVelTarget - copVel) * fz * kdCop;
  let tauAdd = 0;
  const pw = Math.max(0, i.postureWeight ?? 0);
  if (pw > 0 && i.q !== undefined && i.qd !== undefined && i.qTarget !== undefined) {
    const tp = (i.postureKp ?? 20) * (i.qTarget - i.q) - (i.postureKd ?? 1) * i.qd;
    tauAdd = pw * (finite(tp) ? tp : 0);
  }
  const tauRaw = base + pTerm + dTerm + tauAdd;
  const tauLo = base + (loCop - cop) * fz * kpCop;
  const tauHi = base + (hiCop - cop) * fz * kpCop;
  const lo = Math.max(i.tauMin, Math.min(tauLo, tauHi), base - cap);
  const hi = Math.min(i.tauMax, Math.max(tauLo, tauHi), base + cap);
  if (lo > hi) return clamp(base, i.tauMin, i.tauMax);
  const out = clamp(tauRaw, lo, hi);
  return finite(out) ? out : clamp(base, i.tauMin, i.tauMax);
}
