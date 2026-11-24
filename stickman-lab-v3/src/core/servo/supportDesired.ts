export interface SupportDesiredInput {
  hipY: number;
  hipVY: number;
  hipTarget: number;
  mass: number;
  kp: number;
  kd: number;
  accCap: number;
  fzMin: number;
  fzMax: number;
  fzFeedback: number;
  fzActual: number;
}

export interface SupportDesired {
  hipErr: number;
  aDes: number;
  fzDes: number;
  fzCmd: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSupportDesired(i: SupportDesiredInput): SupportDesired {
  const hipErr = i.hipTarget - i.hipY;
  const aDes = clamp(i.kp * hipErr - i.kd * i.hipVY, -Math.abs(i.accCap), Math.abs(i.accCap));
  const fzDes = 0.5 * i.mass * (9.81 + aDes);
  const feedback = Math.abs(i.fzFeedback) * (fzDes - i.fzActual);
  const fzCmd = clamp(fzDes + feedback, Math.min(i.fzMin, i.fzMax), Math.max(i.fzMin, i.fzMax));
  return { hipErr, aDes, fzDes, fzCmd };
}
