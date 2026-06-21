import type { Point, Shape } from '../types';

/**
 * 将多边形区域光栅化为 level set 浮点数组
 * @param rings 外环和内环数组，每个环是 Point[]，世界坐标 (0~1)
 * @param width 纹理宽度
 * @param height 纹理高度
 * @param insideValue 内部值（负数，表示流体内部）
 * @param outsideValue 外部值（正数，表示空气）
 * @returns Float32Array，phi 值：负数=内部，正数=外部
 */
export function rasterizePolygonToLevelSet(
  rings: Point[][],
  width: number,
  height: number,
  insideValue: number = -1.0,
  outsideValue: number = 1.0
): Float32Array {
  const data = new Float32Array(width * height);

  // 初始化全部为外部
  for (let i = 0; i < data.length; i++) {
    data[i] = outsideValue;
  }

  // 使用 canvas 光栅化
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. 用黑色填充整个 canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  // 2. 绘制所有环（外环 + 内环），使用白色填充内部（evenodd 规则）
  ctx.fillStyle = 'white';
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pxPoints = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
    for (let i = 1; i < pxPoints.length; i++) {
      ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 3. 绘制环的边框（宽度 1 像素），以确保边界像素也被包含
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pxPoints = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
    for (let i = 1; i < pxPoints.length; i++) {
      ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // 4. 读取像素，计算距离变换
  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;

  // 计算最近外部像素的距离
  // 简化处理：白色区域为内部（phi < 0），黑色区域为外部（phi > 0）
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixelIdx = idx * 4;

      // 检查是否是内部（白色）
      const isInside = pixels[pixelIdx] > 200 && pixels[pixelIdx + 1] > 200 && pixels[pixelIdx + 2] > 200;

      if (isInside) {
        // 内部像素，使用负值
        // 计算到边界的距离（简化：使用简单的距离场）
        data[idx] = insideValue;
      } else {
        // 外部像素，使用正值
        data[idx] = outsideValue;
      }
    }
  }

  return data;
}

/**
 * 将形状数组转换为 level set 浮点数组
 * @param shapes 形状数组
 * @param width 纹理宽度
 * @param height 纹理高度
 * @returns Float32Array，phi 值
 */
export function shapesToLevelSet(
  shapes: Shape[],
  width: number,
  height: number
): Float32Array {
  // 合并所有形状的区域
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 填充为外部（黑色）
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  // 绘制所有填充的形状（白色）
  ctx.fillStyle = 'white';
  for (const shape of shapes) {
    if (!shape.filled) continue;

    ctx.beginPath();
    const points = shape.points;

    if (points.length === 0) continue;

    // 第一个点是起点
    const firstPx = { x: points[0].x * width, y: (1 - points[0].y) * height };
    ctx.moveTo(firstPx.x, firstPx.y);

    // 后续点
    for (let i = 1; i < points.length; i++) {
      const px = { x: points[i].x * width, y: (1 - points[i].y) * height };
      ctx.lineTo(px.x, px.y);
    }

    // 如果是闭合形状
    if (shape.closed !== false) {
      ctx.closePath();
    }

    ctx.fill();
  }

  // 读取结果
  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  const data = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixelIdx = idx * 4;

      // 检查是否是内部（白色）
      const isInside = pixels[pixelIdx] > 200;

      // 内部为负值，外部为正值
      data[idx] = isInside ? -1.0 : 1.0;
    }
  }

  return data;
}

/**
 * 将形状转换为固体掩码
 * @param shapes 形状数组（通常是需要作为固体障碍物的形状）
 * @param width 纹理宽度
 * @param height 纹理高度
 * @returns Uint8Array，1=固体，0=流体
 */
export function shapesToSolidMask(
  shapes: Shape[],
  width: number,
  height: number
): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 填充为流体（黑色）
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  // 绘制所有填充的形状为固体（白色）
  ctx.fillStyle = 'white';
  for (const shape of shapes) {
    if (!shape.filled) continue;

    ctx.beginPath();
    const points = shape.points;

    if (points.length === 0) continue;

    const firstPx = { x: points[0].x * width, y: (1 - points[0].y) * height };
    ctx.moveTo(firstPx.x, firstPx.y);

    for (let i = 1; i < points.length; i++) {
      const px = { x: points[i].x * width, y: (1 - points[i].y) * height };
      ctx.lineTo(px.x, px.y);
    }

    if (shape.closed !== false) {
      ctx.closePath();
    }

    ctx.fill();
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixelIdx = idx * 4;

      // 白色区域为固体
      mask[idx] = pixels[pixelIdx] > 200 ? 1 : 0;
    }
  }

  return mask;
}

/**
 * 创建默认的水坑 level set（中心为圆形水域）
 * @param width 纹理宽度
 * @param height 纹理高度
 * @param centerX 中心 X (0~1)
 * @param centerY 中心 Y (0~1)
 * @param radiusX X 方向半径 (0~1)
 * @param radiusY Y 方向半径 (0~1)
 * @returns Float32Array
 */
export function createDefaultWaterLevelSet(
  width: number,
  height: number,
  centerX: number = 0.5,
  centerY: number = 0.5,
  radiusX: number = 0.3,
  radiusY: number = 0.3
): Float32Array {
  const data = new Float32Array(width * height);
  const centerPxX = centerX * width;
  const centerPxY = (1 - centerY) * height;
  const radiusPxX = radiusX * width;
  const radiusPxY = radiusY * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // 椭圆距离
      const dx = (x - centerPxX) / radiusPxX;
      const dy = (y - centerPxY) / radiusPxY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 内部为负值，外部为正值
      // phi = dist - 1，当 dist < 1 时为内部（负值）
      data[idx] = (dist - 1.0) * 5.0; // 乘以系数使边界更清晰
    }
  }

  return data;
}