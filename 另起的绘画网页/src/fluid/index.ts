/**
 * 流体模拟模块
 *
 * 旧版（保留兼容）：
 *   FluidSimulator, FluidSimulatorAdapter, FluidPreview, useFluidSimulation
 *
 * 新版（模块化架构）：
 *   FluidGrid      - 双缓冲纹理管理器
 *   AdvectionSolver - 半拉格朗日平流求解器（逐通道掩码）
 *   ShaderLibrary  - 公共 GLSL 函数（HSL 转换、色相环保护等）
 */

// ======================== 旧版导出（保留兼容） ========================

// 核心模拟器
export { FluidSimulator } from './FluidSimulator';
export type { FluidParams } from './FluidSimulator';

// 适配器
export { FluidSimulatorAdapter } from './FluidSimulatorAdapter';

// React Hook
export { useFluidSimulation, type UseFluidSimulationOptions, type UseFluidSimulationReturn } from './useFluidSimulation';

// 组件
export { FluidPreview, type FluidPreviewProps } from './FluidPreview';

// 工具函数
export {
  rasterizePolygonToLevelSet,
  shapesToLevelSet,
  shapesToSolidMask,
  createDefaultWaterLevelSet,
} from './shapeToLevelSet';

// ======================== 新版模块化架构 ========================

// 核心层
export { FluidGrid } from './core/FluidGrid';
export type { AdvectionMask, TextureDataType } from './core/FluidGrid';

// 求解器层
export { AdvectionSolver } from './solvers/AdvectionSolver';
export type { AdvectionOptions } from './solvers/AdvectionSolver';

// 公共 GLSL 函数库
export {
  GLSL_HSL_TO_RGB,
  GLSL_RGB_TO_HSL,
  GLSL_HUE_WRAP,
  GLSL_BOUNDARY_CLAMP,
  GLSL_BACKTRACE,
} from './core/ShaderLibrary';