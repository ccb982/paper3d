import * as THREE from 'three';

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
  duration?: number;
  injectionInterval?: number;  // 注入间隔（秒），默认 0.016
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

/**
 * 爆炸力场描述符：由 FluidIntegrator 生成，传递给 IFluidForceTarget
 * 坐标映射由目标（FluidSimulator）内部自行处理
 */
export interface ExplosionForceField {
  /** 爆炸中心世界坐标 */
  centerWorld: THREE.Vector2;
  /** 当前冲击波半径（物理单位） */
  shockRadius: number;
  /** 核心压力（Pa） */
  corePressure: number;
  /** 核心温度（K） */
  coreTemperature: number;
  /** 环境压力（Pa） */
  ambientPressure: number;
  /** 采样函数：输入物理半径 r，返回该处的物理状态 */
  sample: (r: number) => PhysicalState;
  /** 归一化采样函数：xi = r / R_shock，返回物理状态 */
  sampleNormalized: (xi: number) => PhysicalState;
  /** 冲击波加速度 (m/s^2) */
  shockAcceleration: number;
  /** 冲击波速度 (m/s) */
  shockSpeed: number;
}

export interface InjectionParams {
  /** 压力梯度 (Pa/m) -> 散度 (1/s) 的转换系数 */
  pressureToDivergenceScale: number;
  /** 动量传递系数（0~1） */
  momentumTransferCoeff: number;
  /** 水体生成强度（0~1） */
  waterGenerationStrength: number;
  /** 是否启用调试可视化 */
  debugVisualization?: boolean;
}

export const DEFAULT_INJECTION_PARAMS: InjectionParams = {
  pressureToDivergenceScale: 1.0,
  momentumTransferCoeff: 0.3,
  waterGenerationStrength: 0.0,
  debugVisualization: false,
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
  duration: 2.0,
  injectionInterval: 0.016,  // 默认约 1 帧（60fps）
};
