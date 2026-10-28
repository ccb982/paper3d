/**
 * jointPlane.ts —— 关节「逻辑轴 → 物理平面」查询（2026-10-28）
 *
 * ★ 为什么要这个：**逻辑轴号 ≠ 物理平面**（多环链的后果）。
 *
 *   body.ts 的多环链把「外八静偏」交给 ring0（preRing）吸收，
 *   preRing 抢走一个逻辑轴号，于是剩余逻辑轴的物理含义会错位。
 *
 *   实测（tools/_tmp-axismap.ts，蹲姿）：
 *     hip_l/0  axisWorld=[0.886,-0.464,0] → 额状(X)  ✓ 与逻辑号一致
 *     hip_l/1  axisWorld=[0.464, 0.886,0] → 扭转(Y)  ✓
 *     hip_l/2  axisWorld=[0,0,1]           → 矢状(Z)  ✓
 *     knee_l/0 axisWorld=[0.263,0.965,0]  → **扭转(Y)** ✗ 逻辑 0 却是扭转！
 *     knee_l/1 axisWorld=[-0.955,0.261,-0.140] → **额状(X)** ✗ 逻辑 1 才是额状！
 *     knee_l/2 axisWorld=[-0.136,0.033,0.990]  → 矢状(Z)  ✓
 *     foot_l/0 axisWorld=[0.873,-0.488,0] → 额状(X)  ✓
 *     foot_l/1 axisWorld=[0.471,0.857,0.212] → 扭转(Y) ✓
 *     foot_l/2 axisWorld=[-0.423,0.003,0.906] → 矢状(Z) ✓
 *
 *   ⇒ **膝的逻辑 0/1 互换了**。按逻辑号写「膝额向」会写到扭转轴上——
 *     这正是「膝盖一直歪」的直接原因。
 *
 * 判据（绕 a 轴旋转 ⇒ 点在垂直于 a 的平面内运动）：
 *   |a.x| 最大 → 额状面（侧向摆）
 *   |a.y| 最大 → 水平面扭转（yaw）
 *   |a.z| 最大 → 矢状面（前后摆）
 */
import type { Body } from '../body';

export type JointPlane = 'frontal' | 'sagittal' | 'torsion';

const AXIS_LABEL: Record<JointPlane, string> = {
  frontal: '额状(绕前向X)',
  sagittal: '矢状(绕侧向Z)',
  torsion: '扭转(绕竖直Y)',
};

/** 关节的物理平面 */
export function jointPlane(body: Body, jointName: string, axis: number): JointPlane | null {
  const i = body.dofByName(jointName, axis);
  if (i < 0) return null;
  const a = body.dofs[i]!.axisWorld;
  const ax = Math.abs(a[0]!), ay = Math.abs(a[1]!), az = Math.abs(a[2]!);
  if (ax >= ay && ax >= az) return 'frontal';
  if (ay >= ax && ay >= az) return 'torsion';
  return 'sagittal';
}

/** 按物理平面找轴（同一关节内，平面匹配的逻辑轴） */
export function axisOfPlane(body: Body, jointName: string, plane: JointPlane): number | null {
  for (const ax of [0, 1, 2]) {
    if (jointPlane(body, jointName, ax) === plane) return ax;
  }
  return null;
}

/** 人类可读的平面说明（诊断用） */
export function planeLabel(p: JointPlane): string {
  return AXIS_LABEL[p];
}

/**
 * 物理平面 → 可写的轴集合（同一关节可能多个轴落在同一平面，取响应最大的）。
 * 用于「膝竖直」这类按平面描述的目标。
 */
export function frontalAxis(body: Body, jointName: string): number | null {
  return axisOfPlane(body, jointName, 'frontal');
}
export function sagittalAxis(body: Body, jointName: string): number | null {
  return axisOfPlane(body, jointName, 'sagittal');
}
export function torsionAxis(body: Body, jointName: string): number | null {
  return axisOfPlane(body, jointName, 'torsion');
}
