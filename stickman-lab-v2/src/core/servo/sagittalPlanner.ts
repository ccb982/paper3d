/** 矢状命令层：只生成 hip2/knee2 目标与髋高度前馈，不写执行器。 */
export interface SagittalPlanInput {
  hip2Base: number;
  knee2Base: number;
  foot2Base: number;
  hipTargetY: number;
  hipAnchorY: number;
  eSag: number;
  hipLow?: number;
  hipHigh?: number;
  hip0Base?: number;
  hip1Base?: number;
  eHipZ?: number;
  roll?: number;
  hipZK?: number;
  roll0K?: number;
  roll1K?: number;
  hip0Cap?: number;
  hip1Cap?: number;
  leanHipK?: number;
  leanKneeK?: number;
  leanAnkleK?: number;
  heightK?: number;
  heightCap?: number;
}

export interface SagittalPlan {
  hip2Target: number;
  knee2Target: number;
  foot2Target: number;
  hipFf: number;
  hip0Target: number;
  hip1Target: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planSagittal(i: SagittalPlanInput): SagittalPlan {
  const leanHipK = i.leanHipK ?? -2;
  const leanKneeK = i.leanKneeK ?? -4;
  const leanAnkleK = i.leanAnkleK ?? 0;
  const heightK = i.heightK ?? 300;
  const heightCap = i.heightCap ?? 40;
  const gap = i.hipTargetY - i.hipAnchorY;
  const hip0Target = (i.hip0Base ?? 0) + clamp((i.hipZK ?? 0.2) * (i.eHipZ ?? 0) + (i.roll0K ?? 0.2) * (i.roll ?? 0), -(i.hip0Cap ?? 0.08), i.hip0Cap ?? 0.08);
  const hip1Target = (i.hip1Base ?? 0) + clamp((i.roll1K ?? 0.2) * (i.roll ?? 0), -(i.hip1Cap ?? 0.06), i.hip1Cap ?? 0.06);
  return {
    // 髋层之前只有 base，leanHipK/heightK 都没写进来；这里补上矢状髋回正。
    hip2Target: i.hip2Base + leanHipK * i.eSag,
    knee2Target: i.knee2Base + leanKneeK * i.eSag + Math.max(0, Math.min(60, 200 * (i.hipLow ?? 0))) - Math.max(0, Math.min(0.3, 4 * (i.hipHigh ?? 0))),
    foot2Target: i.foot2Base + leanAnkleK * i.eSag,
    hipFf: clamp(heightK * gap, -heightCap, heightCap),
    hip0Target,
    hip1Target,
  };
}
