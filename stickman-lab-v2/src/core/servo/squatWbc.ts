/**
 * squatWbc.ts —— 蹲姿命令层的两段 PD（唯一命令层）
 *
 *   PD·大腿段  solveSquatHipDynamics   → hip2 + knee2 基础力（CoM 空间 PD → Jᵀ）
 *   PD·小腿段  solveSquatShankDynamics → foot2 基础力（CoP 位置 P）
 *
 * 只输出基础力矩，不写执行器：
 *   muscle(): τ = 基础力 + (−b·qd) + (−k·softzone)
 *   drive.td = −B·ω（Bmax = 0.8·I_low/dt）
 *
 * 两段都只做“期望力/位置误差 → 广义力”的映射；
 * 关节限位、阻尼、被动刚度仍归执行层/PD 外层，不在这里重复。
 */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const finite = (v: number): boolean => Number.isFinite(v);

export interface SquatHipDynamicsInput {
  /** CoM 顺序 x / z / y（与 jCom 行一致） */
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  /** 3 行 × 2 列：行 = CoM 的 x/z/y，列 = hip2/knee2 */
  jCom: [number, number][];
  /** hip2 / knee2 的静态载荷（同 applied 符号） */
  h: [number, number];
  tauMin: [number, number];
  tauMax: [number, number];
  /** CoM 空间 PD：N/m 与 N·s/m */
  kpF?: number;
  kdF?: number;
}

/** CoM 空间 PD → Jᵀ → 关节基础力。 */
export function solveSquatHipDynamics(i: SquatHipDynamicsInput): [number, number] {
  const kpF = i.kpF ?? 600;
  const kdF = i.kdF ?? 60;
  const f = [0, 1, 2].map((k) => kpF * (i.comTarget[k]! - i.com[k]!) - kdF * i.comVel[k]!);
  const out: [number, number] = [i.h[0], i.h[1]];
  for (let k = 0; k < 3; k++) {
    const j = i.jCom[k]!;
    out[0] += j[0]! * f[k]!;
    out[1] += j[1]! * f[k]!;
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
  copMin: number;
  copMax: number;
  fz: number;
  /** foot2 的静态载荷（同 applied 符号） */
  h: number;
  tauMin: number;
  tauMax: number;
  /** CoP P 增益（本项目 foot2 力矩正方向与 CoP 正方向相反，默认负） */
  kpCop?: number;
  /** 相对 h 的附加力矩上限 */
  copCap?: number;
}

/** CoP 位置 P → foot2 基础力；用 CoP 支撑域与 Δτ 上限做硬钳位。 */
export function solveSquatShankDynamics(i: SquatShankDynamicsInput): number {
  const kpCop = i.kpCop ?? -0.6;
  const cap = Math.abs(i.copCap ?? 30);
  const fz = Math.max(0, finite(i.fz) ? i.fz : 0);
  const cop = finite(i.cop) ? i.cop : 0;
  const copTarget = finite(i.copTarget) ? i.copTarget : cop;
  const loCop = Math.min(i.copMin, i.copMax);
  const hiCop = Math.max(i.copMin, i.copMax);
  const h = finite(i.h) ? i.h : 0;
  const tauRaw = h + (copTarget - cop) * fz * kpCop;
  const tauLo = h + (loCop - cop) * fz * kpCop;
  const tauHi = h + (hiCop - cop) * fz * kpCop;
  const lo = Math.max(i.tauMin, Math.min(tauLo, tauHi), h - cap);
  const hi = Math.min(i.tauMax, Math.max(tauLo, tauHi), h + cap);
  if (lo > hi) return clamp(h, i.tauMin, i.tauMax);
  const out = clamp(tauRaw, lo, hi);
  return finite(out) ? out : clamp(h, i.tauMin, i.tauMax);
}
