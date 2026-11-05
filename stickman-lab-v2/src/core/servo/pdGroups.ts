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
) => void;

interface MuscleState {
  a: number;
  co: number;
  tension: number;
}

const _state = new WeakMap<World, Map<string, MuscleState>>();

function getState(w: World, key: string): MuscleState {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(key);
  if (!s) { s = { a: 1, co: 0, tension: 0 }; m.set(key, s); }
  return s;
}

function stepState(w: World, s: MuscleState): void {
  const dt = Math.max(0, Math.min(0.05, w.dt));
  s.a += (1 - s.a) * Math.min(1, dt / 0.08);
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

  knee2(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'knee', 2, target, kp, kd, cap, src, ff, pri);
  }

  tension(side: 'l' | 'r', joint: 'hip' | 'knee'): number {
    return getState(this.w, `${side}:${joint}:2`).tension;
  }

  private apply(side: 'l' | 'r', joint: 'hip' | 'knee', axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number, pri: number): void {
    const s = getState(this.w, `${side}:${joint}:${axis}`);
    stepState(this.w, s);
    const gain = s.a * (1 + s.co);
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain, cap, src, ff, pri);
  }
}

export class ShankTaskPD {
  constructor(private readonly w: World, private readonly write: PdWriter) {}

  knee0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'knee', 0, target, kp, kd, cap, src, ff, pri);
  }

  knee1(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'knee', 1, target, kp, kd, cap, src, ff, pri);
  }

  foot0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex): void {
    this.apply(side, 'foot', 0, target, kp, kd, cap, src, ff, pri);
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

  private apply(side: 'l' | 'r', joint: 'knee' | 'foot', axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number, pri: number): void {
    const s = getState(this.w, `${side}:${joint}:${axis}`);
    stepState(this.w, s);
    const gain = s.a * (1 + s.co);
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain, cap, src, ff, pri);
  }
}
