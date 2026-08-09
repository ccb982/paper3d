/**
 * 预设工具函数 —— 生成初始颜色场、速度场和注入源形状。
 */

/**
 * 生成圆形水坑（默认初始颜色场）。
 * @param resolution 纹理尺寸（像素）
 * @param center 归一化中心 (0~1)
 * @param radius 归一化半径
 * @param color RGBA 颜色 (0~1)
 */
export function createCircleField(
  resolution: { w: number; h: number },
  center: { x: number; y: number } = { x: 0.5, y: 0.5 },
  radius: number = 0.2,
  color: [number, number, number, number] = [0.2, 0.5, 0.8, 1.0],
): Float32Array {
  const { w, h } = resolution;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ux = x / w;
      const uy = y / h;
      const dx = ux - center.x;
      const dy = uy - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inside = dist < radius ? 1 : 0;
      const idx = (y * w + x) * 4;
      data[idx]     = color[0] * inside;
      data[idx + 1] = color[1] * inside;
      data[idx + 2] = color[2] * inside;
      data[idx + 3] = color[3] * inside;
    }
  }
  return data;
}

/**
 * 创建零速度场（RG 双通道）。
 */
export function createZeroVelocity(resolution: { w: number; h: number }): Float32Array {
  return new Float32Array(resolution.w * resolution.h * 2);
}

/**
 * 创建全零颜色场。
 */
export function createEmptyColorField(resolution: { w: number; h: number }): Float32Array {
  return new Float32Array(resolution.w * resolution.h * 4);
}
