/** 侧向命令层：只输出 foot0 目标，不写 hip，不直接出力矩。 */
import type { CourtState as CS } from '../court';

export interface LateralRightingInput {
  side: 'l' | 'r';
  sideSign: number;
  tilt: number;
  targetTilt: number;
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
  footSign: number;
  maxDelta: number;
  dead: number;
  fadeHz: number;
}

export interface LateralRightingOutput {
  foot0Target: number;
  knee0Target: number;
  foot0Ff: number;
  delta: number;
  fade: number;
  active: boolean;
}

const _fade = new WeakMap<CS, Map<'l' | 'r', number>>();

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
  const foot0Target = i.active ? i.baseFoot0 + i.footSign * i.sideSign * delta : i.baseFoot0;
  const foot0Ff = i.active ? Math.max(-Math.abs(i.ffCap), Math.min(Math.abs(i.ffCap), i.ffK * delta)) : 0;
  return { foot0Target, knee0Target: i.baseKnee0, foot0Ff, delta, fade, active: i.active };
}

export function resetLateralRighting(st: CS): void {
  _fade.delete(st);
}
