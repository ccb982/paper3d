export interface LegLevelingInput {
  contact: boolean;
  rollErr: number;
  pitchErr: number;
  hipRoll: number;
  hipPitch: number;
  maxHipRoll: number;
  maxHipPitch: number;
  kpRoll: number;
  kpPitch: number;
}

export interface LegLevelingOutput {
  active: boolean;
  hipRollCorr: number;
  hipPitchCorr: number;
  reason: 'none' | 'contact';
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planLegLeveling(i: LegLevelingInput): LegLevelingOutput {
  if (!i.contact) return { active: false, hipRollCorr: 0, hipPitchCorr: 0, reason: 'none' };
  const hipRollCorr = clamp(-i.kpRoll * i.rollErr - 0.2 * i.hipRoll, -Math.abs(i.maxHipRoll), Math.abs(i.maxHipRoll));
  const hipPitchCorr = clamp(-i.kpPitch * i.pitchErr - 0.2 * i.hipPitch, -Math.abs(i.maxHipPitch), Math.abs(i.maxHipPitch));
  return { active: true, hipRollCorr, hipPitchCorr, reason: 'contact' };
}
