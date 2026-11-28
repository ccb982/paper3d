import type { World } from '../world';
import { buildLegJacobian6 } from './contact6d';
import { qOf, qRel, qToRotVec } from '../quat';

export interface LegLevelingJacobianInput {
  w: World;
  side: 'l' | 'r';
  targetQ: { x: number; y: number; z: number; w: number };
  kp: number;
  kd: number;
  cap: number;
}

export function legLevelingJacobian(i: LegLevelingJacobianInput): { dofs: number[]; tau: number[] } {
  const bi = i.w.body.indexByKey.get(`foot_${i.side}`);
  if (bi === undefined) return { dofs: [], tau: [] };
  const rb = i.w.body.bodies[bi]!;
  const p = rb.translation();
  const q = rb.rotation() as { x: number; y: number; z: number; w: number };
  const wv = rb.angvel();
  const e = new Float64Array(3);
  qToRotVec(qRel(qOf(q), qOf(i.targetQ)), e);
  const j = buildLegJacobian6(i.w, i.side, p.x, p.y, p.z);
  const n = j.dofs.length;
  const target = [0, 0, 0].map((_, r) => -i.kp * e[r]! - i.kd * [wv.x, wv.y, wv.z][r]!);
  const tau = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let r = 0; r < 3; r++) s += (j.J[3 + r]?.[k] ?? 0) * target[r]!;
    tau[k] = Math.max(-i.cap, Math.min(i.cap, s));
  }
  return { dofs: j.dofs, tau };
}
