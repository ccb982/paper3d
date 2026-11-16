/**
 * HipTaskPD v2：髋高度/髋倾斜的任务空间阻抗 + 间歇保持。
 *
 * 本模块只产出目标，不写执行器；H* 交给 shankIK。
 * COM/XCoM 只作为后续预算输入，本版不直接驱动髋目标。
 */
import type { World } from '../world';
import type { ShankLegRef } from './shankIK';

export interface HipTask2Result {
  H: { x: number; y: number; z: number };
  hip0: number;
  hip2: number;
  heightError: number;
  rollError: number;
}

interface SideState { hip0: number; hip2: number }
const _state = new WeakMap<World, Map<'l' | 'r', SideState>>();

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 每局重建时清掉髋间歇目标，避免跨局继承。 */
export function resetHipTask2(w: World): void { _state.delete(w); }

export function solveHipTask2(w: World, ref: ShankLegRef, _comZ = 0): HipTask2Result {
  const h0 = w.body.dofs[w.body.dofByName(`hip_${ref.side}`, 0)]!;
  const h2 = w.body.dofs[w.body.dofByName(`hip_${ref.side}`, 2)]!;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kh = Math.abs(Number(env.SQC_HIP_TASK2_KH ?? 3));
  const kr = Math.abs(Number(env.SQC_HIP_TASK2_KR ?? 0.5));
  const kt = Math.abs(Number(env.SQC_HIP_TASK2_KT ?? 0.25));
  const capH = Math.abs(Number(env.SQC_HIP_TASK2_CAP_H ?? 0.12));
  const capR = Math.abs(Number(env.SQC_HIP_TASK2_CAP_R ?? 0.10));
  const capT = Math.abs(Number(env.SQC_HIP_TASK2_CAP_T ?? 0.04));
  const deadH = Math.abs(Number(env.SQC_HIP_TASK2_DEAD_H ?? 0.004));
  const deadR = Math.abs(Number(env.SQC_HIP_TASK2_DEAD_R ?? 0.008));
  const heightError = ref.hip.y - h2.anchorWorld[1]!;
  const rollError = ref.qHip0 - h0.angle;
  let state = _state.get(w)?.get(ref.side);
  if (!state) {
    state = { hip0: ref.qHip0, hip2: ref.qHip2 };
    let m = _state.get(w);
    if (!m) { m = new Map(); _state.set(w, m); }
    m.set(ref.side, state);
  }
  // 死区内保持上一目标；死区外才进入阻抗更新。
  const eH = Math.abs(heightError) > deadH ? clamp(heightError, -capH, capH) : 0;
  const eR = Math.abs(rollError) > deadR ? clamp(rollError, -capR, capR) : 0;
  if (eH !== 0) state.hip2 = ref.qHip2 + kh * eH;
  if (eR !== 0) state.hip0 = ref.qHip0 + kr * eR;
  return {
    H: {
      x: ref.hip.x,
      y: ref.hip.y,
      z: ref.hip.z + clamp(kt * eR, -capT, capT),
    },
    hip0: state.hip0,
    hip2: state.hip2,
    heightError,
    rollError,
  };
}
