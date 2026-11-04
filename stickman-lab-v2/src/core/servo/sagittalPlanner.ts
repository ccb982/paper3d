/** 矢状命令层：只生成 hip2/knee2 目标与髋高度前馈，不写执行器。 */
export interface SagittalPlanInput {
  hip2Base: number;
  knee2Base: number;
  foot2Base: number;
  hipTargetY: number;
  hipAnchorY: number;
  eSag: number;
  hipLow?: number;
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
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planSagittal(i: SagittalPlanInput): SagittalPlan {
  const leanHipK = i.leanHipK ?? -2;
  const leanKneeK = i.leanKneeK ?? -4;
  const leanAnkleK = i.leanAnkleK ?? 0;
  const heightK = i.heightK ?? 300;
  const heightCap = i.heightCap ?? 40;
  const gap = i.hipTargetY - i.hipAnchorY;
  return {
    hip2Target: i.hip2Base,
    knee2Target: i.knee2Base + leanKneeK * i.eSag + Math.max(0, Math.min(60, 200 * (i.hipLow ?? 0))),
    foot2Target: i.foot2Base + leanAnkleK * i.eSag,
    hipFf: 0,
  };
}
