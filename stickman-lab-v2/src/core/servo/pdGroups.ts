import type { World } from '../world';
import { PRI } from '../proposalBus';

export type PdWriter = (
  w: World,
  name: string,
  axis: number,
  target: number,
  kp: number,
  kd: number,
  cap: number,
  src: string,
  ff?: number,
  pri?: number,
  passive?: number,
) => void;

interface MuscleState {
  a: number;
  co: number;
  tension: number;
}

const _state = new WeakMap<World, Map<string, MuscleState>>();
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function getState(w: World, key: string): MuscleState {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(key);
  if (!s) { s = { a: 1, co: 0, tension: 0 }; m.set(key, s); }
  return s;
}

function stepState(
  w: World, s: MuscleState, u: number, err: number, ff: number,
  cap: number, angle: number, vel: number, kp: number, kd: number,
): number {
  const dt = Math.max(0, Math.min(0.05, w.dt));
  s.a += (u - s.a) * Math.min(1, dt / 0.08);
  const coTarget = clamp(0.15 * Math.abs(ff) / Math.max(1, cap) + 0.1 * Math.abs(err) / 0.35, 0, 0.2);
  s.co += (coTarget - s.co) * Math.min(1, dt / 0.12);
  const fL = clamp(1 - 0.1 * Math.pow(Math.abs(angle) / 1.2, 2), 0.9, 1.05);
  const fV = clamp(1 - 0.1 * Math.abs(vel), 0.9, 1.05);
  s.tension = Math.abs(ff) + Math.abs(kp * err) + Math.abs(kd * vel);
  return s.a * fL * fV * (1 + s.co);
}

export class HipTaskPD {
  constructor(private readonly w: World, private readonly write: PdWriter) {}

  hip0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'hip', 0, target, kp, kd, cap, src, ff, pri);
  }

  hip1(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'hip', 1, target, kp, kd, cap, src, ff, pri);
  }

  hip2(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'hip', 2, target, kp, kd, cap, src, ff, pri);
  }

  tension(side: 'l' | 'r', joint: 'hip' | 'knee'): number {
    return getState(this.w, `${side}:${joint}:2`).tension;
  }

  private apply(side: 'l' | 'r', joint: 'hip' | 'knee', axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number, pri: number): void {
    const s = getState(this.w, `${side}:${joint}:${axis}`);
    const i = this.w.body.dofByName(`${joint}_${side}`, axis);
    const d = i >= 0 ? this.w.body.dofs[i] : undefined;
    const angle = d?.angle ?? 0;
    const vel = d?.vel ?? 0;
    const err = target - angle;
    const u = clamp(0.85 + 0.15 * (Math.abs(err) / 0.35 + Math.abs(ff) / Math.max(1, cap)), 0.85, 1.05);
    const gain = stepState(this.w, s, u, err, ff, cap, angle, vel, kp, kd);
    const supportP2 = i >= 0 ? this.w.drive.supportTorque(i) : 0;
    const movedReflexDamp = i >= 0 ? (this.w.drive.dampingParts[i]?.reflex ?? 0) : 0;
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain + movedReflexDamp, cap, src, ff, pri, supportP2);
  }
}

export class ShankTaskPD {
  constructor(private readonly w: World, private readonly write: PdWriter) {}

  knee0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex, passive = 0): void {
    this.apply(side, 'knee', 0, target, kp, kd, cap, src, ff, pri, passive);
  }

  knee1(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'knee', 1, target, kp, kd, cap, src, ff, pri);
  }

  knee2(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'knee', 2, target, kp, kd, cap, src, ff, pri);
  }

  foot0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex, passive = 0): void {
    this.apply(side, 'foot', 0, target, kp, kd, cap, src, ff, pri, passive);
  }

  foot1(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'foot', 1, target, kp, kd, cap, src, ff, pri);
  }

  foot2(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'foot', 2, target, kp, kd, cap, src, ff, pri);
  }

  tension(side: 'l' | 'r', joint: 'knee' | 'foot'): number {
    return getState(this.w, `${side}:${joint}:0`).tension;
  }

  private apply(side: 'l' | 'r', joint: 'knee' | 'foot', axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number, pri: number, passive = 0): void {
    const s = getState(this.w, `${side}:${joint}:${axis}`);
    const i = this.w.body.dofByName(`${joint}_${side}`, axis);
    const d = i >= 0 ? this.w.body.dofs[i] : undefined;
    const angle = d?.angle ?? 0;
    const vel = d?.vel ?? 0;
    const err = target - angle;
    const u = clamp(0.85 + 0.15 * (Math.abs(err) / 0.35 + Math.abs(ff) / Math.max(1, cap)), 0.85, 1.05);
    const gain = stepState(this.w, s, u, err, ff, cap, angle, vel, kp, kd);
    const supportP2 = i >= 0 ? this.w.drive.supportTorque(i) : 0;
    const movedReflexDamp = i >= 0 ? (this.w.drive.dampingParts[i]?.reflex ?? 0) : 0;
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain + movedReflexDamp, cap, src, ff, pri, supportP2 + passive);
  }
}
