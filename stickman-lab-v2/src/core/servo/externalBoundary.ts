import type { World } from '../world';
import type { LegIdBoundary } from './legInverseDynamics';

interface BodyVel { x: number; y: number; z: number }
const _prev = new WeakMap<World, Map<number, BodyVel>>();
const _cache = new WeakMap<World, { clock: number; l: ExternalBoundary; r: ExternalBoundary }>();

export interface ExternalBoundary {
  hip: LegIdBoundary;
  knee: LegIdBoundary;
  valid: boolean;
}

export function resetExternalBoundary(w: World): void {
  _prev.delete(w);
}

function jointIndex(w: World, name: string): number {
  return w.sk.joints.findIndex((j) => j.name === name);
}

function outsideSubtree(w: World, subtree: readonly number[], bodyIndex: number): boolean {
  for (const b of subtree) if (b === bodyIndex) return false;
  return true;
}

function wrenchAt(w: World, anchor: { x: number; y: number; z: number }, subtree: readonly number[], prev: Map<number, BodyVel>, useAccel: boolean): { force: { x: number; y: number; z: number }; moment: { x: number; y: number; z: number } } {
  let fx = 0, fy = 0, fz = 0, mx = 0, my = 0, mz = 0;
  const dt = Math.max(1e-4, w.dt);
  for (let i = 0; i < w.body.bodies.length; i++) {
    if (!outsideSubtree(w, subtree, i)) continue;
    const rb = w.body.bodies[i]!;
    const p = rb.worldCom();
    const v = rb.linvel();
    const pv = prev.get(i) ?? { x: v.x, y: v.y, z: v.z };
    const ax = (v.x - pv.x) / dt;
    const ay = (v.y - pv.y) / dt;
    const az = (v.z - pv.z) / dt;
    const m = rb.mass();
    const Fx = m * ax;
    const Fy = m * (ay + 9.81);
    const Fz = m * az;
    const rx = p.x - anchor.x;
    const ry = p.y - anchor.y;
    const rz = p.z - anchor.z;
    fx += Fx; fy += Fy; fz += Fz;
    mx += ry * Fz - rz * Fy;
    my += rz * Fx - rx * Fz;
    mz += rx * Fy - ry * Fx;
  }
  for (const c of w.body.allContactSamples(w.dt)) {
    if (!outsideSubtree(w, subtree, c.body)) continue;
    const rx = c.x - anchor.x;
    const ry = c.y - anchor.y;
    const rz = c.z - anchor.z;
    fx += c.fx; fy += c.fy; fz += c.fz;
    mx += ry * c.fz - rz * c.fy;
    my += rz * c.fx - rx * c.fz;
    mz += rx * c.fy - ry * c.fx;
  }
  return { force: { x: fx, y: fy, z: fz }, moment: { x: mx, y: my, z: mz } };
}

function estimateSide(w: World, side: 'l' | 'r', prev: Map<number, BodyVel>): ExternalBoundary {
  const hip = jointIndex(w, `hip_${side}`);
  const knee = jointIndex(w, `knee_${side}`);
  const hipDof = w.body.dofByName(`hip_${side}`, 2);
  const kneeDof = w.body.dofByName(`knee_${side}`, 2);
  if (hip < 0 || knee < 0 || hipDof < 0 || kneeDof < 0) return { hip: {}, knee: {}, valid: false };
  const hipAnchor = w.body.dofs[hipDof]!.anchorWorld;
  const kneeAnchor = w.body.dofs[kneeDof]!.anchorWorld;
  const useAccel = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_EXT_ACCEL ?? '0') === '1';
  const h = wrenchAt(w, { x: hipAnchor[0]!, y: hipAnchor[1]!, z: hipAnchor[2]! }, w.body.subtree[hip] ?? [], prev, useAccel);
  const k = wrenchAt(w, { x: kneeAnchor[0]!, y: kneeAnchor[1]!, z: kneeAnchor[2]! }, w.body.subtree[knee] ?? [], prev, useAccel);
  return {
    hip: { hipForce: h.force, hipMoment: h.moment },
    knee: { kneeForce: k.force, kneeMoment: k.moment },
    valid: true,
  };
}

export function estimateExternalBoundary(w: World, side: 'l' | 'r'): ExternalBoundary {
  let prev = _prev.get(w);
  if (!prev) { prev = new Map(); _prev.set(w, prev); }
  const cached = _cache.get(w);
  if (cached && cached.clock === w.clock) return side === 'l' ? cached.l : cached.r;
  const l = estimateSide(w, 'l', prev);
  const r = estimateSide(w, 'r', prev);
  for (let i = 0; i < w.body.bodies.length; i++) {
    const v = w.body.bodies[i]!.linvel();
    prev.set(i, { x: v.x, y: v.y, z: v.z });
  }
  _cache.set(w, { clock: w.clock, l, r });
  return side === 'l' ? l : r;
}
