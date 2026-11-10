import type { JointConfig, MuscleOutput, MuscleParams, MuscleState } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function passive(l: number, v: number, p: MuscleParams, scale: number): number {
  const x = Math.max(0, l - p.length0 - p.slack);
  return scale * (p.k1 * x + p.k3 * x * x * x + p.b * v);
}

function forceLength(l: number, p: MuscleParams): number {
  const x = (l - p.length0) / Math.max(1e-6, p.lengthRange);
  return Math.max(0.2, Math.min(1.2, 1 - 0.5 * x * x));
}

function shortRange(l: number, p: MuscleParams): number {
  return p.kSr * Math.max(-p.xSr, Math.min(p.xSr, l - p.length0));
}

export class AntagonistPair {
  private readonly state: MuscleState = { aA: 0, aB: 0 };

  prime(co: number): void {
    this.state.aA = co;
    this.state.aB = co;
  }

  step(q: number, qd: number, dt: number, c: JointConfig): MuscleOutput {
    const p = c.params;
    const r = p.momentArm;
    const e = q - c.ref;
    const lA = p.length0 + r * e;
    const lB = p.length0 - r * e;
    const vA = r * qd;
    const vB = -r * qd;
    const net = c.kp * (q - c.ref) + c.kd * qd;
    const half = net / Math.max(1e-6, 2 * p.f0 * r);
    const aAT = clamp(c.co + half, 0, 1);
    const aBT = clamp(c.co - half, 0, 1);
    const alphaA = 1 - Math.exp(-dt / Math.max(1e-4, aAT > this.state.aA ? p.tauAct : p.tauDeact));
    const alphaB = 1 - Math.exp(-dt / Math.max(1e-4, aBT > this.state.aB ? p.tauAct : p.tauDeact));
    this.state.aA += (aAT - this.state.aA) * alphaA;
    this.state.aB += (aBT - this.state.aB) * alphaB;
    const active = (this.state.aA * (p.f0 * forceLength(lA, p) + shortRange(lA, p)) - this.state.aB * (p.f0 * forceLength(lB, p) + shortRange(lB, p))) * r;
    const scale = Math.max(0, c.compression ?? 1);
    const passiveTorque = (passive(lA, vA, p, scale) - passive(lB, vB, p, scale)) * r;
    const raw = -active - passiveTorque - c.jointDamping * qd + c.base;
    return {
      torque: clamp(raw, -p.cap, p.cap),
      active,
      passive: passiveTorque,
      base: c.base,
      aA: this.state.aA,
      aB: this.state.aB,
    };
  }
}
