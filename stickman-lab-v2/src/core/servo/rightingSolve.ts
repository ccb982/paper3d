/**
 * 力链修复求解：在 tau/CoP/摩擦约束内求最近的目标修正。
 * 输出修正量，不写执行器。
 */
import type { ActualForceChain } from './actualForceChain';

export interface RightingTargetIK {
  F: { x: number; y: number; z: number };
  cop: { x: number; z: number };
  tau: { hip: number; knee: number; ankle: number };
}

export interface RightingSolution {
  tauCorrection: { hip: number; knee: number; ankle: number };
  fCorrection: { x: number; y: number; z: number };
  clipped: boolean;
  feasible: boolean;
  reason: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveRighting(
  actual: ActualForceChain,
  target: RightingTargetIK,
  tauMax: { hip: number; knee: number; ankle: number },
): RightingSolution {
  let clipped = false;
  const corr = (a: number, t: number, cap: number): number => {
    const c = t - a;
    const lim = Math.max(0, cap - Math.abs(a));
    if (Math.abs(c) > lim) clipped = true;
    return clamp(c, -lim, lim);
  };
  const tauCorrection = {
    hip: corr(actual.tau.hip, target.tau.hip, tauMax.hip),
    knee: corr(actual.tau.knee, target.tau.knee, tauMax.knee),
    ankle: corr(actual.tau.ankle, target.tau.ankle, tauMax.ankle),
  };
  const fCorrection = {
    x: target.F.x - actual.F.x,
    y: target.F.y - actual.F.y,
    z: target.F.z - actual.F.z,
  };
  const feasible = actual.contact && actual.copInside && actual.frictionUtil <= 0.8;
  return {
    tauCorrection, fCorrection, clipped, feasible,
    reason: feasible ? (clipped ? '目标超限，已投影到最近可行' : '力链可行，直接修正') : '实际力链不可行，修正量仅减少误差',
  };
}
