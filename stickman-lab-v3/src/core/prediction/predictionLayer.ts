import type { World } from '../world';
import type { Sensors } from '../sensors';
import type { Perception } from '../perception';

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export interface PredictionSample {
  t: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  copX: number;
  copZ: number;
  xiX: number;
  xiZ: number;
}

export interface PredictionState {
  t: number;
  now: PredictionSample;
  horizon: PredictionSample[];
  overshoot: number;
  targetX: number;
  targetZ: number;
  ttb: number;
  contactValid: boolean;
  modelError: number;
  brake: number;
  brakeX: number;
  brakeZ: number;
}

const sample = (t: number, x: number, z: number, vx: number, vz: number, copX: number, copZ: number, omega: number): PredictionSample => ({
  t,
  x,
  z,
  vx,
  vz,
  copX,
  copZ,
  xiX: x + vx / omega,
  xiZ: z + vz / omega,
});

export class PredictionLayer {
  private prevNext: PredictionSample | null = null;
  private copLX = 0;
  private copLZ = 0;
  private copInit = false;
  private targetX = 0;
  private targetZ = 0;
  private targetValid = false;
  private lastT = 0;
  private nextT = 0;
  private state: PredictionState;

  constructor() {
    const zero = sample(0, 0, 0, 0, 0, 0, 0, Math.sqrt(9.81 / 0.3));
    this.state = {
      t: 0,
      now: zero,
      horizon: [],
      overshoot: 0,
      targetX: 0,
      targetZ: 0,
      ttb: Infinity,
      contactValid: false,
      modelError: 0,
      brake: 1,
      brakeX: 1,
      brakeZ: 1,
    };
  }

  reset(): void {
    this.prevNext = null;
    this.copInit = false;
    this.targetValid = false;
    this.lastT = 0;
    this.nextT = 0;
    this.state = {
      ...this.state,
      t: 0,
      horizon: [],
      overshoot: 0,
      targetX: 0,
      targetZ: 0,
      ttb: Infinity,
      contactValid: false,
      modelError: 0,
      brake: 1,
      brakeX: 1,
      brakeZ: 1,
    };
  }

  setTarget(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.targetX = x;
    this.targetZ = z;
    this.targetValid = true;
  }

  update(_w: World, sensors: Sensors, perception: Perception, dt: number): void {
    const nowT = this.lastT + dt;
    const cycle = Math.max(dt, num('SQC_PRED_CYCLE', 0.05));
    if (nowT + 1e-9 < this.nextT) return;
    this.lastT = nowT;
    this.nextT = nowT + cycle;
    const comX = sensors.com[0] ?? 0;
    const comY = Math.max(0.05, sensors.com[1] ?? 0.3);
    const comZ = sensors.com[2] ?? 0;
    const vx = sensors.comVel[0] ?? 0;
    const vz = sensors.comVel[2] ?? 0;
    const omega = Math.sqrt(9.81 / Math.max(0.3, comY));

    let fzSum = 0;
    let copX = 0;
    let copZ = 0;
    for (const f of perception.feet) {
      if (!f.copValid || f.fz <= 1) continue;
      fzSum += f.fz;
      copX += f.fz * f.copX;
      copZ += f.fz * f.copZ;
    }
    const contactValid = fzSum > 1;
    if (contactValid) {
      copX /= fzSum;
      copZ /= fzSum;
    } else {
      copX = comX;
      copZ = comZ;
    }

    const lp = Math.max(1e-3, num('SQC_PRED_COP_LP', 0.08));
    const k = 1 - Math.exp(-dt / lp);
    if (contactValid) {
      if (!this.copInit) {
        this.copLX = copX;
        this.copLZ = copZ;
        this.copInit = true;
      } else {
        this.copLX += (copX - this.copLX) * k;
        this.copLZ += (copZ - this.copLZ) * k;
      }
    }
    const copPredX = this.copInit ? this.copLX : comX;
    const copPredZ = this.copInit ? this.copLZ : comZ;
    const now = sample(nowT, comX, comZ, vx, vz, copPredX, copPredZ, omega);
    if (this.prevNext) {
      this.state.modelError = Math.hypot(this.prevNext.x - now.x, this.prevNext.z - now.z);
    }

    const horizonT = Math.max(dt, num('SQC_PRED_HORIZON', 0.15));
    const steps = Math.max(1, Math.min(24, Math.round(horizonT / dt)));
    const horizon: PredictionSample[] = [];
    for (let k = 1; k <= steps; k++) {
      const t = k * dt;
      const ch = Math.cosh(omega * t);
      const sh = Math.sinh(omega * t);
      const x = copPredX + (comX - copPredX) * ch + (vx / omega) * sh;
      const z = copPredZ + (comZ - copPredZ) * ch + (vz / omega) * sh;
      const vxn = (comX - copPredX) * omega * sh + vx * ch;
      const vzn = (comZ - copPredZ) * omega * sh + vz * ch;
      horizon.push(sample(t, x, z, vxn, vzn, copPredX, copPredZ, omega));
    }

    const last = horizon[horizon.length - 1]!;
    this.prevNext = horizon[0]!;
    const targetX = this.targetValid ? this.targetX : (contactValid ? copPredX : comX);
    const targetZ = this.targetValid ? this.targetZ : (contactValid ? copPredZ : comZ);
    const overshootX = Math.max(0, Math.sign(vx) * (last.xiX - targetX));
    const overshootZ = Math.max(0, Math.sign(vz) * (last.xiZ - targetZ));
    const overshoot = Math.hypot(overshootX, overshootZ);
    let ttb = Infinity;
    for (const f of perception.feet) if (Number.isFinite(f.ttb) && f.ttb < ttb) ttb = f.ttb;
    const tolX = Math.max(1e-3, num('SQC_PRED_OVERSHOOT_TOL_X', 0.12));
    const tolZ = Math.max(1e-3, num('SQC_PRED_OVERSHOOT_TOL_Z', 0.08));
    const brakeX = Math.max(0, Math.min(1, 1 - overshootX / tolX));
    const brakeZ = Math.max(0, Math.min(1, 1 - overshootZ / tolZ));
    const brake = Math.min(brakeX, brakeZ);
    this.state = {
      t: now.t,
      now,
      horizon,
      overshoot,
      targetX,
      targetZ,
      ttb,
      contactValid,
      modelError: this.state.modelError,
      brake,
      brakeX,
      brakeZ,
    };
    (globalThis as { __PRED?: PredictionState }).__PRED = this.state;
  }

  get(): PredictionState {
    return this.state;
  }
}
