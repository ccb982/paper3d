import type { World } from '../world';
import type { Sensors } from '../sensors';
import { baseState } from '../servo/baseTable';

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

interface HipRef {
  i: number;
  ref: number;
}

export class HipHubConstraint {
  readonly id = 'hip-hub';
  readonly priority = 5;
  private refs: HipRef[] = [];

  reset(): void {
    this.refs = [];
  }

  step(w: World, _sensors: Sensors, _dt: number): void {
    if (num('SQC_HIP_HUB', 0) !== 1) return;
    if (baseState() !== 'squat') {
      this.reset();
      return;
    }
    if (this.refs.length === 0) this.capture(w);
    const kp = Math.abs(num('SQC_HIP_HUB_KP', 3000));
    const kd = Math.abs(num('SQC_HIP_HUB_KD', 100));
    const cap = Math.abs(num('SQC_HIP_HUB_CAP', 400));
    const dead = Math.abs(num('SQC_HIP_HUB_DEAD', 0.005));
    const vmax = Math.abs(num('SQC_HIP_HUB_VEL_MAX', 2));
    for (const s of this.refs) {
      const d = w.body.dofs[s.i]!;
      const e = s.ref - d.angle;
      if (Math.abs(e) < dead) continue;
      const v = Math.max(-vmax, Math.min(vmax, d.vel));
      const tau = Math.max(-cap, Math.min(cap, kp * e - kd * v));
      if (Math.abs(tau) < 1e-6) continue;
      w.executor.addExternalTorque(s.i, tau, cap);
    }
  }

  private capture(w: World): void {
    const list: HipRef[] = [];
    for (const side of ['l', 'r'] as const) {
      for (const ax of [0, 1, 2] as const) {
        const i = w.body.dofByName(`hip_${side}`, ax);
        if (i < 0) continue;
        list.push({ i, ref: w.body.dofs[i]!.angle });
      }
    }
    this.refs = list;
  }
}
