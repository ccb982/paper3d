export interface AnkleCopServoInput {
  copDes: number;
  copAct: number;
  copVel: number;
  fz: number;
  kp: number;
  kd: number;
  cap: number;
  sign: number;
}

export function ankleCopServo(i: AnkleCopServoInput): number {
  if (!Number.isFinite(i.copDes) || !Number.isFinite(i.copAct)) return 0;
  const fz = Math.max(0, Number.isFinite(i.fz) ? i.fz : 0);
  const vel = Number.isFinite(i.copVel) ? i.copVel : 0;
  const err = i.copDes - i.copAct;
  const raw = i.sign * fz * (i.kp * err - i.kd * vel);
  const cap = Math.max(0, Math.abs(i.cap));
  return Math.max(-cap, Math.min(cap, raw));
}
