/** 侧向命令层：只输出 foot0 目标，不写 hip，不直接出力矩。 */
import type { CourtState as CS } from '../court';

export interface LateralRightingInput {
  side: 'l' | 'r';
  sideSign: number;
  tilt: number;
  targetTilt: number;
  ffHz: number;
  active: boolean;
  ramp: number;
  dt: number;
  baseFoot0: number;
  baseKnee0: number;
  fPerp: number;
  fParallel: number;
  forceK: number;
  ffK: number;
  ffCap: number;
  kneeSign: number;
  footSign: number;
  maxDelta: number;
  dead: number;
  fadeHz: number;
}

export interface LateralRightingOutput {
  foot0Target: number;
  knee0Target: number;
  knee0Ff: number;
  foot0Ff: number;
  delta: number;
  fade: number;
  active: boolean;
}

const _fade = new WeakMap<CS, Map<'l' | 'r', number>>();
const _ffLp = new WeakMap<CS, Map<'l' | 'r', number>>();

export function lateralRighting(st: CS, i: LateralRightingInput): LateralRightingOutput {
  let m = _fade.get(st);
  if (!m) { m = new Map(); _fade.set(st, m); }
  const prev = m.get(i.side) ?? 0;
  const target = i.active ? 1 : 0;
  const a = 1 - Math.exp(-Math.max(0, i.dt) * 2 * Math.PI * Math.max(0.1, i.fadeHz));
  const fade = prev + (target - prev) * a;
  m.set(i.side, fade);
  const forceErr = i.fPerp;
  const forceDelta = Math.abs(i.forceK) * forceErr;
  const tiltErr = i.targetTilt - i.tilt;
  const dead = Math.abs(i.dead);
  const effForce = Math.abs(forceDelta) <= dead ? 0 : forceDelta - Math.sign(forceDelta) * dead;
  const effTilt = Math.abs(tiltErr) <= dead ? 0 : tiltErr - Math.sign(tiltErr) * dead;
  const eff = Math.abs(i.forceK) > 0 ? effForce : effTilt;
  const cap = Math.abs(i.maxDelta);
  const delta = Math.max(-cap, Math.min(cap, eff)) * Math.max(0, Math.min(1, i.ramp)) * fade;
  const knee0Target = i.active ? i.baseKnee0 + i.kneeSign * i.sideSign * delta : i.baseKnee0;
  const foot0Target = i.baseFoot0;
  let ffs = _ffLp.get(st);
  if (!ffs) { ffs = new Map(); _ffLp.set(st, ffs); }
  const prevFf = ffs.get(i.side) ?? 0;
  const targetFf = i.active ? Math.max(-Math.abs(i.ffCap), Math.min(Math.abs(i.ffCap), i.kneeSign * i.ffK * delta)) : 0;
  const aFf = 1 - Math.exp(-Math.max(0, i.dt) * 2 * Math.PI * Math.max(0.1, i.ffHz));
  const knee0Ff = prevFf + (targetFf - prevFf) * aFf;
  ffs.set(i.side, knee0Ff);
  return { foot0Target, knee0Target, knee0Ff, foot0Ff: 0, delta, fade, active: i.active };
}

export function resetLateralRighting(st: CS): void {
  _fade.delete(st);
  _ffLp.delete(st);
}
