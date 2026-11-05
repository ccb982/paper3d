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
  footSign: number;
  maxDelta: number;
  dead: number;
  fadeHz: number;
}

export interface LateralRightingOutput {
  foot0Target: number;
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
  const e = i.targetTilt - i.tilt;
  const dead = Math.abs(i.dead);
  const eff = Math.abs(e) <= dead ? 0 : e - Math.sign(e) * dead;
  const cap = Math.abs(i.maxDelta);
  const delta = Math.max(-cap, Math.min(cap, eff)) * Math.max(0, Math.min(1, i.ramp)) * fade;
  const foot0Target = i.active ? i.baseFoot0 + i.footSign * i.sideSign * delta : i.baseFoot0;
  return { foot0Target, delta, fade, active: i.active };
}

export function resetLateralRighting(st: CS): void {
  _fade.delete(st);
}
