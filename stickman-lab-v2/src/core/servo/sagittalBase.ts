/** 矢状基础力命令：只使用 IK 平衡解，不使用 base table / pairBase。 */
export interface SagittalBaseIk {
  hip: number;
  knee: number;
  ankle: number;
}

export interface SagittalBaseFf {
  hip: number;
  knee: number;
  ankle: number;
}

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export function computeSagittalBase(ik: SagittalBaseIk | undefined): SagittalBaseFf {
  if (!ik) return { hip: 0, knee: 0, ankle: 0 };
  return {
    hip: num('SQC_BASE_IK_SCALE_HIP', 0.7) * ik.hip,
    knee: num('SQC_BASE_IK_SCALE_KNEE', 0.77) * ik.knee,
    ankle: num('SQC_BASE_IK_SCALE_ANKLE', 0.8) * ik.ankle,
  };
}
