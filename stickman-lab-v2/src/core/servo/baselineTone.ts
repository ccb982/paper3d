export type BaselineTonePhase = 'PRELOAD' | 'SETTLE' | 'STABLE' | 'PERTURB' | 'RIGHTING' | 'FALLBACK';

export interface BaselineToneInput {
  side: 'l' | 'r';
  phase: BaselineTonePhase;
  contact: boolean;
  loadRatio: number;
  enabled: boolean;
  hip0Ff: number;
  hip1Ff: number;
  hip2Ff: number;
  knee2Ff: number;
}

export interface BaselineToneOutput {
  hip0Ff: number;
  hip1Ff: number;
  hip2Ff: number;
  knee2Ff: number;
  phaseScale: number;
  contactScale: number;
  loadScale: number;
  active: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export function computeBaselineTone(i: BaselineToneInput): BaselineToneOutput {
  const phaseScale = clamp(num(`SQC_TONE_PHASE_${i.phase}`, 1), 0, 2);
  const contactScale = i.contact ? clamp(num('SQC_TONE_CONTACT', 1), 0, 1.5) : 0;
  const loadScale = clamp(num('SQC_TONE_LOAD_K', 0) * i.loadRatio + num('SQC_TONE_LOAD_B', 1), 0.5, 1.5);
  const active = i.enabled && i.contact;
  const scale = active ? phaseScale * contactScale * loadScale : 0;
  return {
    hip0Ff: i.hip0Ff * scale,
    hip1Ff: i.hip1Ff * scale,
    hip2Ff: i.hip2Ff * scale,
    knee2Ff: i.knee2Ff * scale,
    phaseScale,
    contactScale,
    loadScale,
    active,
  };
}
