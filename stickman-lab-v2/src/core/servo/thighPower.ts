export interface ThighPowerInput {
  eSag: number;
  eSagV: number;
  contact: boolean;
  enabled: boolean;
  kSag: number;
  dSag: number;
  forceCap: number;
  lever: number;
  torqueCap: number;
  budget?: number;
}

export interface ThighPowerOutput {
  force: number;
  hip2Ff: number;
  active: boolean;
  budget: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeThighPower(i: ThighPowerInput): ThighPowerOutput {
  const budget = clamp(i.budget ?? 1, 0, 1);
  const raw = i.kSag * i.eSag + i.dSag * i.eSagV;
  const force = clamp(raw, -Math.abs(i.forceCap), Math.abs(i.forceCap));
  const hip2Ff = clamp(force * Math.abs(i.lever), -Math.abs(i.torqueCap), Math.abs(i.torqueCap));
  const active = i.enabled && i.contact;
  return {
    force: active ? force : 0,
    hip2Ff: active ? hip2Ff : 0,
    active,
    budget,
  };
}
