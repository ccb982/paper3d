export type SagittalSide = 'l' | 'r';
export type SagittalMode = 'STABILIZE' | 'RECOVER';
export type SagittalForceMode = 'FORCE' | 'HIP';

export interface BooleanState {
  valid: boolean;
  confidence: number;
  timestamp: number;
}

export interface SagittalJointState {
  q: [number, number, number, number, number, number, number, number, number];
  qd: [number, number, number, number, number, number, number, number, number];
  tauApplied: [number, number, number, number, number, number, number, number, number];
  min: [number, number, number, number, number, number, number, number, number];
  max: [number, number, number, number, number, number, number, number, number];
  tauMax: [number, number, number, number, number, number, number, number, number];
  velMax: [number, number, number, number, number, number, number, number, number];
}

export interface SagittalContactState extends BooleanState {
  contact: boolean;
  fz: number;
  fzFiltered: number;
  copX: number;
  copZ: number;
  copValid: boolean;
  copInside: boolean;
  frictionUse: number;
  footX: number;
  footY: number;
  footZ: number;
  footSpeed: number;
}

export interface SagittalChainState extends BooleanState {
  fParallel: number;
  fParallelSigned: number;
  fPerp: number;
  fPerpSag: number;
  fLat: number;
  feasible: boolean;
  copInside: boolean;
  tauUtil: number;
}

export interface SagittalLegSensor extends BooleanState {
  side: SagittalSide;
  joints: SagittalJointState;
  contact: SagittalContactState;
  chain: SagittalChainState;
  kneeOut: number;
  kneeOutJ0: number;
  kneeOutJ1: number;
  hipHeight: number;
  hipVelocity: number;
  ikHip0: number;
  ikHip1: number;
  ikHip2: number;
  ikKnee2: number;
  ikFoot2: number;
}

export interface SagittalPelvisState extends BooleanState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  angularVelocity: { x: number; y: number; z: number };
  roll: number;
  pitch: number;
  yaw: number;
  hL: number;
  hR: number;
  rollVelocity: number;
  pitchVelocity: number;
}

export interface SagittalComState extends BooleanState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  acceleration: { x: number; y: number; z: number };
  targetX: number;
  targetZ: number;
  xcomZ: number;
  supportMidZ: number;
  effectiveHalf: number;
  margin: number;
}

export interface SagittalBoundaryState extends BooleanState {
  pHipForce: { x: number; y: number; z: number };
  pHipMoment: { x: number; y: number; z: number };
  pKneeForce: { x: number; y: number; z: number };
  pKneeMoment: { x: number; y: number; z: number };
}

export interface SagittalBaseReference {
  fzL: number;
  fzR: number;
  hip0TargetL: number;
  hip0TargetR: number;
  hip1TargetL: number;
  hip1TargetR: number;
  hip2TargetL: number;
  hip2TargetR: number;
  knee2TargetL: number;
  knee2TargetR: number;
  foot2TargetL: number;
  foot2TargetR: number;
  hip2FfL: number;
  hip2FfR: number;
  knee2FfL: number;
  knee2FfR: number;
  ankleFfL: number;
  ankleFfR: number;
  valid: boolean;
}

export interface SagittalTargets {
  qStableL: [number, number, number, number];
  qStableR: [number, number, number, number];
  qIkL: [number, number, number, number];
  qIkR: [number, number, number, number];
  kneeOutMinL: number;
  kneeOutMinR: number;
  comTargetX: number;
  comTargetZ: number;
  xcomTargetZ: number;
  copTargetZ: number;
  pelvisRollTarget: number;
  pelvisHeightTarget: number;
  fzLowMargin: number;
  fzHighMargin: number;
  fzDiffGain: number;
  fzDiffCap: number;
  fzDeadband: number;
  kneeOutAngleCap: number;
  hipCommonWeight: number;
  pelvisRollWeight: number;
}

export interface SagittalSensorFrame extends BooleanState {
  t: number;
  dt: number;
  physicsStep: number;
  legs: Record<SagittalSide, SagittalLegSensor>;
  pelvis: SagittalPelvisState;
  com: SagittalComState;
  boundary: SagittalBoundaryState;
  base: SagittalBaseReference;
  mode: SagittalMode;
  forceMode: SagittalForceMode;
  solverReady: boolean;
}

export interface CommandFrame {
  solveId: number;
  solvedAt: number;
  validUntil: number;
  holdUntil: number;
  feasible: boolean;
  mode: SagittalMode;
  forceMode: SagittalForceMode;
  deltaFzL: number;
  deltaFzR: number;
  deltaHip0L: number;
  deltaHip0R: number;
  deltaHip1L: number;
  deltaHip1R: number;
  deltaHip2L: number;
  deltaHip2R: number;
  deltaKnee2L: number;
  deltaKnee2R: number;
  deltaHip2FfL: number;
  deltaHip2FfR: number;
  deltaKnee2FfL: number;
  deltaKnee2FfR: number;
  kneeOutL: number;
  kneeOutR: number;
  hipResidual: number;
  torqueResidual: number;
  contactResidual: number;
  kneeOutResidual: number;
}

export interface SagittalQpResult {
  feasible: boolean;
  residual: number;
  iterations: number;
  activeConstraints: string[];
}

export interface SagittalIdSolverInput {
  sensor: SagittalSensorFrame;
  targets: SagittalTargets;
  previous: CommandFrame | null;
  now: number;
  solveDt: number;
}

export interface SagittalIdSolverOutput {
  command: CommandFrame;
  qp: SagittalQpResult;
}
