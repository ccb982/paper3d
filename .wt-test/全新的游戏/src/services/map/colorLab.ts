// ============================================================
// colorLab —— OKLab/OKLCH 色彩工具（地块材质伪造渲染的感知均匀空间）
// ============================================================
// 动机（2026-08-31 素材填充）：
//   HSL 的 lightness 非感知均匀（黄色 L0.5 比蓝色 L0.5 亮），在 GPU 逐像素做
//   明暗/饱和度渐变时观感不均。OKLab(L,a,b) / OKLCH(L,C,H) 感知均匀：
//     L = 明暗, C = 饱和度(chroma), H = 色相  —— 与需求一一对应。
//   本文件 = JS 端转换（构建期每 chunk 一次转成 uniform，运行时零成本）。
//   GLSL 端同式（oklchShade 收口，见 TerrainMaterial）。
//
// 公式：Björn Ottosson (2020) OKLab，标准矩阵，Mjölnir 公开实现。
// 本模块零 three 依赖、纯函数——独立可测试（色相环往返对照）。
// ============================================================

export interface Oklch { L: number; C: number; H: number }
export interface Oklab { L: number; A: number; B: number }

/** sRGB(0~1) → OKLab。输入须为 sRGB 分量（0~1），内部转线性。 */
export function srgbToOklab(r0: number, g0: number, b0: number): Oklab {
  const r = srgbToLinear(r0);
  const g = srgbToLinear(g0);
  const b = srgbToLinear(b0);
  // linear sRGB → LMS
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  // 立方根
  const lc = Math.cbrt(l), mc = Math.cbrt(m), sc = Math.cbrt(s);
  return {
    L: 0.2104542553 * lc + 0.7936177850 * mc - 0.0040720468 * sc,
    A: 1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc,
    B: 0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc,
  };
}

/** OKLab → sRGB(0~1)。内部经线性，输出 sRGB 显示空间分量。 */
export function oklabToSrgb(lab: Oklab): [number, number, number] {
  const [r, g, b] = oklabToLinearSrgb(lab);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

/** OKLab → 线性 sRGB(0~1)。★ 进渲染管线用这个（ACES/colorspace 全在 linear 域）。 */
export function oklabToLinearSrgb(lab: Oklab): [number, number, number] {
  const l_ = lab.L + 0.3963377774 * lab.A + 0.2158037573 * lab.B;
  const m_ = lab.L - 0.1055613458 * lab.A - 0.0638541728 * lab.B;
  const s_ = lab.L - 0.0894841775 * lab.A - 1.2914855480 * lab.B;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  // M1⁻¹（对称形式；数值求逆校验过）
  return [
     4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
    -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
    -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s,
  ];
}

/** OKLab → OKLCH（L 原样；C=√(a²+b²)；H 归一 0~1 缠绕） */
export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.hypot(lab.A, lab.B);
  const H = (Math.atan2(lab.B, lab.A) / (2 * Math.PI) + 1) % 1; // 0~1 缠绕
  return { L: lab.L, C, H };
}

/** 标准 CSS 式 sRGB-HSL → sRGB RGB(0~1)（显示空间；与 Tiles.baseHsl 同理） */
export function srgbHslToSrgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** ★ 作者侧 sRGB-HSL(b,g,s) → OKLCH。地块材质基色的单次转换入口。 */
export function srgbHslToOklch(h: number, s: number, l: number): Oklch {
  const [r, g, b] = srgbHslToSrgb(h, s, l);
  return oklabToOklch(srgbToOklab(r, g, b));
}

/**
 * ★ 逐地块抖动的 OKLab 幅度（GPU 化后 uMatJitter[id] 的数据源）。
 * 由 baseHsl 的 jitter {h,s,l} 上下界各算一次 → OKLCH → 半幅差。
 * 语义与旧 albedo 侧一致：逐像素 (hash-0.5)*2 乘此幅度 = ±amp 抖动。
 */
export function srgbHslJitterAmp(
  h: number, s: number, l: number,
  jh: number, js: number, jl: number,
): Oklch {
  const hi = srgbHslToOklch(h + jh, Math.min(1, s * (1 + js)), Math.min(1, l * (1 + jl)));
  const lo = srgbHslToOklch(h - jh, Math.max(0, s * (1 - js)), Math.max(0, l * (1 - jl)));
  return {
    L: (hi.L - lo.L) / 2,
    C: (hi.C - lo.C) / 2,
    H: angleDelta(hi.H, lo.H) / 2,
  };
}

/** 色相差（0~1 缠绕下的有符号最短弧，-0.5~0.5） */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

// ---- sRGB ↔ 线性（精确 sRGB 传递函数） ----

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
