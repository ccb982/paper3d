export interface HipStrategyInput {
  mass: number;
  height: number;
  comX: number;
  comVX: number;
  targetX: number;
  comZ: number;
  comVZ: number;
  targetZ: number;
  contact: boolean;
  ankleTau: number;
  ankleTauMax: number;
  copMargin: number;
  kp?: number;
  kd?: number;
  accMax?: number;
  tauMax?: number;
  marginMin?: number;
  ankleRatio?: number;
}

export interface HipStrategyOutput {
  active: boolean;
  ax: number;
  az: number;
  tauSagittal: number;
  tauLateral: number;
  reason: 'none' | 'ankle-sat' | 'cop-margin' | 'no-contact';
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planHipStrategy(i: HipStrategyInput): HipStrategyOutput {
  const mass = Math.max(1e-6, i.mass);
  const h = Math.max(0.1, i.height);
  const kp = Math.max(0, i.kp ?? 6);
  const kd = Math.max(0, i.kd ?? 3);
  const accMax = Math.max(0, i.accMax ?? 3);
  const tauMax = Math.max(0, i.tauMax ?? 15);
  const marginMin = Math.max(0, i.marginMin ?? 0.015);
  const ankleRatio = Math.max(0, i.ankleRatio ?? 0.75);
  if (!i.contact) return { active: false, ax: 0, az: 0, tauSagittal: 0, tauLateral: 0, reason: 'no-contact' };
  const ankleSat = Math.abs(i.ankleTau) >= ankleRatio * Math.max(1, Math.abs(i.ankleTauMax));
  const marginLow = i.copMargin <= marginMin;
  if (!ankleSat && !marginLow) return { active: false, ax: 0, az: 0, tauSagittal: 0, tauLateral: 0, reason: 'none' };
  const omega = Math.sqrt(9.81 / h);
  const ex = i.targetX - i.comX;
  const ez = i.targetZ - i.comZ;
  const ax = clamp(kp * ex - kd * i.comVX, -accMax, accMax);
  const az = clamp(kp * ez - kd * i.comVZ, -accMax, accMax);
  const tauSagittal = clamp(-mass * h * ax, -tauMax, tauMax);
  const tauLateral = clamp(-mass * h * az, -tauMax, tauMax);
  return { active: true, ax, az, tauSagittal, tauLateral, reason: ankleSat ? 'ankle-sat' : 'cop-margin' };
}
