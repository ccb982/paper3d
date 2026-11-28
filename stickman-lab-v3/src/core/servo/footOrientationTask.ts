import { qOf, qRel, qToRotVec } from '../quat';

export interface FootOrientationTaskInput {
  actualQ: { x: number; y: number; z: number; w: number };
  targetQ: { x: number; y: number; z: number; w: number };
  angVel: { x: number; y: number; z: number };
  kp: number;
  kd: number;
  accMax: number;
}

export interface FootOrientationTaskOutput {
  error: number[];
  targetAcc: number[];
  active: boolean;
}

export function planFootOrientationTask(i: FootOrientationTaskInput): FootOrientationTaskOutput {
  const e = new Float64Array(3);
  qToRotVec(qRel(qOf(i.actualQ), qOf(i.targetQ)), e);
  const cap = Math.max(0, Math.abs(i.accMax));
  const targetAcc = [
    Math.max(-cap, Math.min(cap, -i.kp * e[0]! - i.kd * i.angVel.x)),
    Math.max(-cap, Math.min(cap, -i.kp * e[1]! - i.kd * i.angVel.y)),
    Math.max(-cap, Math.min(cap, -i.kp * e[2]! - i.kd * i.angVel.z)),
  ];
  return { error: [e[0]!, e[1]!, e[2]!], targetAcc, active: targetAcc.some((v) => Math.abs(v) > 1e-9) };
}
