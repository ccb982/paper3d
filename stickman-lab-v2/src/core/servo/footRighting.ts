/**
 * 回正力第一段：先算脚底目标力，再从脚映射到关节。
 * 不允许直接给 hip/knee/ankle 加修正力矩。
 */
import type { V3 } from './forceChain';

export interface FootRightInput {
  actualF: { x: number; y: number };
  targetF: { x: number; y: number };
  hipErrZ: number;
  hipVelZ: number;
  maxLateral?: number;
}

export interface FootForcePlan {
  F: { x: number; y: number };
  clipped: boolean;
}

export function planFootForce(i: FootRightInput): FootForcePlan {
  const kp = 40, kd = 8;
  const cap = Math.max(0, i.maxLateral ?? 80);
  let fx = i.targetF.x + kp * i.hipErrZ + kd * i.hipVelZ;
  let clipped = false;
  if (fx > cap) { fx = cap; clipped = true; }
  if (fx < -cap) { fx = -cap; clipped = true; }
  return { F: { x: fx, y: Math.max(0, i.targetF.y) }, clipped };
}

/** 从脚底力作用点映射到关节力矩（JᵀF），只做分配，不额外加力。 */
export function tauFromFootForce(
  F: { x: number; y: number },
  cop: { x: number; y: number },
  hip: V3, knee: V3, ankle: V3,
): { hip: number; knee: number; ankle: number } {
  const arm = (p: V3): number => (cop.x - p.x) * F.y - (cop.y - p.y) * F.x;
  return { hip: arm(hip), knee: arm(knee), ankle: arm(ankle) };
}
