export interface MuscleParams {
  f0: number;
  momentArm: number;
  length0: number;
  lengthRange: number;
  k1: number;
  k3: number;
  b: number;
  kSr: number;
  xSr: number;
  slack: number;
  tauAct: number;
  tauDeact: number;
  cap: number;
}

export interface MuscleState {
  aA: number;
  aB: number;
}

export interface JointConfig {
  inertia: number;
  jointDamping: number;
  ref: number;
  base: number;
  co: number;
  kp: number;
  kd: number;
  compression?: number;
  params: MuscleParams;
}

export interface MuscleOutput {
  torque: number;
  active: number;
  passive: number;
  base: number;
  aA: number;
  aB: number;
}
