export interface SupportDesiredInput {
  hipY: number;
  hipVY: number;
  hipTarget: number;
  mass: number;
  kp: number;
  kd: number;
  accCap: number;
  /** 交接窗内可临时抬高加速度下限（0 = 保证 Fz>=mg） */
  accMin?: number;
  fzMin: number;
  fzMax: number;
  fzFeedback: number;
  fzActual: number;
  /** 本脚在总竖直力中的份额；双支撑 0..1，单支撑承重脚 1 */
  share: number;
  /** 实测力反馈最多把命令拉离期望值多少比例（默认 0.2） */
  fzTrimMax?: number;
}

export interface SupportDesired {
  hipErr: number;
  aDes: number;
  fzTotalDes: number;
  fzDes: number;
  fzCmd: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSupportDesired(i: SupportDesiredInput): SupportDesired {
  const hipErr = i.hipTarget - i.hipY;
  const accMin = i.accMin ?? -Math.abs(i.accCap);
  const aDes = clamp(i.kp * hipErr - i.kd * i.hipVY, accMin, Math.abs(i.accCap));
  const fzTotalDes = i.mass * (9.81 + aDes);
  const share = clamp(i.share, 0, 1);
  const fzDes = fzTotalDes * share;
  const trimMax = Math.abs(i.fzTrimMax ?? 0.2) * Math.max(1, fzDes);
  const feedback = clamp(Math.abs(i.fzFeedback) * (fzDes - i.fzActual), -trimMax, trimMax);
  const fzCmd = clamp(fzDes + feedback, Math.max(i.fzMin, fzDes - trimMax), Math.min(i.fzMax, fzDes + trimMax));
  return { hipErr, aDes, fzTotalDes, fzDes, fzCmd };
}
