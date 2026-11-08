import type { World } from '../world';
import type { FootSensorReading } from './footContact';
import type { LegIdBoundary, LegIdTorque } from './legInverseDynamics';
import { solveStaticLegTorques } from './legInverseDynamics';
import type { ShankIKSolution } from './shankIK';

export interface SagittalIdInput {
  side: 'l' | 'r';
  fc: FootSensorReading;
  fzTarget: number;
  ik: ShankIKSolution;
  hip1Base: number;
  hip0Corr: number;
  hip1Corr: number;
  boundary?: LegIdBoundary;
}

export interface SagittalIdOutput {
  hip0Target: number;
  hip1Target: number;
  hip2Target: number;
  knee2Target: number;
  foot2Target: number;
  hip2Ff: number;
  knee2Ff: number;
  ankleFf: number;
  id: LegIdTorque;
  feasible: boolean;
}

export function solveSagittalInverseDynamics(w: World, i: SagittalIdInput): SagittalIdOutput {
  const id = solveStaticLegTorques(w, i.side, i.fc, i.fzTarget, i.boundary);
  return {
    hip0Target: i.ik.hip0 + i.hip0Corr,
    hip1Target: i.hip1Base + i.hip1Corr,
    hip2Target: i.ik.hip2,
    knee2Target: i.ik.knee2,
    foot2Target: i.ik.foot2,
    hip2Ff: id.hip,
    knee2Ff: id.knee,
    ankleFf: id.ankle,
    id,
    feasible: id.feasible,
  };
}
