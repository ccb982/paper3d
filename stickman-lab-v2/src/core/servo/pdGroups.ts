import type { World } from '../world';
import { PRI, propose } from '../proposalBus';
import { AntagonistPair } from './squatV6/muscle';
import type { JointConfig, MuscleParams } from './squatV6/types';

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
  /** 肌肉纺锤体低通速度（rad/s）；牵张反射用它，不用原始 d.vel */
  vLp: number;
}

const _pairState = new WeakMap<World, Map<string, AntagonistPair>>();
const envN = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

function pairFor(w: World, key: string): AntagonistPair {
  let m = _pairState.get(w);
  if (!m) { m = new Map(); _pairState.set(w, m); }
  let p = m.get(key);
  if (!p) { p = new AntagonistPair(); p.prime(envN('SQC_PD_PAIR_CO', 0.9)); m.set(key, p); }
  return p;
}

function pairParams(cap: number, joint: string, passiveScale = 1): MuscleParams {
  const f0s = joint === 'hip' ? envN('SQC_PD_PAIR_F0_HIP', 1.0) : joint === 'knee' ? envN('SQC_PD_PAIR_F0_KNEE', 1.0) : envN('SQC_PD_PAIR_F0_FOOT', 1);
  return {
    f0: Math.max(120, cap * 4 * f0s), momentArm: 0.1, length0: 0, lengthRange: 0.3,
    k1: 40 * passiveScale, k3: 100 * passiveScale, b: 4 * passiveScale, kSr: envN('SQC_PD_PAIR_KSR', 16000), xSr: 0.005, slack: 0.005,
    tauAct: 0.05, tauDeact: 0.08, cap: Math.max(100, cap * 1.2),
  };
}

function pairPD(w: World, side: 'l' | 'r', joint: string, axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number): boolean {
  if (envN('SQC_PD_PAIR', 1) !== 1) return false;
  const lateralHip = joint === 'hip' && (axis === 0 || axis === 1) && envN('SQC_PD_PAIR_HIP_LAT', 0) === 1;
  if (!(joint === 'hip' && axis === 2) && !lateralHip) return false;
  const i = w.body.dofByName(`${joint}_${side}`, axis);
  const d = i >= 0 ? w.body.dofs[i] : undefined;
  if (!d) return false;
  const supportSide = (globalThis as unknown as { __SUPPORT_SIDE?: 'l' | 'r' }).__SUPPORT_SIDE;
  const isSupport = lateralHip && supportSide === side;
  const lock = lateralHip && (Math.abs(target - d.angle) > envN('SQC_HIP_LOCK_E', 0.035) || Math.abs(d.vel) > envN('SQC_HIP_LOCK_V', 0.6));
  const co = lateralHip
    ? (lock ? envN('SQC_PD_PAIR_LOCK_CO', 0.95) : (isSupport ? envN('SQC_PD_PAIR_CO_SUPPORT', 0.45) : envN('SQC_PD_PAIR_CO_LAT', 0.25)))
    : envN('SQC_PD_PAIR_CO', 0.9);
  const passiveScale = isSupport ? envN('SQC_PD_PAIR_PASSIVE_SUPPORT', 1.5) : 1;
  const cfg: JointConfig = {
    inertia: Math.max(0.05, d.inertia), jointDamping: envN('SQC_PD_PAIR_DAMP', 0),
    ref: target, base: ff * envN(joint === 'hip' ? 'SQC_PD_PAIR_BASE_SIGN_HIP' : joint === 'knee' ? 'SQC_PD_PAIR_BASE_SIGN_KNEE' : 'SQC_PD_PAIR_BASE_SIGN_FOOT', 1), co, kp, kd, compression: 1,
    params: pairParams(cap, joint, passiveScale),
  };
  const m = pairFor(w, `${side}:${joint}:${axis}`).step(d.angle, d.vel, w.dt, cfg);
  const sg = joint === 'hip' ? envN('SQC_PD_PAIR_SIGN_HIP', 1)
    : joint === 'knee' ? envN('SQC_PD_PAIR_SIGN_KNEE', 1)
    : envN('SQC_PD_PAIR_SIGN_FOOT', 1);
  propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'support', tau: m.torque * sg, src });
  return true;
}
const _state = new WeakMap<World, Map<string, MuscleState>>();
export function resetPdGroups(w: World): void { _state.delete(w); }
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function getState(w: World, key: string): MuscleState {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(key);
  if (!s) { s = { a: 1, co: 0, tension: 0, vLp: 0 }; m.set(key, s); }
  return s;
}

