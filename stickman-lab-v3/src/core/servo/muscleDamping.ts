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
  /** 当前位置误差（用于 softGate / SRS） */
  dev?: number;
  /** 被动短期刚度占 baseK 的比例；0=无被动 */
  srsFrac?: number;
  /** 被动短期刚度绝对值（N·m/rad），优先于 srsFrac */
  srsK?: number;
  /** 短期刚度 yield 位移（rad） */
  srsYield?: number;
  /** eccentric / concentric 阻尼倍率 */
  eccGain?: number;
  conGain?: number;
  /** 阻尼速度尺度（rad/s） */
  vRef?: number;
  /** 阻尼力矩上限；用于把惯性上限和真实执行器能力分开 */
  tauCap?: number;
  /** 阻尼软度；默认跟 soft，可单独给支撑腿更高阻尼 */
  softD?: number;
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
  kPassive: number;
  dScale: number;
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
  const cap = Math.max(mass * amax, Math.max(0, i.tauCap ?? 0));
  const baseK = i.cmdK !== undefined && i.cmdK >= 0 ? i.cmdK : mass * wn * wn * scale;
  const baseD = i.cmdD !== undefined && i.cmdD >= 0 ? i.cmdD : 2 * zeta * mass * wn * scale;
  const dev = i.dev ?? 0;
  const vel = i.vel ?? 0;
  const srsK = i.srsK !== undefined ? Math.max(0, i.srsK) : Math.max(0, i.srsFrac ?? 0.5) * baseK;
  const srsYield = Math.max(1e-3, i.srsYield ?? 0.06);
  const kPassive = srsK * Math.exp(-Math.abs(dev) / srsYield);
  const kp = (baseK + kPassive) * soft;
  const vRef = Math.max(1e-3, i.vRef ?? 2);
  const move = Math.min(1, Math.abs(vel) / vRef);
  const ecc = dev * vel < 0 ? move : 0;
  const con = dev * vel > 0 ? move : 0;
  const dScale = Math.max(0.2, 1 + (i.eccGain ?? 0.5) * ecc - (i.conGain ?? 0.3) * con);
  const softD = clamp(i.softD ?? soft, 0, 1);
  const kd = baseD * softD * dScale;
  const tauDamp = clamp(-kd * vel, -cap, cap);
  const tauAcc = clamp((i.accGain ?? 0) * ((i.accRef ?? 0) - (i.acc ?? 0)), -cap, cap);
  return { kp, kd, tauDyn: tauDamp, tauAcc, cap, scale, soft, kPassive: kPassive * soft, dScale };
}
