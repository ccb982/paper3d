import type { World } from '../world';
import type { Sensors } from '../sensors';

export interface LowerBodyContext {
  world: World;
  sensors: Sensors;
  dt: number;
  supportClean?: (side: 'l' | 'r') => void;
  upperOnly?: boolean;
  setComTarget?: (x: number, z: number) => void;
}

export interface LowerBodyOutput {
  qRef: Float64Array;
  tauGravity: Float64Array;
  ff: Float64Array;
  support: 'both' | 'l' | 'r' | 'none';
  copRef?: { x: number; z: number };
  mode: string;
  kp?: Float64Array;
  kd?: Float64Array;
  latLocked?: boolean;
  /** 这些自由度本命令不写 PD（由独立层负责，如 foot0 被动） */
  noPd?: Set<number>;
  delegate?: boolean;
}

export interface LowerBodyCommand {
  readonly id: 'stand' | 'squatDown' | 'squat';
  step(ctx: LowerBodyContext): LowerBodyOutput;
  reset(): void;
}