function stepState(
  w: World, s: MuscleState, u: number, err: number, ff: number,
  cap: number, angle: number, vel: number, kp: number, kd: number, toneCo = 0,
): number {
  const dt = Math.max(0, Math.min(0.05, w.dt));
  s.a += (u - s.a) * Math.min(1, dt / 0.08);
  const coTarget = clamp(Math.max(0, Math.min(0.2, toneCo)) + 0.15 * Math.abs(ff) / Math.max(1, cap) + 0.1 * Math.abs(err) / 0.35, 0, 0.2);
  s.co += (coTarget - s.co) * Math.min(1, dt / 0.12);
  const fL = clamp(1 - 0.1 * Math.pow(Math.abs(angle) / 1.2, 2), 0.9, 1.05);
  const fV = clamp(1 - 0.1 * Math.abs(vel), 0.9, 1.05);
  s.tension = Math.abs(ff) + Math.abs(kp * err) + Math.abs(kd * vel);
  return s.a * fL * fV * (1 + s.co);
}

export class HipTaskPD {
  constructor(private readonly w: World, private readonly write: PdWriter) {}

  hip0(side: 'l' | 'r', target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri = PRI.reflex, passiveScale = 1): void {
    this.apply(side, 'hip', 0, target, kp, kd, cap, src, ff, pri, passiveScale);
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

  private apply(side: 'l' | 'r', joint: 'hip' | 'knee', axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff: number, pri: number, passiveScale = 1): void {
    const s = getState(this.w, `${side}:${joint}:${axis}`);
    const i = this.w.body.dofByName(`${joint}_${side}`, axis);
    const d = i >= 0 ? this.w.body.dofs[i] : undefined;
    const angle = d?.angle ?? 0;
    const vel = d?.vel ?? 0;
    if (pairPD(this.w, side, joint, axis, target, kp, kd, cap, src, ff)) return;
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const dt = Math.max(0, Math.min(0.05, this.w.dt));
    // 肌梭低通：默认 40ms；SQC_HIP2_REFLEX_LP=0 回原始速度做 A/B。
    const reflexLp = Math.max(0, Number(env.SQC_HIP2_REFLEX_LP ?? 0.04));
    s.vLp += (vel - s.vLp) * (reflexLp > 0 ? Math.min(1, dt / reflexLp) : 1);
    const err = target - angle;
    const u = clamp(0.85 + 0.15 * (Math.abs(err) / 0.35 + Math.abs(ff) / Math.max(1, cap)), 0.85, 1.05);
    const toneCo = Math.max(0, Math.min(0.2, Number(env.SQC_TONE_CO_HIP ?? 0)));
    const gain = stepState(this.w, s, u, err, ff, cap, angle, vel, kp, kd, toneCo);
    const supportP2 = i >= 0 ? this.w.drive.supportTorque(i) * passiveScale : 0;
    const movedReflexDamp = i >= 0 ? (this.w.drive.dampingParts[i]?.reflex ?? 0) : 0;
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
    // 2026-11-07：低通（40ms）版本默认开；SQC_HIP2_REFLEX_ON=0 可回关。
    if (joint === 'hip' && axis === 2 && String(env.SQC_HIP2_REFLEX_ON ?? '1') !== '0') {
      const rk = bNum('SQC_HIP2_REFLEX_K', 200);
      const rd = bNum('SQC_HIP2_REFLEX_D', 20);
      const rc = Math.abs(bNum('SQC_HIP2_REFLEX_CAP', 60));
      reflex = clamp(rk * err - rd * s.vLp, -rc, rc);
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
    if (pairPD(this.w, side, joint, axis, target, kp, kd, cap, src, ff)) return;
    const err = target - angle;
    const u = clamp(0.85 + 0.15 * (Math.abs(err) / 0.35 + Math.abs(ff) / Math.max(1, cap)), 0.85, 1.05);
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const toneCo = joint === 'knee' ? Math.max(0, Math.min(0.2, Number(env.SQC_TONE_CO_KNEE ?? 0))) : 0;
    const gain = stepState(this.w, s, u, err, ff, cap, angle, vel, kp, kd, toneCo);
    const supportP2 = i >= 0 ? this.w.drive.supportTorque(i) : 0;
    const movedReflexDamp = i >= 0 ? (this.w.drive.dampingParts[i]?.reflex ?? 0) : 0;
    // 神经 ff 进肌肉后按收缩状态缩放（架构 §11.4）；默认关，A/B 用 SQC_MUSCLE_FF_SCALE=1。
    const ffScaleOn = String(env.SQC_MUSCLE_FF_SCALE ?? '0') !== '0';
    const driveFf = ff * (ffScaleOn ? gain : 1);
    this.write(this.w, `${joint}_${side}`, axis, target, kp * gain, kd * gain + movedReflexDamp, cap, src, driveFf, pri, supportP2 + passive);
  }
}
