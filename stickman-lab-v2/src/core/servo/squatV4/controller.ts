import { stepAntagonist } from './antagonist';
import { simpleMuscleCommand } from './command';
import type { JointSpec, MusclePairOutput, MusclePairState } from './types';

export class SquatV4Muscles {
  private readonly state = new Map<string, MusclePairState>();

  step(j: JointSpec, angle: number, vel: number, dt: number): MusclePairOutput {
    let s = this.state.get(j.key);
    if (!s) {
      s = { aA: 0, aB: 0 };
      this.state.set(j.key, s);
    }
    const cmd = simpleMuscleCommand({ base: j.base, ref: j.ref, angle, vel, co: j.co, kp: j.kp, kd: j.kd });
    return stepAntagonist(s, cmd, angle, vel, j.ref, dt, j.params);
  }

  reset(): void {
    this.state.clear();
  }
}
