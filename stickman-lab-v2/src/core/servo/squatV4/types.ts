export type Side = 'l' | 'r';

export interface MusclePairParams {
  f0: number;
  momentArm: number;
  kPassive: number;
  k3Passive: number;
  bPassive: number;
  slack: number;
  tauAct: number;
  cap: number;
  lengthRef: number;
  lengthRange: number;
}

export interface MusclePairState {
  aA: number;
  aB: number;
}

export interface MusclePairCommand {
  co: number;
  net: number;
}

export interface MusclePairOutput {
  torque: number;
  active: number;
  passive: number;
  aA: number;
  aB: number;
  stiffness: number;
  damping: number;
  saturated: boolean;
}

export interface SimpleCommandInput {
  base: number;
  ref: number;
  angle: number;
  vel: number;
  co: number;
  kp: number;
  kd: number;
}

export interface JointSpec {
  key: string;
  side: Side;
  ref: number;
  base: number;
  kp: number;
  kd: number;
  co: number;
  params: MusclePairParams;
}
