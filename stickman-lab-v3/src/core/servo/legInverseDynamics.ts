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
  fx: number;
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

export interface LegIdDynamic {
  hip?: number;
  knee?: number;
  ankle?: number;
}

export interface LegContactPoint {
  x: number;
  y: number;
  z: number;
  weight?: number;
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

function staticJointTorque(w: World, side: 'l' | 'r', jointName: string, t: LegIdTarget, b: LegIdBoundary, dbg?: Record<string, number>, contacts: LegContactPoint[] = []): number {
  const ji = jointIndex(w, jointName);
  const axis = axisOf(w, jointName);
  const anchor = anchorOf(w, jointName);
  if (ji < 0 || !axis || !anchor) return 0;
  let mzG = 0;
  for (const bi of w.body.subtree[ji] ?? []) {
    const rb = w.body.bodies[bi]!;
    const p = rb.worldCom();
    const rx = p.x - anchor[0]!;
    const ry = p.y - anchor[1]!;
    // gravity: F=(0,-mg,0), Mz = rx*Fy - ry*Fx
    mzG += rx * (-rb.mass() * 9.81);
  }
  // target contact force: distribute over actual contact points when available
  let mzC = 0;
  if (contacts.length > 0) {
    let sw = 0;
    for (const c of contacts) sw += Math.max(0, c.weight ?? 1);
    const inv = sw > 1e-9 ? t.fz / sw : 0;
    const invFx = sw > 1e-9 ? t.fx / sw : 0;
    for (const c of contacts) {
      const wgt = sw > 1e-9 ? Math.max(0, c.weight ?? 1) : 1 / contacts.length;
      const fy = (sw > 1e-9 ? wgt * inv : t.fz / contacts.length);
      const fx = (sw > 1e-9 ? wgt * invFx : t.fx / contacts.length);
      mzC += (c.x - anchor[0]!) * fy - (c.y - anchor[1]!) * fx;
    }
  } else {
    const cx = t.copX - anchor[0]!;
    const cy = t.footY - anchor[1]!;
    mzC = cx * t.fz - cy * t.fx;
  }
  let mzB = 0;
  // 上/下边界压力：只加力矩项，不重复加已经包含在目标接触力里的合力。
  if (jointName === `hip_${side}`) {
    const mh = b.hipMoment ?? { x: 0, y: 0, z: 0 };
    mzB += mh.z;
    if (b.kneeForce) {
      const k = anchorOf(w, `knee_${side}`);
      if (k) mzB += (k[0]! - anchor[0]!) * b.kneeForce.y - (k[1]! - anchor[1]!) * b.kneeForce.x;
    }
  } else if (jointName === `knee_${side}`) {
    const mk = b.kneeMoment ?? { x: 0, y: 0, z: 0 };
    mzB += mk.z;
  }
  const mz = mzG + mzC + mzB;
  // only sagittal z-axis component; measured convention matches fullInverseDynamics
  const tau = mz * axis[2]!;
  if (dbg) {
    dbg[`${jointName}Grav`] = mzG * axis[2]! * sgnFor(jointName);
    dbg[`${jointName}Contact`] = mzC * axis[2]! * sgnFor(jointName);
    dbg[`${jointName}Boundary`] = mzB * axis[2]! * sgnFor(jointName);
    dbg[`${jointName}Tau`] = tau * sgnFor(jointName);
  }
  return tau * sgnFor(jointName);
}

export function solveStaticLegTorques(w: World, side: 'l' | 'r', fc: FootSensorReading, fzTarget: number, boundary: LegIdBoundary = {}, dynamic: LegIdDynamic = {}, contacts: LegContactPoint[] = [], fxTarget = 0): LegIdTorque {
  const fz = Math.max(0, fzTarget);
  const fx = fxTarget;
  const t: LegIdTarget = { side, fz, fx, copX: fc.copX, copZ: fc.copZ, footY: fc.footY };
  const dbg: Record<string, number> = { fz, copX: fc.copX, hipX: 0 };
  const hip = staticJointTorque(w, side, `hip_${side}`, t, boundary, dbg, contacts);
  const knee = staticJointTorque(w, side, `knee_${side}`, t, boundary, dbg, contacts);
  const ankle = staticJointTorque(w, side, `foot_${side}`, t, boundary, dbg, contacts);
  const hp = anchorOf(w, `hip_${side}`);
  if (hp) dbg['hipX'] = hp[0]!;
  dbg['contactCount'] = contacts.length;
  const g = globalThis as { __LEG_ID?: Record<string, Record<string, number>> };
  g.__LEG_ID = g.__LEG_ID ?? {};
  g.__LEG_ID[side] = dbg;
  return {
    side,
    hip: hip + (dynamic.hip ?? 0),
    knee: knee + (dynamic.knee ?? 0),
    ankle: ankle + (dynamic.ankle ?? 0),
    fz,
    copX: fc.copX,
    feasible: fc.contact && fz > 0 && fc.copInside,
  };
}

function staticJointTorque3D(
  w: World, side: 'l' | 'r', jointName: string, t: LegIdTarget,
  _b: LegIdBoundary, contacts: LegContactPoint[] = [],
): number {
  const ji = jointIndex(w, jointName);
  const axis = axisOf(w, jointName);
  const anchor = anchorOf(w, jointName);
  if (ji < 0 || !axis || !anchor) return 0;
  const ax = axis[0]!, ay = axis[1]!, az = axis[2]!;
  let tau = 0;
  const addForce = (rx: number, ry: number, rz: number, fx: number, fy: number, fz: number): void => {
    tau += ax * (ry * fz - rz * fy) + ay * (rz * fx - rx * fz) + az * (rx * fy - ry * fx);
  };
  for (const bi of w.body.subtree[ji] ?? []) {
    const rb = w.body.bodies[bi]!;
    const p = rb.worldCom();
    addForce(p.x - anchor[0]!, p.y - anchor[1]!, p.z - anchor[2]!, 0, -rb.mass() * 9.81, 0);
  }
  if (contacts.length > 0) {
    let sw = 0;
    for (const c of contacts) sw += Math.max(0, c.weight ?? 1);
    for (const c of contacts) {
      const wgt = sw > 1e-9 ? Math.max(0, c.weight ?? 1) / sw : 1 / contacts.length;
      addForce(c.x - anchor[0]!, c.y - anchor[1]!, c.z - anchor[2]!, t.fx * wgt, 0, t.fz * wgt);
    }
  } else {
    addForce(t.copX - anchor[0]!, t.footY - anchor[1]!, t.copZ - anchor[2]!, t.fx, 0, t.fz);
  }
  return tau;
}

export function solveStaticLegTorques3D(
  w: World, side: 'l' | 'r', fc: FootSensorReading, fzTarget: number,
  boundary: LegIdBoundary = {}, dynamic: LegIdDynamic = {}, contacts: LegContactPoint[] = [], fxTarget = 0,
): LegIdTorque {
  const fz = Math.max(0, fzTarget);
  const fx = fxTarget;
  const t: LegIdTarget = { side, fz, fx, copX: fc.copX, copZ: fc.copZ, footY: fc.footY };
  const hip = staticJointTorque3D(w, side, `hip_${side}`, t, boundary, contacts) + (dynamic.hip ?? 0);
  const knee = staticJointTorque3D(w, side, `knee_${side}`, t, boundary, contacts) + (dynamic.knee ?? 0);
  const ankle = staticJointTorque3D(w, side, `foot_${side}`, t, boundary, contacts) + (dynamic.ankle ?? 0);
  return { side, hip, knee, ankle, fz, copX: fc.copX, feasible: fc.contact && fz > 0 && fc.copInside };
}
