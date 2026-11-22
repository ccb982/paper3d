/** 矢状持续支撑命令：髋高 → 基础力门控、髋高前馈、膝支撑/下压。 */
export interface SagittalSupportInput {
  knee2Base: number;
  hipLow: number;
  hipHigh: number;
  hipTargetY: number;
  hipAnchorY: number;
  relax: number;
  baseGateK?: number;
  kneeFlexK?: number;
  heightK?: number;
  heightCap?: number;
}

export interface SagittalSupportOutput {
  relax: number;
  baseGate: number;
  kneeHipFlex: number;
  knee2Support: number;
  hipFf: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSagittalSupport(i: SagittalSupportInput): SagittalSupportOutput {
  const relax = clamp(i.relax, 0, 1);
  const baseGate = clamp(1 - (i.baseGateK ?? 0.8) * relax, 0, 1);
  const kneeHipFlex = Math.max(0, i.kneeFlexK ?? 0.12) * relax;
  const lowK = Math.max(0, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOW_K ?? 2));
  const lowCap = Math.max(0, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOW_CAP ?? 0.15));
  const highK = Math.max(0, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_HIGH_K ?? 0.5));
  const highCap = Math.max(0, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_HIGH_CAP ?? 0.10));
  const knee2Support = i.knee2Base
    + Math.min(lowCap, lowK * Math.max(0, i.hipLow ?? 0))
    - Math.min(highCap, highK * Math.max(0, i.hipHigh ?? 0))
    - kneeHipFlex;
  const hipFf = clamp(
    (i.heightK ?? 300) * (i.hipTargetY - i.hipAnchorY),
    -(i.heightCap ?? 40),
    i.heightCap ?? 40,
  );
  return { relax, baseGate, kneeHipFlex, knee2Support, hipFf };
}
