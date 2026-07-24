/**
 * 流体模拟模块 — 新版模块化架构
 *
 * 基于 FluidGrid + AdvectionSolver 构建的 2D 流体编辑器。
 * - 逐通道平流开关（R=H, G=S, B=L, A=Alpha）
 * - 模块化：平流 / 压力 / Level Set 独立开关
 * - 实时分辨率调整
 */

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
