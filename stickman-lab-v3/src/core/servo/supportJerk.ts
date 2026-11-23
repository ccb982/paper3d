export interface SupportJerkState {
  tau: number;
  dot: number;
  acc: number;
}

export interface SupportJerkCfg {
  acc: number;
  jerk: number;
  slew: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function supportJerkStep(state: SupportJerkState, target: number, dtRaw: number, cfg: SupportJerkCfg): number {
  const dt = Math.max(1e-5, Math.min(0.05, dtRaw));
  const err = target - state.tau;
  const desiredDot = clamp(err / Math.max(dt, 0.05), -cfg.slew, cfg.slew);
  const desiredAcc = clamp((desiredDot - state.dot) / dt, -cfg.acc, cfg.acc);
  const jerkStep = cfg.jerk * dt;
  state.acc += clamp(desiredAcc - state.acc, -jerkStep, jerkStep);
  state.dot = clamp(state.dot + state.acc * dt, -cfg.slew, cfg.slew);
  state.tau += state.dot * dt;
  return state.tau;
}
