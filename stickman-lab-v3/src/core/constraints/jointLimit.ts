import type { World } from '../world';
import type { Sensors } from '../sensors';
import { baseState } from '../servo/baseTable';

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

interface LimitState {
  i: number;
  ref: number;
  lo: number;
  hi: number;
}

export class JointLimitConstraint {
  readonly id = 'joint-limit';
  readonly priority = 10;
  private limits: LimitState[] = [];

  reset(): void {
    this.limits = [];
  }

  step(w: World, _sensors: Sensors, _dt: number): void {
    if (num('SQC_JOINT_LIMIT', 1) !== 1) return;
    if (baseState() !== 'squat') {
      this.reset();
      return;
    }
    if (this.limits.length === 0) this.capture(w);
    const frac = Math.abs(num('SQC_JOINT_LIMIT_FRAC', 0.25));
    const kp = Math.abs(num('SQC_JOINT_LIMIT_KP', 2000));
    const kd = Math.abs(num('SQC_JOINT_LIMIT_KD', 80));
    const cap = Math.abs(num('SQC_JOINT_LIMIT_CAP', 100));
    for (const s of this.limits) {
      const d = w.body.dofs[s.i]!;
      const v = Math.max(-2, Math.min(2, d.vel));
      let tau = 0;
      if (d.angle < s.lo) tau = kp * (s.lo - d.angle) - kd * v;
      else if (d.angle > s.hi) tau = kp * (s.hi - d.angle) - kd * v;
      if (tau === 0) continue;
      tau = Math.max(-cap, Math.min(cap, tau));
      w.executor.addExternalTorque(s.i, tau, cap);
    }
  }

  private capture(w: World): void {
    const frac = Math.abs(num('SQC_JOINT_LIMIT_FRAC', 0.25));
    const list: LimitState[] = [];
    const includeFoot = num('SQC_JOINT_LIMIT_FOOT', 1) === 1;
    const joints = includeFoot ? (['hip', 'knee', 'foot'] as const) : (['hip', 'knee'] as const);
    for (const jn of joints) {
      for (const side of ['l', 'r'] as const) {
        for (const ax of [0, 2] as const) {
          const i = w.body.dofByName(`${jn}_${side}`, ax);
          if (i < 0) continue;
          const d = w.body.dofs[i]!;
          const band = Math.max(1e-3, frac * Math.abs(d.max - d.min));
          list.push({
            i,
            ref: d.angle,
            lo: Math.max(d.min, d.angle - band),
            hi: Math.min(d.max, d.angle + band),
          });
        }
      }
    }
    this.limits = list;
  }
}
