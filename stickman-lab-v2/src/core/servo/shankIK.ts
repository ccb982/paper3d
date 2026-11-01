/**
 * 动态小腿 IK：实际脚踝 A(t) + 目标髋位置 H* → 目标腿链。
 *
 * 只消费关节几何/脚位置，不消费 CoM/CoP。
 * 目标每帧重算，不能缓存成释放角。
 */
import type { World } from '../world';

export interface ShankLegRef {
  side: 'l' | 'r';
  hip: { x: number; y: number; z: number };
  knee: { x: number; y: number; z: number };
  ankle: { x: number; y: number; z: number };
  l1: number;
  l2: number;
  hipGeo: number;
  kneeBend: number;
  qHip2: number;
  qKnee2: number;
  qFoot2: number;
}

export interface ShankIKSolution {
  hip2: number;
  knee2: number;
  foot2: number;
}

const v3 = (a: Float64Array): { x: number; y: number; z: number } => ({ x: a[0]!, y: a[1]!, z: a[2]! });
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function kneeBendOf(d: number, l1: number, l2: number): number {
  const c = clamp((l1 * l1 + l2 * l2 - d * d) / Math.max(1e-9, 2 * l1 * l2), -1, 1);
  return Math.PI - Math.acos(c);
}

export function captureShankLeg(w: World, side: 'l' | 'r'): ShankLegRef {
  const hipD = w.body.dofs[w.body.dofByName(`hip_${side}`, 2)]!;
  const kneeD = w.body.dofs[w.body.dofByName(`knee_${side}`, 2)]!;
  const ankleD = w.body.dofs[w.body.dofByName(`foot_${side}`, 2)]!;
  const hip = v3(hipD.anchorWorld);
  const knee = v3(kneeD.anchorWorld);
  const ankle = v3(ankleD.anchorWorld);
  const l1 = dist(hip, knee);
  const l2 = dist(knee, ankle);
  const d = dist(hip, ankle);
  return {
    side, hip, knee, ankle, l1, l2,
    hipGeo: Math.atan2(ankle.x - hip.x, hip.y - ankle.y),
    kneeBend: kneeBendOf(d, l1, l2),
    qHip2: hipD.angle, qKnee2: kneeD.angle, qFoot2: ankleD.angle,
  };
}

export function solveShankIK(w: World, ref: ShankLegRef): ShankIKSolution {
  const ankleD = w.body.dofs[w.body.dofByName(`foot_${ref.side}`, 2)]!;
  const hipD = w.body.dofs[w.body.dofByName(`hip_${ref.side}`, 2)]!;
  const kneeD = w.body.dofs[w.body.dofByName(`knee_${ref.side}`, 2)]!;
  const ankle = v3(ankleD.anchorWorld);
  const d = clamp(dist(ref.hip, ankle), Math.abs(ref.l1 - ref.l2) + 1e-4, ref.l1 + ref.l2 - 1e-4);
  const bend = kneeBendOf(d, ref.l1, ref.l2);
  const hipGeo = Math.atan2(ankle.x - ref.hip.x, ref.hip.y - ankle.y);
  // 膝矢状角在屈膝时为负；髋角随腿链前倾。释放姿势只做一次标定。
  const knee2 = ref.qKnee2 - (bend - ref.kneeBend);
  const hip2 = ref.qHip2 + (hipGeo - ref.hipGeo);
  return { hip2, knee2, foot2: ref.qFoot2 };
}
