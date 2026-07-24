/**
 * ShaderLibrary —— 公共 GLSL 函数库。
 *
 * 所有着色器通过字符串拼接引用这些函数，避免重复定义。
 * 分隔符 "// === GLSL_FUNC: name ===" 便于在调试时定位。
 */

/**
 * HSL → RGB 标准转换（GLSL 实现）。
 * 输入 h/s/l 均在 [0, 1] 范围。
 * @see https://en.wikipedia.org/wiki/HSL_and_HSV
 */
export const GLSL_HSL_TO_RGB = /* glsl */ `
vec3 hsl_to_rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
`;

/**
 * RGB → HSL 标准转换（GLSL 实现）。
 * 返回 vec3(h, s, l)，均在 [0, 1]。
 */
export const GLSL_RGB_TO_HSL = /* glsl */ `
vec3 rgb_to_hsl(vec3 rgb) {
  float cmax = max(max(rgb.r, rgb.g), rgb.b);
  float cmin = min(min(rgb.r, rgb.g), rgb.b);
  float delta = cmax - cmin;
  float l = (cmax + cmin) / 2.0;
  float s = delta == 0.0 ? 0.0 : delta / (1.0 - abs(2.0 * l - 1.0));
  float h = 0.0;
  if (delta != 0.0) {
    if (cmax == rgb.r) h = mod((rgb.g - rgb.b) / delta, 6.0);
    else if (cmax == rgb.g) h = (rgb.b - rgb.r) / delta + 2.0;
    else h = (rgb.r - rgb.g) / delta + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
`;

/**
 * 色相环形保护。
 * 双线性插值在色相边界（0.9 ↔ 0.1）会产生错误的中间值。
 * 此函数将插值结果包裹回 [0, 1) 范围。
 *
 * 用法（仅在启用色相平流时调用）：
 *   hue = hueWrap(hue);
 */
export const GLSL_HUE_WRAP = /* glsl */ `
float hueWrap(float h) {
  return fract(h + 1.0);
}
`;

/**
 * 边界处理函数。
 * - clamp: 采样超出 [0,1] 时钳制到边缘
 * - repeat: 采样超出时周期重复
 * - zero: 采样超出时返回 0
 *
 * 所有函数接收 uv 并返回钳制后的 uv。
 */
export const GLSL_BOUNDARY_CLAMP = /* glsl */ `
vec2 clampUv(vec2 uv) {
  return clamp(uv, vec2(0.0), vec2(1.0));
}
vec2 repeatUv(vec2 uv) {
  return fract(uv);
}
vec2 zeroUv(vec2 uv, out bool oob) {
  oob = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  return uv;
}
`;

/**
 * 半拉格朗日反向追踪。
 * 从当前像素 uv 沿速度矢量的反方向回溯 dt 时间，得到源位置。
 *
 * @param uv - 当前像素 UV
 * @param vel - 速度 (vec2, 像素/秒)
 * @param dt - 时间步长 (秒)
 * @param resolution - 纹理分辨率 (vec2, 像素)
 * @returns 回溯后的 UV 坐标
 */
export const GLSL_BACKTRACE = /* glsl */ `
vec2 backtrace(vec2 uv, vec2 vel, float dt, vec2 resolution) {
  return uv - vel * dt / resolution;
}
`;
