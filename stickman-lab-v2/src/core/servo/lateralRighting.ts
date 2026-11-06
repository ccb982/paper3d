import type { CourtState as CS } from '../court';

export interface LateralRightingInput {
  active: boolean;
  grip: boolean;
  ramp: number;
  dt: number;
  fadeHz: number;
  holdKnee0: number;
  holdFoot0: number;
  ikKnee0: number;
  ikFoot0: number;
  fParallel: number;
  fPerp: number;
}

export interface LateralRightingOutput {
  knee0Target: number;
  foot0Target: number;
  fade: number;
  active: boolean;
  fParallel: number;
  fPerp: number;
}

const _fade = new WeakMap<CS, Map<'l' | 'r' | 'x', number>>();

export function lateralRighting(st: CS, i: LateralRightingInput & { side: 'l' | 'r' }): LateralRightingOutput {
  let m = _fade.get(st);
  if (!m) { m = new Map(); _fade.set(st, m); }
  const prev = m.get(i.side) ?? 0;
  const on = i.active && i.grip;
  const a = 1 - Math.exp(-Math.max(0, i.dt) * 2 * Math.PI * Math.max(0.1, i.fadeHz));
  const fade = prev + ((on ? 1 : 0) - prev) * a;
  m.set(i.side, fade);
  const f = Math.max(0, Math.min(1, fade * Math.max(0, Math.min(1, i.ramp))));
  return {
    knee0Target: i.holdKnee0 + (i.ikKnee0 - i.holdKnee0) * f,
    foot0Target: i.holdFoot0 + (i.ikFoot0 - i.holdFoot0) * f,
    fade,
    active: on,
    fParallel: i.fParallel,
    fPerp: i.fPerp,
  };
}

export function resetLateralRighting(st: CS): void {
  _fade.delete(st);
}
