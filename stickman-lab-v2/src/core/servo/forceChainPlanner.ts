/** 矢状力链命令层：只生成 knee2/foot2 修正，不写执行器。 */
export interface ForceChainPlanInput {
  targetF: number;
  actualF: number;
  targetTauKnee: number;
  actualTauKnee: number;
  targetTauAnkle: number;
  actualTauAnkle: number;
  kF?: number;
  kTau?: number;
  cap?: number;
}

export interface ForceChainPlan {
  knee2Offset: number;
  foot2Offset: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planForceChain(i: ForceChainPlanInput): ForceChainPlan {
  const kF = i.kF ?? 0.002;
  const kT = i.kTau ?? 0.01;
  const cap = i.cap ?? 0.08;
  const eF = i.targetF - i.actualF;
  const eK = i.targetTauKnee - i.actualTauKnee;
  const eA = i.targetTauAnkle - i.actualTauAnkle;
  return {
    knee2Offset: clamp(kF * eF + kT * eK, -cap, cap),
    foot2Offset: clamp(kF * eF + kT * eA, -cap, cap),
  };
}
