import type { World } from '../world';
import { qOf, qRel, qToRotVec } from '../quat';

export interface FootPoseRecoveryInput {
  w: World;
  side: 'l' | 'r';
  targetQ: { x: number; y: number; z: number; w: number };
  kp: number;
  kd: number;
  cap: number;
}

export function footPoseRecovery(i: FootPoseRecoveryInput): number[] {
  const bi = i.w.body.indexByKey.get(`foot_${i.side}`);
  if (bi === undefined) return [0, 0, 0];
  const rb = i.w.body.bodies[bi]!;
  const actual = rb.rotation() as { x: number; y: number; z: number; w: number };
  const err = new Float64Array(3);
  qToRotVec(qRel(qOf(actual), qOf(i.targetQ)), err);
  const w = rb.angvel();
  const out: number[] = [0, 0, 0];
  for (const ax of [0, 1, 2] as const) {
    const j = i.w.body.dofByName(`foot_${i.side}`, ax);
    if (j < 0) continue;
    const a = i.w.body.dofs[j]!.axisWorld;
    const e = err[0]! * a[0]! + err[1]! * a[1]! + err[2]! * a[2]!;
    const wv = w.x * a[0]! + w.y * a[1]! + w.z * a[2]!;
    out[ax] = Math.max(-i.cap, Math.min(i.cap, i.kp * e - i.kd * wv));
  }
  return out;
}
