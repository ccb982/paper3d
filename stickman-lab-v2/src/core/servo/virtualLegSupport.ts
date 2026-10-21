/**
 * virtualLegSupport.ts —— 蹲姿踝→髋虚拟支撑力的纯力矩映射
 *
 * 只做数学：给定作用在髋部的期望力 F=(F_fwd,F_up,0)，用腿的 Jacobian
 * 映射成踝/膝的广义力矩 τ=JᵀF。它不是写手，不 propose；调用方把 τ_a 并进
 * squat.ankleVec 的 Mdes、把 τ_k 并进 squat.pairBase 的 knee/2 base。
 */

import type { World } from '../world';

export interface LegSupportTorque {
  tauA: number;
  tauK: number;
}

function jacobi(hip: Float64Array, anchor: Float64Array, axis: Float64Array): [number, number] {
  const rx = hip[0]! - anchor[0]!;
  const ry = hip[1]! - anchor[1]!;
  const rz = hip[2]! - anchor[2]!;
  const ux = axis[0]!, uy = axis[1]!, uz = axis[2]!;
  return [uy * rz - uz * ry, uz * rx - ux * rz];
}

export function legSupportTorque(w: World, side: 'l' | 'r', fUp: number): LegSupportTorque {
  const body = w.body;
  const ai = body.dofByName(`foot_${side}`, 2);
  const ki = body.dofByName(`knee_${side}`, 2);
  const hi = body.dofByName(`hip_${side}`, 2);
  if (ai < 0 || ki < 0 || hi < 0) return { tauA: 0, tauK: 0 };
  const ad = body.dofs[ai]!, kd = body.dofs[ki]!, hd = body.dofs[hi]!;
  const hip = hd.anchorWorld;
  const dx = hip[0]! - ad.anchorWorld[0]!;
  const dy = hip[1]! - ad.anchorWorld[1]!;
  const len = Math.hypot(dx, dy) || 1;
  const fx = fUp * dx / len;
  const fy = fUp * dy / len;
  const ja = jacobi(hip, ad.anchorWorld, ad.axisWorld);
  const jk = jacobi(hip, kd.anchorWorld, kd.axisWorld);
  return {
    tauA: ja[0] * fx + ja[1] * fy,
    tauK: jk[0] * fx + jk[1] * fy,
  };
}
