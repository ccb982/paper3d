/**
 * 流体模拟模块
 *
 * 新版（FluidEditor 编辑器架构）：
 *   基于 FluidGrid + AdvectionSolver 构建的2D流体编辑器。
 *   - GPUOps 内辅类统一管理全屏 Pass，材质缓存
 *   - 逐通道平流开关（R=H, G=S, B=L, A=Alpha）
 *   - 模块化：平流 / 压力 / Level Set 独立开关
 *   - 实时分辨率调整
 *
 * 旧版（FluidSimulator, 保留兼容）：
 *   原始的流体模拟器，包括分层渲染、PCG 求解器等。
 */

// ======================== 新版 FluidEditor ========================

// 核心管理层
export { FluidEditor } from './editor/FluidEditor';
export type { FluidEditorConfig, ViewMode } from './editor/FluidEditor';

// React
export { FluidEditorUI } from './editor/FluidEditorUI';
export { useFluidEditor } from './editor/useFluidEditor';

// 预设工具
export {
  createCircleField,
  createZeroVelocity,
  createEmptyColorField,
} from './editor/presets';

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