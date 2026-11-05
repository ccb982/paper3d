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
  const knee2Support = i.knee2Base
    + Math.max(0, Math.min(60, 200 * (i.hipLow ?? 0)))
    - Math.max(0, Math.min(0.3, 4 * (i.hipHigh ?? 0)))
    - kneeHipFlex;
  const hipFf = clamp(
    (i.heightK ?? 300) * (i.hipTargetY - i.hipAnchorY),
    -(i.heightCap ?? 40),
    i.heightCap ?? 40,
  );
  return { relax, baseGate, kneeHipFlex, knee2Support, hipFf };
}
