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
}

export interface MuscleDampingOutput {
  kp: number;
  kd: number;
  tauDyn: number;
  tauAcc: number;
  cap: number;
  scale: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeMuscleDamping(i: MuscleDampingInput): MuscleDampingOutput {
  const mass = Math.max(1e-6, i.mass);
  const wn = Math.max(1e-3, i.wn);
  const zeta = Math.max(0, i.zeta);
  const amax = Number.isFinite(i.amax) && i.amax > 0 ? i.amax : Infinity;
  const c0 = Math.max(1e-3, i.c0 ?? 0.5);
  const scale = clamp(i.c / c0, 0, 2);
  const cap = mass * amax;
  const kp = mass * wn * wn * scale;
  const kd = 2 * zeta * mass * wn * scale;
  const tauDamp = clamp(-kd * (i.vel ?? 0), -cap, cap);
  const tauAcc = clamp((i.accGain ?? 0) * ((i.accRef ?? 0) - (i.acc ?? 0)), -cap, cap);
  return { kp, kd, tauDyn: tauDamp, tauAcc, cap, scale };
}
