/** 验证状态：几何/目标函数；力链输入验证未通过，默认关闭。 */
/**
 * 动态小腿 IK：实际脚踝 A(t) + 目标髋位置 H* → 目标腿链。
 *
 * 只消费关节几何/脚位置，不消费 CoM/CoP。
 * 目标每帧重算，不能缓存成释放角。
 */
import type { World } from '../world';
import { buildKneeForceChain, type KneeForceChain } from './forceChain';

export interface ShankLegRef {
  side: 'l' | 'r';
  hip: { x: number; y: number; z: number };
  knee: { x: number; y: number; z: number };
  ankle: { x: number; y: number; z: number };
  l1: number;
  l2: number;
  hipGeo: number;
  hipGeoZ: number;
  kneeBend: number;
  qHip0: number;
  qHip2: number;
  qKnee0: number;
  qKnee2: number;
  qFoot0: number;
  qFoot2: number;
}

export interface ShankIKSolution {
  hip0: number;
  hip2: number;
  knee0: number;
  knee2: number;
  foot0: number;
  foot2: number;
}

export interface HipTarget {
  x: number;
  y: number;
  z: number;
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
  const hip0D = w.body.dofs[w.body.dofByName(`hip_${side}`, 0)]!;
  const kneeD = w.body.dofs[w.body.dofByName(`knee_${side}`, 2)]!;
  const knee0D = w.body.dofs[w.body.dofByName(`knee_${side}`, 0)]!;
  const ankleD = w.body.dofs[w.body.dofByName(`foot_${side}`, 2)]!;
  const foot0D = w.body.dofs[w.body.dofByName(`foot_${side}`, 0)]!;
  const hip = v3(hipD.anchorWorld);
  const knee = v3(kneeD.anchorWorld);
  const ankle = v3(ankleD.anchorWorld);
  const l1 = dist(hip, knee);
  const l2 = dist(knee, ankle);
  const d = dist(hip, ankle);
  return {
    side, hip, knee, ankle, l1, l2,
    hipGeo: Math.atan2(ankle.x - hip.x, hip.y - ankle.y),
    hipGeoZ: Math.atan2(ankle.z - hip.z, hip.y - ankle.y),
    kneeBend: kneeBendOf(d, l1, l2),
    qHip0: hip0D.angle, qHip2: hipD.angle,
    qKnee0: knee0D.angle, qKnee2: kneeD.angle,
    qFoot0: foot0D.angle, qFoot2: ankleD.angle,
  };
}

/** 髋侧向目标 H*：由髋自身角度误差给出，不用 CoM/CoP。 */
export function hipLateralTarget(w: World, ref: ShankLegRef): HipTarget {
  const h0 = w.body.dofs[w.body.dofByName(`hip_${ref.side}`, 0)];
  const err = h0 ? ref.qHip0 - h0.angle : 0;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const k = Math.abs(Number(env.SQC_HIP_LAT_K ?? 0.25));
  const cap = Math.abs(Number(env.SQC_HIP_LAT_CAP ?? 0.05));
  return { x: ref.hip.x, y: ref.hip.y, z: ref.hip.z + Math.max(-cap, Math.min(cap, k * err)) };
}

function flatFoot2(w: World, ref: ShankLegRef, ankle: {x:number;y:number;z:number}): number {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FLAT_FOOT ?? '1') !== '1') return ref.qFoot2;
  const kneeD = w.body.dofs[w.body.dofByName(`knee_${ref.side}`, 2)]!;
  const k = { x: kneeD.anchorWorld[0]!, y: kneeD.anchorWorld[1]!, z: kneeD.anchorWorld[2]! };
  const now = Math.atan2(ankle.x - k.x, k.y - ankle.y);
  const was = Math.atan2(ref.ankle.x - ref.knee.x, ref.knee.y - ref.ankle.y);
  return ref.qFoot2 + (now - was);
}
export function solveShankIK(w: World, ref: ShankLegRef, hipTarget: HipTarget = ref.hip): ShankIKSolution {
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
  // 侧向：脚踝相对目标髋的外翻/内收，每帧重新解出 hip/knee/foot 目标。
  const hipGeoZ = Math.atan2(ankle.z - hipTarget.z, hipTarget.y - ankle.y);
  const dz = hipGeoZ - ref.hipGeoZ;
  const sign = ref.side === 'l' ? 1 : -1;
  const hip0 = ref.qHip0 + 1.0 * dz * sign;
  const knee0 = ref.qKnee0 + 1.0 * dz * sign;
  const foot0 = ref.qFoot0 + 0.5 * dz * sign;
  return { hip0, hip2, knee0, knee2, foot0, foot2: flatFoot2(w, ref, ankle) };
}


