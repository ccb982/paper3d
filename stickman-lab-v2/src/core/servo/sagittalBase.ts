/** 矢状基础力命令：IK 理论前馈 + 髋高反馈支撑，不参与回正调度。 */
import { computeSagittalSupport, type SagittalSupportInput } from './sagittalSupport';

export interface SagittalBaseIk {
  hip: number;
  knee: number;
  ankle: number;
}

export interface SagittalBaseInput extends SagittalSupportInput {
  ik: SagittalBaseIk | undefined;
}

export interface SagittalBaseOutput {
  hip: number;
  knee: number;
  ankle: number;
  relax: number;
  baseGate: number;
  kneeHipFlex: number;
  knee2Support: number;
  hipFf: number;
}

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export function computeSagittalBase(i: SagittalBaseInput): SagittalBaseOutput {
  const ik = i.ik;
  const support = computeSagittalSupport(i);
  return {
    hip: ik ? num('SQC_BASE_IK_SCALE_HIP', 0.7) * ik.hip : 0,
    knee: ik ? num('SQC_BASE_IK_SCALE_KNEE', 0.77) * ik.knee : 0,
    ankle: ik ? num('SQC_BASE_IK_SCALE_ANKLE', 0.8) * ik.ankle : 0,
    ...support,
  };
}
