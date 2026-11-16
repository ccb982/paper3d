import type { World } from '../world';
import type { Sensors } from '../sensors';

export interface Constraint {
  readonly id: string;
  readonly priority: number;
  step(w: World, sensors: Sensors, dt: number): void;
  project?(w: World): void;
  reset(): void;
}

export class ConstraintLayer {
  private readonly items: Constraint[] = [];

  add(c: Constraint): void {
    this.items.push(c);
    this.items.sort((a, b) => a.priority - b.priority);
  }

  step(w: World, sensors: Sensors, dt: number): void {
    for (const c of this.items) c.step(w, sensors, dt);
  }

  project(w: World): void {
    for (const c of this.items) c.project?.(w);
  }

  reset(): void {
    for (const c of this.items) c.reset();
  }
}
