export interface ExplosionParams {
  totalEnergy: number;
  initialRadius: number;
  ambientDensity: number;
  ambientPressure: number;
  gamma?: number;
  N?: number;
  rMin?: number;
  rMax?: number;
  cfl?: number;
  shockThreshold?: number;
  duration?: number;  // 爆炸持续时间（秒），超过此时间爆炸自动结束
}

export interface PhysicalState {
  rho: number;
  u: number;
  p: number;
  T: number;
}

export interface ExplosionProfiles {
  r: Float64Array;
  rho: Float64Array;
  u: Float64Array;
  p: Float64Array;
  T: Float64Array;
}

export interface ExplosionVisualData {
  shockRadius: number;
  shockSpeed: number;
  coreTemperature: number;
  corePressure: number;
  profiles: ExplosionProfiles;
}

export interface InjectionParams {
  divergenceStrength: number;
  velocityStrength: number;
  waterStrength: number;
  fireballRadiusRatio: number;
}

export const DEFAULT_INJECTION_PARAMS: InjectionParams = {
  divergenceStrength: 0.001,
  velocityStrength: 1.0,
  waterStrength: 0.0,
  fireballRadiusRatio: 0.8,
};

export const DEFAULT_EXPLOSION_PARAMS: Required<ExplosionParams> = {
  totalEnergy: 500000,
  initialRadius: 0.02,
  ambientDensity: 1.225,
  ambientPressure: 101325,
  gamma: 1.4,
  N: 128,  // 降低网格数优化性能（从 256 降至 128，计算量减少约 75%）
  rMin: 0.002,
  rMax: 10.0,
  cfl: 0.4,
  shockThreshold: 1.5,
  duration: 2.0,  // 默认持续2秒后自动结束
};