/**
 * 流体模拟模块
 * 整合自游戏中的流体库，提供完整的流体模拟功能
 */

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