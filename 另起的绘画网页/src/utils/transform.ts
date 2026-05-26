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

export function worldToCanvas(
  worldX: number,
  worldY: number,
  axis: Axis,
  canvasSize: number,
  options?: TransformOptions,
  zoom: number = 1,
  panOffset: Point = { x: 0, y: 0 }
): Point {
  const px = ((worldX - axis.xMin) / (axis.xMax - axis.xMin)) * canvasSize;
  const py = ((axis.yMax - worldY) / (axis.yMax - axis.yMin)) * canvasSize;

  if (options?.applyViewTransform) {
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const canvasX = (px - centerX) * zoom + centerX + panOffset.x;
    const canvasY = (py - centerY) * zoom + centerY + panOffset.y;
    return { x: canvasX, y: canvasY };
  }

  return { x: px, y: py };
}

export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  axis: Axis,
  canvasSize: number,
  zoom: number = 1,
  panOffset: Point = { x: 0, y: 0 }
): Point {
  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  const rawX = (canvasX - centerX - panOffset.x) / zoom + centerX;
  const rawY = (canvasY - centerY - panOffset.y) / zoom + centerY;
  const worldX = (rawX / canvasSize) * (axis.xMax - axis.xMin) + axis.xMin;
  const worldY = axis.yMax - (rawY / canvasSize) * (axis.yMax - axis.yMin);
  return { x: worldX, y: worldY };
}