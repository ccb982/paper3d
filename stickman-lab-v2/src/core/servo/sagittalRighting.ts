/** 矢状方向回正命令：只输出方向增量，基础目标由 baseSagittal 提供。 */
export interface SagittalRightingInput {
  eSag: number;
  eHipZ: number;
  roll: number;
  hipZK?: number;
  roll0K?: number;
  roll1K?: number;
  hip0Cap?: number;
  hip1Cap?: number;
  leanHipK?: number;
  leanKneeK?: number;
  leanAnkleK?: number;
  enabled?: boolean;
}

export interface SagittalRightingOutput {
  hip2Delta: number;
  knee2Delta: number;
  foot2Delta: number;
  hip0Delta: number;
  hip1Delta: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSagittalRighting(i: SagittalRightingInput): SagittalRightingOutput {
  const on = i.enabled ?? true;
  const eSag = on ? i.eSag : 0;
  const eHipZ = on ? i.eHipZ : 0;
  const roll = on ? i.roll : 0;
  return {
    hip2Delta: (i.leanHipK ?? -2) * eSag,
    knee2Delta: (i.leanKneeK ?? -4) * eSag,
    foot2Delta: (i.leanAnkleK ?? 0) * eSag,
    hip0Delta: clamp((i.hipZK ?? 0.2) * eHipZ + (i.roll0K ?? 0.2) * roll, -(i.hip0Cap ?? 0.08), i.hip0Cap ?? 0.08),
    hip1Delta: clamp((i.roll1K ?? 0.2) * roll, -(i.hip1Cap ?? 0.06), i.hip1Cap ?? 0.06),
  };
}
