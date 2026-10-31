export interface Point {
  x: number;
  y: number;
}

export interface Axis {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface TransformOptions {
  applyViewTransform?: boolean;
}

// 固定世界坐标范围（与画布映射相关）
const FIXED_WORLD_MIN = 0;
const FIXED_WORLD_MAX = 1;

/**
 * 将世界坐标（0~1）映射到画布坐标
 * worldX, worldY: 世界坐标，范围 [0,1]
 * canvasWidth: 画布宽度
 * canvasHeight: 画布高度
 * options: 转换选项
 * zoom: 缩放因子
 * panOffset: 平移偏移
 */
export function worldToCanvas(
  worldX: number,
  worldY: number,
  canvasWidth: number,
  canvasHeight: number,
  options?: TransformOptions,
  zoom: number = 1,
  panOffset: Point = { x: 0, y: 0 }
): Point {
  // 使用固定的 [0,1] 范围映射到画布
  const px = ((worldX - FIXED_WORLD_MIN) / (FIXED_WORLD_MAX - FIXED_WORLD_MIN)) * canvasWidth;
  const py = ((FIXED_WORLD_MAX - worldY) / (FIXED_WORLD_MAX - FIXED_WORLD_MIN)) * canvasHeight;

  if (options?.applyViewTransform) {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const canvasX = (px - centerX) * zoom + centerX + panOffset.x;
    const canvasY = (py - centerY) * zoom + centerY + panOffset.y;
    return { x: canvasX, y: canvasY };
  }

  return { x: px, y: py };
}

/**
 * 将画布坐标映射到世界坐标（0~1）
 * canvasX, canvasY: 画布像素坐标
 * canvasWidth: 画布宽度
 * canvasHeight: 画布高度
 * zoom: 缩放因子
 * panOffset: 平移偏移
 */
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number = 1,
  panOffset: Point = { x: 0, y: 0 }
): Point {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const rawX = (canvasX - centerX - panOffset.x) / zoom + centerX;
  const rawY = (canvasY - centerY - panOffset.y) / zoom + centerY;
  // 使用固定的 [0,1] 范围映射
  const worldX = (rawX / canvasWidth) * (FIXED_WORLD_MAX - FIXED_WORLD_MIN) + FIXED_WORLD_MIN;
  const worldY = FIXED_WORLD_MAX - (rawY / canvasHeight) * (FIXED_WORLD_MAX - FIXED_WORLD_MIN);
  return { x: worldX, y: worldY };
}

/**
 * 将世界坐标（0~1）映射到坐标轴显示范围（如 -32~32）
 * 用于绘制轴标签时显示正确的数字
 */
/**
 * 将世界坐标（0~1，y 向上）映射为 bbox 局部像素坐标（各向异性）。
 * 与 2D 覆盖层 worldToCanvas(p, canvasWidth, canvasHeight) 同一映射：
 * 当画布=bbox 尺寸时，WebGL 顶点与 canvas 绘制的注释形状完全重合。
 */
export function projectWorldToBbox(
  p: Point,
  bbox: { x: number; y: number; w: number; h: number }
): Point {
  return {
    x: p.x * bbox.w,
    y: (1 - p.y) * bbox.h,
  };
}

export function worldToAxis(
  worldX: number,
  worldY: number,
  axis: Axis
): Point {
  const axisX = ((worldX - FIXED_WORLD_MIN) / (FIXED_WORLD_MAX - FIXED_WORLD_MIN)) * (axis.xMax - axis.xMin) + axis.xMin;
  const axisY = axis.yMax - ((worldY - FIXED_WORLD_MIN) / (FIXED_WORLD_MAX - FIXED_WORLD_MIN)) * (axis.yMax - axis.yMin);
  return { x: axisX, y: axisY };
}

/**
 * 将坐标轴显示坐标（如 -32~32）映射回世界坐标（0~1）
 */
export function axisToWorld(
  axisX: number,
  axisY: number,
  axis: Axis
): Point {
  const worldX = ((axisX - axis.xMin) / (axis.xMax - axis.xMin)) * (FIXED_WORLD_MAX - FIXED_WORLD_MIN) + FIXED_WORLD_MIN;
  const worldY = FIXED_WORLD_MAX - ((axisY - axis.yMin) / (axis.yMax - axis.yMin)) * (FIXED_WORLD_MAX - FIXED_WORLD_MIN);
  return { x: worldX, y: worldY };
}