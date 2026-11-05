/** 矢状方向回正命令：只输出方向修正，不输出基础/支撑。 */
export interface SagittalRightingInput {
  hip2Base: number;
  foot2Base: number;
  eSag: number;
  hip0Base: number;
  hip1Base: number;
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
  hip2Target: number;
  knee2Delta: number;
  foot2Target: number;
  hip0Target: number;
  hip1Target: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSagittalRighting(i: SagittalRightingInput): SagittalRightingOutput {
  const on = i.enabled ?? true;
  const eSag = on ? i.eSag : 0;
  const eHipZ = on ? i.eHipZ : 0;
  const roll = on ? i.roll : 0;
  return {
    hip2Target: i.hip2Base + (i.leanHipK ?? -2) * eSag,
    knee2Delta: (i.leanKneeK ?? -4) * eSag,
    foot2Target: i.foot2Base + (i.leanAnkleK ?? 0) * eSag,
    hip0Target: i.hip0Base + clamp((i.hipZK ?? 0.2) * eHipZ + (i.roll0K ?? 0.2) * roll, -(i.hip0Cap ?? 0.08), i.hip0Cap ?? 0.08),
    hip1Target: i.hip1Base + clamp((i.roll1K ?? 0.2) * roll, -(i.hip1Cap ?? 0.06), i.hip1Cap ?? 0.06),
  };
}
