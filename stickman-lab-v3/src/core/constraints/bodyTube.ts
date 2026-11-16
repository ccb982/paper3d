import type { World } from '../world';
import type { Sensors } from '../sensors';
import { baseState } from '../servo/baseTable';

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export class BodyTubeConstraint {
  readonly id = 'body-tube';
  readonly priority = 20;
  private centerSet = false;
  private cx = 0;
  private cz = 0;

  reset(): void {
    this.centerSet = false;
    this.cx = 0;
    this.cz = 0;
  }

  step(w: World, _sensors: Sensors, dt: number): void {
    if (num('SQC_TUBE', 0) !== 1) return;
    if (baseState() !== 'squat') {
      this.reset();
      return;
    }
    if (!this.centerSet) {
      const p = w.body.root().translation();
      this.cx = p.x;
      this.cz = p.z;
      this.centerSet = true;
    }
    const R = Math.max(0.02, num('SQC_TUBE_R', 0.35));
    const y0 = num('SQC_TUBE_Y0', 0.35);
    const y1 = num('SQC_TUBE_Y1', 1.8);
    const K = Math.max(0, num('SQC_TUBE_K', 50));
    const D = Math.max(0, num('SQC_TUBE_D', 15));
    const cap = Math.max(0, num('SQC_TUBE_CAP', 6));
    const all = num('SQC_TUBE_ALL', 0) === 1;
    for (let i = 0; i < w.body.bodies.length; i++) {
      const b = w.body.bodies[i]!;
      const m = b.mass();
      if (m <= 0) continue;
      const key = w.sk.bodies[i]?.key ?? '';
      const upper = /^(torso|spine|neck|head)/.test(key);
      if (!all && !upper) continue;
      const p = b.translation();
      const v = b.linvel();
      const dx = p.x - this.cx;
      const dz = p.z - this.cz;
      const r = Math.hypot(dx, dz);
      let ax = 0;
      let ay = 0;
      let az = 0;
      if (r > R) {
        const over = r - R;
        const nx = dx / Math.max(1e-6, r);
        const nz = dz / Math.max(1e-6, r);
        const vr = v.x * nx + v.z * nz;
        const acc = Math.max(-cap, Math.min(cap, -K * over - D * vr));
        ax = nx * acc;
        az = nz * acc;
      }
      if (upper && p.y < y0) {
        ay += Math.max(-cap, Math.min(cap, K * (y0 - p.y) - D * v.y));
      } else if (upper && p.y > y1) {
        ay -= Math.max(-cap, Math.min(cap, K * (p.y - y1) + D * v.y));
      }
      if (ax === 0 && ay === 0 && az === 0) continue;
      b.applyImpulse({ x: m * ax * dt, y: m * ay * dt, z: m * az * dt }, true);
    }
  }
}
