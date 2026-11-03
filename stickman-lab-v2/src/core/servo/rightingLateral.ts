/**
 * 侧向回正求解：只输出 hip/0、foot/0 的目标修正。
 * 不碰 hip/2、knee/2、foot/2（矢状由独立求解器处理）。
 */
export interface LateralState {
  hip0: number;
  foot0: number;
}
export interface LateralTarget {
  hip0: number;
  foot0: number;
}
export interface LateralCorrection {
  dHip0: number;
  dFoot0: number;
  clipped: boolean;
  reason: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveLateralRighting(
  state: LateralState,
  target: LateralTarget,
  eCopZ: number,
  disturbance: -1 | 0 | 1,
  maxHip = 0.12,
  maxFoot = 0.10,
  kCopHip = 0.25,
  kDistHip = 0.02,
  kCopFoot = 0.20,
  kDistFoot = 0.015,
): LateralCorrection {
  let clipped = false;
  const lim = (v: number, cap: number): number => {
    const c = clamp(v, -cap, cap);
    if (c !== v) clipped = true;
    return c;
  };
  const dHip0 = lim((target.hip0 - state.hip0) + kCopHip * eCopZ + kDistHip * disturbance, maxHip);
  const dFoot0 = lim((target.foot0 - state.foot0) + kCopFoot * eCopZ + kDistFoot * disturbance, maxFoot);
  return {
    dHip0, dFoot0, clipped,
    reason: clipped ? '侧向修正超限，已投影' : '侧向修正可行',
  };
}
