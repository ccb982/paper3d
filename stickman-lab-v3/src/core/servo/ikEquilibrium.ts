/**
 * IK target equilibrium: q* -> Fstar/CoPstar -> tau. Not wired to control.
 * Validation status: not accepted.
 */
import { sagittalTauFromCoP, type V3 } from './forceChain';

export interface IkEquilibrium {
  F: { x: number; y: number };
  cop: { x: number; z: number };
  tau: { hip: number; knee: number; ankle: number };
  feasible: boolean;
}

export function buildIkEquilibrium(
  hip: V3, knee: V3, ankle: V3, weight: number, copHalfX = 0.12, copHalfZ = 0.06, copXOffset = 0, copZOffset = 0,
): IkEquilibrium {
  const F = { x: 0, y: Math.max(0, weight) / 2 };
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const cop = { x: cl(ankle.x + copXOffset, ankle.x - copHalfX, ankle.x + copHalfX), z: cl(ankle.z + copZOffset, ankle.z - copHalfZ, ankle.z + copHalfZ) };
  const raw = sagittalTauFromCoP(hip, knee, ankle, cop, F);
  return {
    F, cop,
    tau: { hip: -raw.hip, knee: -raw.knee, ankle: -raw.ankle },
    feasible: true,
  };
}
