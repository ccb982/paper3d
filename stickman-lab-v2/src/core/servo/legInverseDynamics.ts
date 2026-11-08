/**
 * 三连杆逆动力学快照（只读第一版）。
 *
 * 用实际的 thigh / shin / foot 几何、质量和目标脚底力，
 * 对 hip / knee / ankle 关节做静态力矩求解。
 * 不写关节，只给 InverseDynamicsSolver / HUD 用。
 */
import type { World } from '../world';
import type { FootSensorReading } from './footContact';

export interface LegIdTarget {
  side: 'l' | 'r';
  fz: number;
  copX: number;
  copZ: number;
  footY: number;
}

export interface LegIdBoundary {
  hipForce?: { x: number; y: number; z: number };
  hipMoment?: { x: number; y: number; z: number };
  kneeForce?: { x: number; y: number; z: number };
  kneeMoment?: { x: number; y: number; z: number };
}

export interface LegIdTorque {
  side: 'l' | 'r';
  hip: number;
  knee: number;
  ankle: number;
  fz: number;
  copX: number;
  feasible: boolean;
}

const sgnFor = (name: string): number => (/^(hip|knee)_/.test(name) ? -1 : 1);

function jointIndex(w: World, name: string): number {
  return w.sk.joints.findIndex((j) => j.name === name);
}

function axisOf(w: World, name: string): Float64Array | null {
  for (const d of w.body.dofs) {
    if (d.name === name && d.axis === 2) return d.axisWorld;
  }
  return null;
}

function anchorOf(w: World, name: string): Float64Array | null {
  for (const d of w.body.dofs) {
    if (d.name === name && d.axis === 2) return d.anchorWorld;
  }
  return null;
}

function staticJointTorque(w: World, side: 'l' | 'r', jointName: string, t: LegIdTarget, b: LegIdBoundary): number {
  const ji = jointIndex(w, jointName);
  const axis = axisOf(w, jointName);
  const anchor = anchorOf(w, jointName);
  if (ji < 0 || !axis || !anchor) return 0;
  let mz = 0;
  for (const bi of w.body.subtree[ji] ?? []) {
    const rb = w.body.bodies[bi]!;
    const p = rb.worldCom();
    const rx = p.x - anchor[0]!;
    const ry = p.y - anchor[1]!;
    // gravity: F=(0,-mg,0), Mz = rx*Fy - ry*Fx
    mz += rx * (-rb.mass() * 9.81);
  }
  // target contact force at CoP: F=(0,fz,0)
  const cx = t.copX - anchor[0]!;
  mz += cx * t.fz;
  // 上/下边界压力：只加力矩项，不重复加已经包含在目标接触力里的合力。
  if (jointName === `hip_${side}`) {
    const mh = b.hipMoment ?? { x: 0, y: 0, z: 0 };
    mz += mh.z;
    if (b.kneeForce) {
      const k = anchorOf(w, `knee_${side}`);
      if (k) mz += (k[0]! - anchor[0]!) * b.kneeForce.y - (k[1]! - anchor[1]!) * b.kneeForce.x;
    }
  } else if (jointName === `knee_${side}`) {
    const mk = b.kneeMoment ?? { x: 0, y: 0, z: 0 };
    mz += mk.z;
  }
  // only sagittal z-axis component; measured convention matches fullInverseDynamics
  const tau = mz * axis[2]!;
  return tau * sgnFor(jointName);
}

export function solveStaticLegTorques(w: World, side: 'l' | 'r', fc: FootSensorReading, fzTarget: number, boundary: LegIdBoundary = {}): LegIdTorque {
  const fz = Math.max(0, fzTarget);
  const t: LegIdTarget = { side, fz, copX: fc.copX, copZ: fc.copZ, footY: fc.footY };
  return {
    side,
    hip: staticJointTorque(w, side, `hip_${side}`, t, boundary),
    knee: staticJointTorque(w, side, `knee_${side}`, t, boundary),
    ankle: staticJointTorque(w, side, `foot_${side}`, t, boundary),
    fz,
    copX: fc.copX,
    feasible: fc.contact && fz > 0 && fc.copInside,
  };
}
