export interface JointCommand {
  dof: number;
  qRef: number;
  kp: number;
  kd: number;
  tau: number;
  contact: boolean;
  locked: boolean;
  passive: number;
  external: number;
  externalCap: number;
  driveTau: number;
  gravityTau: number;
  hasAngle: boolean;
}

export interface FrameCommand {
  joints: JointCommand[];
  stage: number;
  valid: boolean;
}

export function createFrameCommand(
  dofs: Array<{ angle: number; tauMax: number }>,
): FrameCommand {
  return {
    joints: dofs.map((d, dof) => ({
      dof,
      qRef: d.angle,
      kp: 0,
      kd: 0,
      tau: 0,
      contact: false,
      locked: false,
      passive: 0,
      external: 0,
      externalCap: 0,
      driveTau: 0,
      gravityTau: 0,
      hasAngle: false,
    })),
    stage: 0,
    valid: true,
  };
}

export function patchJoint(
  frame: FrameCommand,
  dof: number,
  patch: Partial<Omit<JointCommand, 'dof'>>,
): void {
  const c = frame.joints[dof];
  if (!c) return;
  Object.assign(c, patch);
}

export function advanceStage(frame: FrameCommand, stage: number): void {
  frame.stage = Math.max(frame.stage, stage);
}
