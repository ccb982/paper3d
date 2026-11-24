export interface MuscleDampingInput {
  mass: number;
  wn: number;
  zeta: number;
  amax: number;
  c: number;
  c0?: number;
  acc?: number;
  accRef?: number;
  accGain?: number;
  vel?: number;
  /** 命令层直接给的目标刚度/阻尼 */
  cmdK?: number;
  cmdD?: number;
  /** 软硬覆盖；undefined = 由 softGate 决定 */
  soft?: number;
  /** 当前位置误差（用于 softGate） */
  dev?: number;
}

export interface SoftGateInput {
  vel: number;
  acc: number;
  dev: number;
  softMin?: number;
  vScale?: number;
  aScale?: number;
  xScale?: number;
}

export interface MuscleDampingOutput {
  kp: number;
  kd: number;
  tauDyn: number;
  tauAcc: number;
  cap: number;
  scale: number;
  soft: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSoftGate(i: SoftGateInput): number {
  const softMin = clamp(i.softMin ?? 0.5, 0, 1);
  const vScale = Math.max(1e-3, i.vScale ?? 2);
  const aScale = Math.max(1e-3, i.aScale ?? 20);
  const xScale = Math.max(1e-3, i.xScale ?? 0.5);
  const motion = Math.max(Math.abs(i.vel) / vScale, Math.abs(i.acc) / aScale, Math.abs(i.dev) / xScale);
  return clamp(1 - motion, softMin, 1);
}

export function computeMuscleDamping(i: MuscleDampingInput): MuscleDampingOutput {
  const mass = Math.max(1e-6, i.mass);
  const wn = Math.max(1e-3, i.wn);
  const zeta = Math.max(0, i.zeta);
  const amax = Number.isFinite(i.amax) && i.amax > 0 ? i.amax : Infinity;
  const c0 = Math.max(1e-3, i.c0 ?? 0.5);
  const scale = clamp(i.c / c0, 0, 2);
  const soft = clamp(i.soft ?? 1, 0, 1);
  const cap = mass * amax;
  const baseK = i.cmdK !== undefined && i.cmdK >= 0 ? i.cmdK : mass * wn * wn * scale;
  const baseD = i.cmdD !== undefined && i.cmdD >= 0 ? i.cmdD : 2 * zeta * mass * wn * scale;
  const kp = baseK * soft;
  const kd = baseD * soft;
  const tauDamp = clamp(-kd * (i.vel ?? 0), -cap, cap);
  const tauAcc = clamp((i.accGain ?? 0) * ((i.accRef ?? 0) - (i.acc ?? 0)), -cap, cap);
  return { kp, kd, tauDyn: tauDamp, tauAcc, cap, scale, soft };
}
