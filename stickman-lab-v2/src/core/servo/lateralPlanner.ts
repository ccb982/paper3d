/** 侧向命令层：把骨盆误差转成 hip0/foot0 目标，不写执行器。 */
import { solveLateralRighting } from './rightingLateral';

export interface LateralPlanInput {
  hip0Base: number;
  foot0Base: number;
  hip0State: number;
  foot0State: number;
  eHipZ: number;
  roll: number;
  velZ: number;
  hipK?: number;
  footK?: number;
  hipSign?: number;
  footSign?: number;
  hipOn?: boolean;
  footOn?: boolean;
  rollK?: number;
  damp?: number;
  maxHip?: number;
  maxFoot?: number;
}

export interface LateralPlan {
  hip0Target: number;
  foot0Target: number;
  clipped: boolean;
}

export function planLateral(i: LateralPlanInput): LateralPlan {
  const eLat = i.eHipZ + (i.rollK ?? 0) * i.roll - (i.damp ?? 0) * i.velZ;
  const c = solveLateralRighting(
    { hip0: i.hip0State, foot0: i.foot0State },
    { hip0: i.hip0Base, foot0: i.foot0Base },
    eLat, 0,
    i.maxHip ?? 0.12, i.maxFoot ?? 0.10,
    i.hipK ?? 0.5, 0.02,
    i.footK ?? 0.5, 0.015,
  );
  return {
    hip0Target: i.hip0Base + ((i.hipOn ?? false) ? (i.hipSign ?? 1) * c.dHip0 : 0),
    foot0Target: i.foot0Base + ((i.footOn ?? true) ? (i.footSign ?? -1) * c.dFoot0 : 0),
    clipped: c.clipped,
  };
}
