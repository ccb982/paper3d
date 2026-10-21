/**
 * ankleCoP.ts —— 站立/蹲下共用的 CP→CoP 目标层（纯策略，不写关节）
 *
 *   ξ = c + v/ω
 *   p_req = ref + (1 + λ/ω)(ξ − ref)
 *   再按脚掌支撑范围钳位
 *
 * FootPad（站立）和 squatAnkleVector（蹲下）共用这一个目标函数；
 * 力矩分配/执行仍由各自执行器完成。
 */

export interface CoPLimits { minX: number; maxX: number; minZ: number; maxZ: number }

export interface CoPTarget {
  pX: number; pZ: number;
  xiX: number; xiZ: number;
  clampedX: boolean; clampedZ: boolean;
}

export function ankleCoPTarget(
  comX: number, comZ: number, vX: number, vZ: number, comY: number,
  refX: number, refZ: number, lim: CoPLimits, lambda = 1.0,
): CoPTarget {
  const omega = Math.sqrt(9.81 / Math.max(0.3, comY));
  const xiX = comX + vX / omega;
  const xiZ = comZ + vZ / omega;
  let pX = refX + (1 + lambda / omega) * (xiX - refX);
  let pZ = refZ + (1 + lambda / omega) * (xiZ - refZ);
  const clampedX = pX < lim.minX || pX > lim.maxX;
  const clampedZ = pZ < lim.minZ || pZ > lim.maxZ;
  pX = Math.max(lim.minX, Math.min(lim.maxX, pX));
  pZ = Math.max(lim.minZ, Math.min(lim.maxZ, pZ));
  return { pX, pZ, xiX, xiZ, clampedX, clampedZ };
}
