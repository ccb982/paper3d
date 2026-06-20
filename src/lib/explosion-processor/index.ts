export { Explosion1DSolver } from './Explosion1DSolver';
export { ExplosionManager } from './manager/ExplosionManager';
export { ExplosionDebugVisualizer } from './manager/ExplosionDebugVisualizer';
export type { ExplosionDebugConfig } from './manager/ExplosionDebugVisualizer';
export { FluidIntegrator } from './integration/FluidIntegrator';

export type {
  ExplosionParams,
  PhysicalState,
  ExplosionProfiles,
  ExplosionVisualData,
  ExplosionForceField,
  InjectionParams,
} from './types';

export {
  DEFAULT_EXPLOSION_PARAMS,
  DEFAULT_INJECTION_PARAMS,
} from './types';