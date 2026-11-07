import type { CourtState as CS } from '../court';

export interface ShankLateralInput {
  side: 'l' | 'r';
  active: boolean;
  grip: boolean;
  dt: number;
  fadeHz: number;
  ikKnee0: number;
  ikFoot0: number;
  actualKnee0: number;
  actualKnee0Vel: number;
  actualFoot0: number;
  actualFoot0Vel: number;
  fParallel: number;
  fPerp: number;
}

export interface ShankLateralOutput {
  knee0Target: number;
  foot0Target: number;
  knee0Ff: number;
  /** 脚主动抓地：foot0 前馈（与 knee0 修正同时出力） */
  foot0Ff: number;
  active: boolean;
  fade: number;
  chainOpen: boolean;
  align: boolean;
  fParallel: number;
  fPerp: number;
}

interface SideState {
  fade: number;
  open: boolean;
}

const _state = new WeakMap<CS, Map<'l' | 'r', SideState>>();
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function shankLateral(st: CS, i: ShankLateralInput): ShankLateralOutput {
  let m = _state.get(st);
  if (!m) { m = new Map(); _state.set(st, m); }
  let s = m.get(i.side);
  if (!s) { s = { fade: 0, open: false }; m.set(i.side, s); }

  const on = i.active && i.grip;
  const a = 1 - Math.exp(-Math.max(0, i.dt) * 2 * Math.PI * Math.max(0.1, i.fadeHz));
  s.fade += ((on ? 1 : 0) - s.fade) * a;

  const openT = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_CHAIN_OPEN ?? 12));
  const closeT = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_CHAIN_CLOSE ?? 25));
  const fAbs = Math.abs(i.fPerp);
  if (!(i.fParallel > 0) || fAbs >= closeT) s.open = false;
  else if (fAbs <= openT) s.open = true;

  const align = on && !s.open;
  const forceAngle = clamp(Math.atan2(i.fPerp, Math.max(1, Math.abs(i.fParallel))), -1.2, 1.2);
  const sideSign = i.side === 'l' ? 1 : -1;
  const ankleSignRaw = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_SIGN ?? 1);
  const ankleSign = Number.isFinite(ankleSignRaw) && ankleSignRaw < 0 ? -1 : 1;
  const ankleK = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_K ?? 1));
  const ankleCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_CAP ?? 0.15));
  // 膝盖不参与侧向回正：knee0 只回 IK/被动；侧向只动踝。
  const knee0Target = i.ikKnee0;
  const ankleDelta = align ? clamp(ankleSign * sideSign * forceAngle * ankleK, -ankleCap, ankleCap) : 0;
  const foot0Target = i.ikFoot0 + ankleDelta * s.fade;

  // 膝盖不参与侧向回正：knee0 只回 IK/被动，knee0Ff=0。
  const footGripK = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_FOOT_GRIP_K ?? 0));
  const footGripD = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_FOOT_GRIP_D ?? 0));
  const footGripCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_FOOT_GRIP_CAP ?? 40));
  // 踝在侧向回正的同时主动抓地：foot0 自己的 PD 电机出力，不是外部约束。
  const foot0Ff = on
    ? clamp(footGripK * (foot0Target - i.actualFoot0) - footGripD * i.actualFoot0Vel, -footGripCap, footGripCap) * s.fade
    : 0;

  return {
    knee0Target,
    foot0Target,
    knee0Ff: 0,
    foot0Ff,
    active: on,
    fade: s.fade,
    chainOpen: s.open,
    align,
    fParallel: i.fParallel,
    fPerp: i.fPerp,
  };
}
