import type { MusclePairCommand, MusclePairOutput, MusclePairParams, MusclePairState } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function stepAntagonist(
  state: MusclePairState,
  cmd: MusclePairCommand,
  angle: number,
  vel: number,
  ref: number,
  dt: number,
  p: MusclePairParams,
): MusclePairOutput {
  const co = clamp(cmd.co, 0, 1);
  const e = angle - ref;
  const fl = clamp(1 - 0.5 * (e / Math.max(1e-6, p.lengthRange)) ** 2, 0.2, 1.2);
  const half = cmd.net / Math.max(1e-6, 2 * p.f0 * p.momentArm * fl);
  const aAT = clamp(co + half, 0, 1);
  const aBT = clamp(co - half, 0, 1);
  const alpha = 1 - Math.exp(-dt / Math.max(1e-4, p.tauAct));
  state.aA += (aAT - state.aA) * alpha;
  state.aB += (aBT - state.aB) * alpha;
  const active = (state.aA - state.aB) * p.f0 * p.momentArm * fl;
  const x = Math.abs(e) <= p.slack ? 0 : e - Math.sign(e) * p.slack;
  const passive = p.kPassive * x + p.k3Passive * x * x * x + p.bPassive * vel;
  const raw = active + passive;
  const torque = clamp(raw, -p.cap, p.cap);
  return {
    torque,
    active,
    passive,
    aA: state.aA,
    aB: state.aB,
    stiffness: p.kPassive + 3 * p.k3Passive * x * x + (state.aA + state.aB) * p.f0 * p.momentArm / Math.max(1e-6, p.lengthRange),
    damping: p.bPassive,
    saturated: Math.abs(raw) > p.cap,
  };
}
