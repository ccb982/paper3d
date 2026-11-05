import { planSagittal, type SagittalPlanInput, type SagittalPlan } from './sagittalPlanner';

export interface SagittalRightingInput extends SagittalPlanInput {
  relax: number;
  baseGateK?: number;
  kneeFlexK?: number;
}

export interface SagittalRightingOutput extends SagittalPlan {
  relax: number;
  baseGate: number;
  kneeHipFlex: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSagittalRighting(i: SagittalRightingInput): SagittalRightingOutput {
  const relax = clamp(i.relax, 0, 1);
  const baseGate = clamp(1 - (i.baseGateK ?? 0.8) * relax, 0, 1);
  const kneeHipFlex = Math.max(0, i.kneeFlexK ?? 0.12) * relax;
  const s = planSagittal(i);
  return { ...s, knee2Target: s.knee2Target - kneeHipFlex, relax, baseGate, kneeHipFlex };
}
