// ============================================================
// DroneIcon.ts —— 可露希尔的无人机图标（FTX → 背包 UI 画布）
// ============================================================
// 与 BasicMaterialsIcons 同套路：无人机三帧实为三图层（主体/左翅膀/右翅膀，
// 共享同一画布）——用 FtxAsset + buildBaseHslData CPU 合成出完整无人机，
// 按各层 bbox 位置拼进一张全画布，生成背包图标的 HTMLCanvasElement。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { buildBaseHslData, buildResidualData } from '../../vendor/player/core/ftx';
import type { FrameTextureData, PaletteColor } from '../../vendor/player/core/types';

const DRONE_ICON_URL = '/fx/可露希尔的无人机.ftx3.gz';

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

/** 单层合成 → RGBA 像素数组（像素尺寸 = 该层 bbox） */
function compositeLayerPixels(
  asset: FtxAsset,
  frame: FrameTextureData,
  palette: PaletteColor[],
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const base = buildBaseHslData(frame, palette);
  const res = buildResidualData(frame);
  if (!base || !res) return null;

  const w = base.width;
  const h = base.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  const R = 0.5; // 残差统一范围（等同 shader uResidualRange）

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = base.data[o + 3];
    out[o + 3] = a > 0 ? 255 : 0;
    if (a <= 0) continue;

    const dH = (res.data[o] / 255) * 2 - 1;
    const dS = (res.data[o + 1] / 255) * 2 - 1;
    const dL = (res.data[o + 2] / 255) * 2 - 1;

    const H = fract(base.data[o] + dH * R);
    const S = clamp01(base.data[o + 1] + dS * R);
    const L = clamp01(base.data[o + 2] + dL * R);

    const [r, g, b] = hsl2rgb(H, S, L);
    out[o] = Math.round(r * 255);
    out[o + 1] = Math.round(g * 255);
    out[o + 2] = Math.round(b * 255);
  }

  return { data: out, w, h };
}

/** 全画布合成：按各层 bbox 位置把三图层拼进共享画布 → 完整无人机画布 */
function compositeFullCanvas(asset: FtxAsset): HTMLCanvasElement {
  const frames: FrameTextureData[] = [];
  for (let i = 0; i < asset.frameCount; i++) {
    const f = asset.getFtxFrame(i);
    if (f) frames.push(f);
  }
  // 画布尺寸 = 第一帧原始宽高（三帧共享同一画布）
  const cw = frames[0]?.width ?? 512;
  const ch = frames[0]?.height ?? 512;

  const layers: ({ data: Uint8ClampedArray; w: number; h: number; bbox: { x: number; y: number; w: number; h: number } })[] = [];
  for (const f of frames) {
    const px = compositeLayerPixels(asset, f, asset.palette);
    if (px && f.bbox) layers.push({ ...px, bbox: f.bbox });
  }

  const img = new ImageData(cw, ch);
  for (const l of layers) {
    const { data, w, h, bbox } = l;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        if (data[s + 3] <= 0) continue; // 该层此处透明 → 保留下层
        const dx = bbox.x + x;
        const dy = bbox.y + y;
        if (dx < 0 || dx >= cw || dy < 0 || dy >= ch) continue;
        const d = (dy * cw + dx) * 4;
        img.data[d] = data[s];
        img.data[d + 1] = data[s + 1];
        img.data[d + 2] = data[s + 2];
        img.data[d + 3] = 255;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

let sharedPromise: Promise<HTMLCanvasElement | null> | null = null;

/** 无人机图标（三图层合成）；全模块共享，只解包一次，失败返回 null（色块兜底） */
export function loadDroneIcon(): Promise<HTMLCanvasElement | null> {
  if (sharedPromise) return sharedPromise;
  sharedPromise = (async () => {
    try {
      const asset = await FtxAsset.load(DRONE_ICON_URL);
      return compositeFullCanvas(asset);
    } catch (err) {
      console.warn('[DroneIcon] 无人机图标载入失败，回退色块:', err);
      return null;
    }
  })();
  sharedPromise.catch(() => { sharedPromise = null; });
  return sharedPromise;
}