/** 到膝的力链 IK：目标小腿线 + 膝处大腿力约束。 */
export interface ShankIK2Result {
  ik: ShankIKSolution;
  targetKnee: { x: number; y: number; z: number };
  chain: KneeForceChain;
  feasible: boolean;
}
/** 由目标 H* 和实际踝反解 q_ref；不读释放角，不用竖直占位。 */
export function solveShankIKTarget(w: World, ref: ShankLegRef, hipTarget: HipTarget): ShankIKSolution {
  const ankleD = w.body.dofs[w.body.dofByName(`foot_${ref.side}`, 2)]!;
  const ankle = v3(ankleD.anchorWorld);
  const d = clamp(dist(hipTarget, ankle), Math.abs(ref.l1 - ref.l2) + 1e-4, ref.l1 + ref.l2 - 1e-4);
  const bend = kneeBendOf(d, ref.l1, ref.l2);
  const hipGeo = Math.atan2(ankle.x - hipTarget.x, hipTarget.y - ankle.y);
  const knee2 = ref.qKnee2 - (bend - ref.kneeBend);
  const hip2 = ref.qHip2 + (hipGeo - ref.hipGeo);
  const hipGeoZ = Math.atan2(ankle.z - hipTarget.z, hipTarget.y - ankle.y);
  const dz = hipGeoZ - ref.hipGeoZ;
  const sign = ref.side === 'l' ? 1 : -1;
  return {
    hip0: ref.qHip0 + dz * sign,
    hip2,
    knee0: ref.qKnee0 + dz * sign,
    knee2,
    foot0: ref.qFoot0 + 0.5 * dz * sign,
    foot2: flatFoot2(w, ref, ankle),
  };
}

export function solveShankIK2(
  w: World,
  ref: ShankLegRef,
  hipTarget: HipTarget,
  fShankAxial: number,
  tauKnee: number,
  uShank?: { x: number; y: number; z: number },
): ShankIK2Result {
  const ankleD = w.body.dofs[w.body.dofByName(`foot_${ref.side}`, 2)]!;
  const A = { x: ankleD.anchorWorld[0]!, y: ankleD.anchorWorld[1]!, z: ankleD.anchorWorld[2]! };
  // 目标小腿线由调用方给当前动力学方向；缺省用当前踝→膝，不再用竖直占位。
  const raw = uShank ?? { x: ref.knee.x - A.x, y: ref.knee.y - A.y, z: ref.knee.z - A.z };
  const n = Math.hypot(raw.x, raw.y, raw.z) || 1;
  const u = { x: raw.x / n, y: raw.y / n, z: raw.z / n };
  const targetKnee = { x: A.x + ref.l2 * u.x, y: A.y + ref.l2 * u.y, z: A.z + ref.l2 * u.z };
  const ik = solveShankIKTarget(w, ref, hipTarget);
  const chain = buildKneeForceChain(A, targetKnee, fShankAxial, tauKnee);
  const hLen = Math.hypot(hipTarget.x - targetKnee.x, hipTarget.y - targetKnee.y, hipTarget.z - targetKnee.z);
  const hFeasible = Math.abs(hLen - ref.l1) <= 0.03;   // H* 必须落在 |H-K|=L1 上
  return { ik, targetKnee, chain, feasible: chain.feasible && hFeasible };
}
