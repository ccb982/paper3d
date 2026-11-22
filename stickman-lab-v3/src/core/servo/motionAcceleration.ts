/**
 * MotionAcceleration —— 高精度运动加速度快照。
 *
 * 输入：当前物理步的原始 qd / 刚体线速度 / 角速度。
 * 输出：
 *   - 每个 DoF 的 qdd
 *   - 每个刚体的线加速度 / 角加速度
 *   - 全身质心加速度（按质量加权）
 *
 * 不做 100ms 低通，不做 comAcc 二次差分。
 * 加速度来自相邻物理步的原始速度差；与控制同帧，但有一物理步延迟。
 */
import type { World } from '../world';

export interface MotionAcceleration {
  t: number;
  dt: number;
  valid: boolean;
  dofAcc: Float64Array;
  bodyLinAcc: Float64Array;
  bodyAngAcc: Float64Array;
  comAcc: Float64Array;
  contactForce: Float64Array;
  contactAcc: Float64Array;
}

interface Snapshot {
  t: number;
  dofVel: Float64Array;
  lin: Float64Array;
  ang: Float64Array;
}

const _state = new WeakMap<World, { prev: Snapshot | null; out: MotionAcceleration | null }>();

function alloc(n: number): Float64Array {
  return new Float64Array(n);
}

function copyDofs(w: World, out: Float64Array): void {
  for (let i = 0; i < out.length; i++) out[i] = w.body.dofs[i]?.vel ?? 0;
}

function copyBodies(w: World, lin: Float64Array, ang: Float64Array): void {
  const n = w.body.allBodies.length;
  for (let i = 0; i < n; i++) {
    const b = w.body.allBodies[i]!;
    const v = b.linvel();
    const a = b.angvel();
    lin[i * 3] = v.x; lin[i * 3 + 1] = v.y; lin[i * 3 + 2] = v.z;
    ang[i * 3] = a.x; ang[i * 3 + 1] = a.y; ang[i * 3 + 2] = a.z;
  }
}

export function sampleMotionAcceleration(w: World): MotionAcceleration {
  let s = _state.get(w);
  if (!s) { s = { prev: null, out: null }; _state.set(w, s); }
  if (s.out && s.out.t === w.clock) return s.out;

  const nd = w.body.dofs.length;
  const nb = w.body.allBodies.length;
  const dofVel = alloc(nd);
  const lin = alloc(nb * 3);
  const ang = alloc(nb * 3);
  copyDofs(w, dofVel);
  copyBodies(w, lin, ang);

  const first = s.prev === null;
  const dt = first ? w.dt : Math.max(1e-5, w.clock - s.prev!.t);
  const dofAcc = alloc(nd);
  const bodyLinAcc = alloc(nb * 3);
  const bodyAngAcc = alloc(nb * 3);
  const comAcc = alloc(3);
  const contactForce = alloc(3);
  const contactAcc = alloc(3);
  const valid = !first && dt > 1e-5;
  if (valid && s.prev) {
    const p = s.prev;
    for (let i = 0; i < nd; i++) dofAcc[i] = (dofVel[i]! - p.dofVel[i]!) / dt;
    for (let i = 0; i < nb * 3; i++) {
      bodyLinAcc[i] = (lin[i]! - p.lin[i]!) / dt;
      bodyAngAcc[i] = (ang[i]! - p.ang[i]!) / dt;
    }
    let mt = 0;
    for (let i = 0; i < nb; i++) {
      const m = w.body.allBodies[i]!.mass();
      if (m <= 0) continue;
      mt += m;
      comAcc[0]! += m * bodyLinAcc[i * 3]!;
      comAcc[1]! += m * bodyLinAcc[i * 3 + 1]!;
      comAcc[2]! += m * bodyLinAcc[i * 3 + 2]!;
    }
    if (mt > 0) { comAcc[0]! /= mt; comAcc[1]! /= mt; comAcc[2]! /= mt; }

    let mass = 0;
    for (const b of w.body.allBodies) mass += b.mass();
    for (const c of w.body.allContactSamples(w.dt)) {
      contactForce[0]! += c.fx;
      contactForce[1]! += c.fy;
      contactForce[2]! += c.fz;
    }
    if (mass > 0) {
      contactAcc[0] = contactForce[0]! / mass;
      contactAcc[1] = contactForce[1]! / mass - 9.81;
      contactAcc[2] = contactForce[2]! / mass;
    }
  }

  const out: MotionAcceleration = { t: w.clock, dt, valid, dofAcc, bodyLinAcc, bodyAngAcc, comAcc, contactForce, contactAcc };
  s.prev = { t: w.clock, dofVel, lin, ang };
  s.out = out;

  const g = globalThis as { __MOTION_ACC?: Record<string, unknown> };
  const pick = (n: string, a: number): number => {
    const i = w.body.dofByName(n, a);
    return i >= 0 ? dofAcc[i]! : 0;
  };
  g.__MOTION_ACC = {
    t: w.clock,
    dt,
    valid,
    comAccX: comAcc[0]!,
    comAccY: comAcc[1]!,
    comAccZ: comAcc[2]!,
    contactAccX: contactAcc[0]!,
    contactAccY: contactAcc[1]!,
    contactAccZ: contactAcc[2]!,
    hip2Acc: pick('hip_l', 2),
    hip2AccR: pick('hip_r', 2),
    knee2Acc: pick('knee_l', 2),
    knee2AccR: pick('knee_r', 2),
    ankle2Acc: pick('foot_l', 2),
    ankle2AccR: pick('foot_r', 2),
  };

  return out;
}
