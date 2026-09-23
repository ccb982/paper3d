// ============================================================
// ftxFrameToCanvas.ts —— FTX 帧 CPU 合成 → HTMLCanvasElement
// ============================================================
// 通用工具：把 FtxAsset 的某个帧按游戏内合成 shader 同款数学
// （base HSL + 残差 → RGB，shape 外透明）合成为画布，供 DOM UI
// （模块按钮背景、图标等）使用。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { buildBaseHslData, buildResidualData } from '../../vendor/player/core/ftx';

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const h6 = h * 6.0;
  const r = clamp01(Math.abs(((h6 + 0.0) % 6.0) - 3.0) - 1.0);
  const g = clamp01(Math.abs(((h6 + 4.0) % 6.0) - 3.0) - 1.0);
  const b = clamp01(Math.abs(((h6 + 2.0) % 6.0) - 3.0) - 1.0);
  const k = s * (1.0 - Math.abs(2.0 * l - 1.0));
  return [l + k * (r - 0.5), l + k * (g - 0.5), l + k * (b - 0.5)];
}

/** 单帧合成 → 画布（透明背景，像素尺寸 = 该帧 bbox） */
export function compositeFrameToCanvas(
  asset: FtxAsset,
  index: number,
): HTMLCanvasElement {
  const frame = asset.getFtxFrame(index);
  if (!frame) throw new Error(`FTX 第 ${index} 帧不存在`);
  const base = buildBaseHslData(frame, asset.palette);
  const res = buildResidualData(frame);
  if (!base || !res) throw new Error(`FTX 第 ${index} 帧解码为空`);

  const w = base.width;
  const h = base.height;
  const img = new ImageData(w, h);
  const n = w * h;
  const R = 0.5; // 残差统一范围（等同 shader uResidualRange）

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = base.data[o + 3];
    img.data[o + 3] = a > 0 ? 255 : 0;
    if (a <= 0) continue;

    const dH = (res.data[o] / 255) * 2 - 1;
    const dS = (res.data[o + 1] / 255) * 2 - 1;
    const dL = (res.data[o + 2] / 255) * 2 - 1;

    const H = fract(base.data[o] + dH * R);
    const S = clamp01(base.data[o + 1] + dS * R);
    const L = clamp01(base.data[o + 2] + dL * R);

    const [r, g, b] = hsl2rgb(H, S, L);
    img.data[o] = Math.round(r * 255);
    img.data[o + 1] = Math.round(g * 255);
    img.data[o + 2] = Math.round(b * 255);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

/** 单帧合成 → dataURL（CSS background 用） */
export function compositeFrameToDataURL(
  asset: FtxAsset,
  index: number,
): string {
  return compositeFrameToCanvas(asset, index).toDataURL();
}