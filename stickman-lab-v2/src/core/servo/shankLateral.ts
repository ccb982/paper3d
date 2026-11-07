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
  fParallel: number;
  fPerp: number;
}

export interface ShankLateralOutput {
  knee0Target: number;
  foot0Target: number;
  knee0Ff: number;
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
  const alignCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ALIGN_CAP ?? 0.1));
  let target = i.ikKnee0;
  if (align) {
    const cand = i.actualKnee0 + sideSign * forceAngle;
    target = Math.abs(cand) < Math.abs(i.actualKnee0) && Math.abs(i.actualKnee0) > 1e-4 ? i.actualKnee0 : cand;
    target = clamp(target, i.ikKnee0 - alignCap, i.ikKnee0 + alignCap);
  }

  const ffAlignK = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ALIGN_FF ?? 120));
  const ffAlignCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ALIGN_FF_CAP ?? 50));
  const ffIkK = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_IK_FF ?? 80));
  const ffIkCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_IK_FF_CAP ?? 20));
  const ff = align
    ? clamp(ffAlignK * (target - i.actualKnee0), -ffAlignCap, ffAlignCap)
    : clamp(ffIkK * (i.ikKnee0 - i.actualKnee0), -ffIkCap, ffIkCap);

  return {
    knee0Target: i.ikKnee0 + (target - i.ikKnee0) * s.fade,
    foot0Target: i.ikFoot0,
    knee0Ff: on ? ff * s.fade : 0,
    active: on,
    fade: s.fade,
    chainOpen: s.open,
    align,
    fParallel: i.fParallel,
    fPerp: i.fPerp,
  };
}
