import type { World } from '../world';
import type { Sensors } from '../sensors';

export interface LowerBodyContext {
  world: World;
  sensors: Sensors;
  dt: number;
  supportClean?: (side: 'l' | 'r') => void;
  upperOnly?: boolean;
}

export interface LowerBodyOutput {
  qRef: Float64Array;
  tauGravity: Float64Array;
  ff: Float64Array;
  support: 'both' | 'l' | 'r' | 'none';
  copRef?: { x: number; z: number };
  mode: string;
}

export interface LowerBodyCommand {
  readonly id: 'stand' | 'squatDown' | 'squat';
  step(ctx: LowerBodyContext): LowerBodyOutput;
  reset(): void;
}
