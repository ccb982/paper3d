import * as THREE from 'three';

/**
 * 流体内部注入（纹理空间，UV 0~1）
 */
export interface FluidInternalInjection {
  centerUV?: THREE.Vector2; // 默认 (0.5, 0.5)
  radius?: number;          // 影响半径（UV空间），默认 0.2
  falloff?: 'linear' | 'gaussian'; // 衰减方式，默认 'linear'
}

/**
 * 速度场注入
 */
export interface FluidVelocityInjection extends FluidInternalInjection {
  velocity: THREE.Vector2;  // 速度向量（纹理空间，uv单位/秒）
}

/**
 * 散度注入（正=收缩，负=膨胀）
 */
export interface FluidDivergenceInjection extends FluidInternalInjection {
  divergence: number;       // 散度值，推荐 ±5000~±20000
}

/**
 * 水体/phi 注入（正=添加水，负=移除水）
 */
export interface FluidWaterInjection extends FluidInternalInjection {
  amount: number;           // 水量变化，1.0 表示在该半径内填满水
}

/**
 * 外力描述符 —— 同时包含世界运动影响 + 内部流场影响
 */
export interface FluidExternalForce {
  /** 世界空间瞬时冲量（仅对可移动实体生效） */
  worldImpulse?: THREE.Vector3;
  /** 世界空间持续加速度（m/s²），每帧累加到速度上（仅对可移动实体） */
  worldAcceleration?: THREE.Vector3;
  /** 流体内部速度场注入 */
  velocityInjection?: FluidVelocityInjection;
  /** 流体内部散度注入 */
  divergenceInjection?: FluidDivergenceInjection;
  /** 水体/phi 注入 */
  waterInjection?: FluidWaterInjection;
}

/**
 * 目标接口 - 所有可接受外力的流体目标都需实现
 */
export interface IFluidForceTarget {
  /** 是否可以在世界空间移动 */
  isMovable(): boolean;
  /** 应用一个统一外力，内部自动分派 */
  applyFluidForce(force: FluidExternalForce): void;
}
