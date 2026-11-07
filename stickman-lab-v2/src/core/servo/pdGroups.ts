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
  /** 肌肉内部反射力矩（例如牵张反射）；已含在 PD 输出内，不是神经 ff */
  muscleExtra?: number,
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
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const bNum = (k: string, d: number): number => {
      const v = Number(env[k]);
      return Number.isFinite(v) ? v : d;
    };
    const bBase = bNum('SQC_HIP_B_MUSCLE', 2);
    const bAct = bNum('SQC_HIP_B_MUSCLE_ACT', 0);
    const bForce = bNum('SQC_HIP_B_MUSCLE_FF', 0);
    const bMax = Math.abs(bNum('SQC_HIP_B_MUSCLE_MAX', 30));
    const bMuscle = Math.max(-bMax, Math.min(bMax, bBase + bAct * Math.abs(s.a) + bForce * Math.min(1, Math.abs(ff) / Math.max(1, cap))));
    // 神经 ff 是下行驱动：进入肌肉后按收缩状态缩放（a·fL·fV·(1+co)），
    // 默认先关（SQC_MUSCLE_FF_SCALE=1 开），避免新环路和旧增益叠加后抖动。
    const ffScaleOn = String(env.SQC_MUSCLE_FF_SCALE ?? '0') !== '0';
    const driveFf = ff * (ffScaleOn ? gain : 1);
    // hip2 牵张反射在肌肉内部（原命令层 hip2TrackFf 迁入；参数属肌肉，不属神经）。
    let reflex = 0;
    if (joint === 'hip' && axis === 2 && String(env.SQC_HIP2_REFLEX_ON ?? '1') !== '0') {
      const rk = bNum('SQC_HIP2_REFLEX_K', 200);
      const rd = bNum('SQC_HIP2_REFLEX_D', 20);
      const rc = Math.abs(bNum('SQC_HIP2_REFLEX_CAP', 60));
      reflex = clamp(rk * err - rd * vel, -rc, rc);
      s.tension += Math.abs(reflex);
    }
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain + movedReflexDamp + (joint === 'hip' ? bMuscle : 0), cap, src, driveFf, pri, supportP2, reflex);
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
    // 神经 ff 进肌肉后按收缩状态缩放（架构 §11.4）；默认关，A/B 用 SQC_MUSCLE_FF_SCALE=1。
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const ffScaleOn = String(env.SQC_MUSCLE_FF_SCALE ?? '0') !== '0';
    const driveFf = ff * (ffScaleOn ? gain : 1);
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain + movedReflexDamp, cap, src, driveFf, pri, supportP2 + passive);
  }
}
