// ============================================================
// BasicMaterialsIcons.ts —— 六区兄弟图标（FTX → 背包 UI 画布）
// ============================================================
// 职责：把 src/assets/textures/六区兄弟.ftx3.gz 解包为 6 张
// HTMLCanvasElement 物品图标，缓存并以 id → 画布 映射返回。
// 合成与游戏内 FtxAsset composite shader 同一套数学（CPU 版）：
//  base(HSL Float) + residual(黄道残差) → RGB，shape 外透明。
// 全模块共享一份 Promise（Ship/World 两套 UI 各建 ItemIconRegistry
// 也只发起一次解包）。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { buildBaseHslData, buildResidualData } from '../../vendor/player/core/ftx';
import { SIX_BROTHERS } from '../../config/sixBrothers';
// ★ 素材统一放 public/（运行时 URL）：public/textures/六区兄弟.ftx3.gz
const FIX_BROTHERS_URL = '/textures/六区兄弟.ftx3.gz';

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 与 FtxAsset.createCompositeMaterial fragment 相同的 HSL→RGB */
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const h6 = h * 6.0;
  const r = clamp01(Math.abs(((h6 + 0.0) % 6.0) - 3.0) - 1.0);
  const g = clamp01(Math.abs(((h6 + 4.0) % 6.0) - 3.0) - 1.0);
  const b = clamp01(Math.abs(((h6 + 2.0) % 6.0) - 3.0) - 1.0);
  const k = s * (1.0 - Math.abs(2.0 * l - 1.0));
  return [l + k * (r - 0.5), l + k * (g - 0.5), l + k * (b - 0.5)];
}

/** 单帧合成 → 画布（透明背景，像素尺寸 = 该帧 bbox） */
function compositeFrameToCanvas(asset: FtxAsset, index: number): HTMLCanvasElement {
  const frame = asset.getFtxFrame(index);
  if (!frame) throw new Error(`六区兄弟第 ${index} 帧不存在`);
  const base = buildBaseHslData(frame, asset.palette);
  const res = buildResidualData(frame);
  if (!base || !res) throw new Error(`六区兄弟第 ${index} 帧解码为空`);

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

let sharedPromise: Promise<Map<string, HTMLCanvasElement>> | null = null;

/** 六区兄弟 6 张图标（id → 画布）；全模块共享，只解包一次 */
export function loadSixBrotherIcons(): Promise<Map<string, HTMLCanvasElement>> {
  if (sharedPromise) return sharedPromise;
  sharedPromise = (async () => {
    const asset = await FtxAsset.load(FIX_BROTHERS_URL);
    const map = new Map<string, HTMLCanvasElement>();
    for (const mat of SIX_BROTHERS) {
      map.set(mat.id, compositeFrameToCanvas(asset, mat.frame));
    }
    return map;
  })();
  // 失败后允许下次重试
  sharedPromise.catch(() => { sharedPromise = null; });
  return sharedPromise;
}