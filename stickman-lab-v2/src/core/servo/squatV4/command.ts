import type { MusclePairCommand, SimpleCommandInput } from './types';

export function simpleMuscleCommand(i: SimpleCommandInput): MusclePairCommand {
  return {
    co: i.co,
    net: i.base + i.kp * (i.ref - i.angle) - i.kd * i.vel,
  };
}
