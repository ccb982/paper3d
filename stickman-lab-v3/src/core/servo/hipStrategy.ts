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
  hipWeight: number;
  ankleScale: number;
  reason: 'none' | 'preload' | 'ankle-sat' | 'cop-margin' | 'no-contact';
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
  if (!i.contact) return { active: false, ax: 0, az: 0, tauSagittal: 0, tauLateral: 0, hipWeight: 0, ankleScale: 1, reason: 'no-contact' };
  const cap = Math.max(1, Math.abs(i.ankleTauMax));
  const ankleLoad = clamp(Math.abs(i.ankleTau) / cap, 0, 1);
  const marginLoad = clamp(1 - i.copMargin / Math.max(1e-6, marginMin), 0, 1);
  const hipWeight = clamp(0.15 + 0.45 * ankleLoad + 0.40 * marginLoad, 0, 0.85);
  const hipPreload = clamp(0.20 + 0.35 * marginLoad, 0, 0.55);
  const weight = Math.max(hipWeight, hipPreload);
  const ankleScale = 1 - 0.40 * weight;
  const omega = Math.sqrt(9.81 / h);
  const ex = i.targetX - i.comX;
  const ez = i.targetZ - i.comZ;
  const ax = clamp(kp * ex - kd * i.comVX, -accMax, accMax);
  const az = clamp(kp * ez - kd * i.comVZ, -accMax, accMax);
  const tauSagittal = clamp(-mass * h * ax, -tauMax, tauMax) * weight;
  const tauLateral = clamp(-mass * h * az, -tauMax, tauMax) * weight;
  const reason = ankleLoad > ankleRatio ? 'ankle-sat' : marginLoad > 0.1 ? 'cop-margin' : 'preload';
  return { active: true, ax, az, tauSagittal, tauLateral, hipWeight: weight, ankleScale, reason };
}
