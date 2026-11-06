import type { HipRightingStrategyOutput } from './hipRightingStrategy';

export interface HipCommandInput {
  baseHip0Target: number;
  baseHip1Target: number;
  baseHip2Target: number;
  baseGatedFf: number;
  hipRightFf: number;
  relax: number;
  hipOn: boolean;
  rightStrength: number;
  strategy: HipRightingStrategyOutput;
  hip2Target: number;
  hip2Actual: number;
  hip2TrackFfK: number;
  hip2TrackFfCap: number;
}

export interface HipCommandOutput {
  hip0Target: number;
  hip1Target: number;
  hip2Target: number;
  hipFf: number;
  hip2TrackFf: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHipCommand(i: HipCommandInput): HipCommandOutput {
  const hip2Err = i.hip2Target - i.hip2Actual;
  const hip2TrackFf = clamp(i.hip2TrackFfK * hip2Err, -Math.abs(i.hip2TrackFfCap), Math.abs(i.hip2TrackFfCap));
  return {
    hip0Target: i.baseHip0Target + (i.hipOn ? i.strategy.hip0Delta : 0),
    hip1Target: i.baseHip1Target + (i.hipOn ? i.strategy.hip1Delta : 0),
    hip2Target: i.hip2Target,
    hipFf: i.baseGatedFf + i.hipRightFf * (1 - 0.8 * i.relax) + (i.hipOn ? i.rightStrength * i.strategy.hipFf : 0) + hip2TrackFf,
    hip2TrackFf,
  };
}
