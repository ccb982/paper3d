// ============================================================
// src/fx/tex/ftxComposite —— FTX（base HSL + 残差）→ RGBA 的唯一 CPU 实现
// ============================================================
// ★★★ 这是全项目 CPU 侧唯一允许出现该公式的地方。
// 收敛前有 4 份复制：
//   · ui/shared/ftxFrameToCanvas.ts         compositeFrameToCanvas（逐字节副本）
//   · services/item/BasicMaterialsIcons.ts  compositeFrameToCanvas（逐字节副本，仅报错文案不同）
//   · fx/channels/HitEffectChannel.ts        buildFtxImage（alpha 阈值 0.5，与前两者不同）
//   · systems/swarm/SwarmBatch.ts            bakeFrame（alpha 连续，与前两者不同）
// 现在它们全部转调这里，差异变成**显式参数**而不是隐藏的复制。
//
// 公式（与 GPU chunk 必须逐值一致）：
//   dH = (res.r/255 × 2 − 1) × rangeH,  finalH = fract(base.h + dH)
//   dS = (res.g/255 × 2 − 1) × rangeSL, finalS = clamp01(base.s + dS)
//   dL = (res.b/255 × 2 − 1) × rangeSL, finalL = clamp01(base.l + dL)
//   rgb = hsl2rgb(finalH, finalS, finalL)
//
// ★ alpha 有三套口径，**不能一刀切**（合并时必须保留差异）：
//   'binary'      a > threshold ? 255 : 0     —— 图标/UI/击中特效（形状外必须全透明）
//   'continuous'  a × 255（clamp）            —— 蜂群图集（保留抗锯齿边缘）
// ============================================================

import { buildBaseHslData, buildResidualData } from '../../vendor/player/core/ftx';
import type { FtxAsset } from '../../vendor/player/FtxAsset';

/** 残差统一范围（等同 shader 的 uResidualRangeH / uResidualRangeSL） */
export const FTX_RESIDUAL_RANGE = 0.5;

export type FtxAlphaMode = 'binary' | 'continuous';

export interface FtxCompositeOptions {
  /** 残差 H 通道范围（默认 0.5） */
  rangeH?: number;
  /** 残差 S/L 通道范围（默认 0.5） */
  rangeSL?: number;
  /** alpha 口径（默认 'binary'） */
  alpha?: FtxAlphaMode;
  /** binary 口径的阈值（默认 0；击中特效用 0.5） */
  alphaThreshold?: number;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** HSL → RGB（0~1）。★ 与 GLSL `ftxHsl2rgb` 同一公式，改一处必须同步另一处 */
export function ftxHsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const h6 = h * 6.0;
  const r = clamp01(Math.abs(((h6 + 0.0) % 6.0) - 3.0) - 1.0);
  const g = clamp01(Math.abs(((h6 + 4.0) % 6.0) - 3.0) - 1.0);
  const b = clamp01(Math.abs(((h6 + 2.0) % 6.0) - 3.0) - 1.0);
  const k = s * (1.0 - Math.abs(2.0 * l - 1.0));
  return [l + k * (r - 0.5), l + k * (g - 0.5), l + k * (b - 0.5)];
}

/**
 * 核心像素循环：base HSL(Float32×4) + residual(Uint8×4) → RGBA8。
 * @param residual null = 无残差（按中性偏移 0 处理，等价于只显示 base）
 */
export function compositeHslResidualToRgba(
  baseHsl: Float32Array,
  residual: Uint8Array | null,
  width: number,
  height: number,
  options: FtxCompositeOptions = {},
): Uint8ClampedArray {
  const rangeH = options.rangeH ?? FTX_RESIDUAL_RANGE;
  const rangeSL = options.rangeSL ?? FTX_RESIDUAL_RANGE;
  const alphaMode = options.alpha ?? 'binary';
  const threshold = options.alphaThreshold ?? 0;

  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = baseHsl[o + 3];

    if (alphaMode === 'binary') {
      // ★ 两个条件都要：threshold=0 时退化为 `a > 0`（图标口径）；
      //   threshold=0.5 时是 `a >= 0.5`（击中特效原实现是 `a < 0.5 → skip`，边界必须保留）
      if (a > 0 && a >= threshold) out[o + 3] = 255;
      else continue; // 透明像素不参与配色（连 RGB 都保持 0）
    } else {
      // ★ 不跳过 alpha=0 的像素：continuous 口径用于图集烘焙，
      //   原实现对全透明像素也写 RGB，这里保持逐字节一致。
      const av = Math.round(a * 255);
      out[o + 3] = av > 255 ? 255 : av;
    }

    const dH = residual ? (residual[o] / 255) * 2 - 1 : 0;
    const dS = residual ? (residual[o + 1] / 255) * 2 - 1 : 0;
    const dL = residual ? (residual[o + 2] / 255) * 2 - 1 : 0;

    const H = fract(baseHsl[o] + dH * rangeH);
    const S = clamp01(baseHsl[o + 1] + dS * rangeSL);
    const L = clamp01(baseHsl[o + 2] + dL * rangeSL);

    const [r, g, b] = ftxHsl2rgb(H, S, L);
    // ★ 必须显式 Math.round：Uint8ClampedArray 的赋值是 banker's rounding（.5 → 偶数），
    //   与 Math.round 在 .5 边界差 1，会让"逐字节一致"的验收假通过。
    out[o] = Math.round(r * 255);
    out[o + 1] = Math.round(g * 255);
    out[o + 2] = Math.round(b * 255);
  }

  return out;
}

/** 单帧合成 → 画布（像素尺寸 = 该帧 bbox，形状外按 alpha 口径处理） */
export function compositeFrameToCanvas(
  asset: FtxAsset,
  index: number,
  options?: FtxCompositeOptions,
): HTMLCanvasElement {
  const frame = asset.getFtxFrame(index);
  if (!frame) throw new Error(`FTX 第 ${index} 帧不存在`);
  const base = buildBaseHslData(frame, asset.palette);
  const res = buildResidualData(frame);
  if (!base || !res) throw new Error(`FTX 第 ${index} 帧解码为空`);

  const data = compositeHslResidualToRgba(base.data, res.data, base.width, base.height, options);
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  canvas.getContext('2d')!.putImageData(new ImageData(data, base.width, base.height), 0, 0);
  return canvas;
}

/** 单帧合成 → dataURL（CSS background 用） */
export function compositeFrameToDataURL(asset: FtxAsset, index: number): string {
  return compositeFrameToCanvas(asset, index).toDataURL();
}
