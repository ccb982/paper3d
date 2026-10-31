// ============================================================
// 图集打包核心（多张 RGBA 图 → 一个 FTX3 多帧二进制）——供 scripts/atlas-pack.ts 使用
//
// 职责边界：只做「图像 → FTX3 帧数据」的纯计算，不碰 DOM / canvas，
// 因此浏览器（UI 预览）和 node（离线往返验证）都能直接跑同一份代码。
//
// 输出格式与「主绘画页面导出素材包」完全一致（utils/multiFrameExport.ts
// 的 packMultiFrameToBinary）：Magic 0x46545833 / version 3 / 每帧
// name + texW/texH + bbox + blockFlags + regionIdTex(行差分) + deltaPacked(行差分)。
// 游戏端用 src/vendor/player/core/ftx.ts 的 decodeMultiFrame 读取。
//
// 单帧内部流程（与基础色编辑器同一套语义）：
//   1. 按 alpha 求紧包围盒（可选裁剪）
//   2. 统一缩放到目标高度（宽按各自原图比例）
//   3. 全体帧共享一个调色板（k-means，≤254）
//   4. 每像素指派最近基色 → regionIdTex（1-based，0=透明）
//   5. 残差 = 像素HSL − 基色HSL，按 8×8 分块选量化范围（0.25 / 0.5）
//      → quantizeH/S/L → packRGB565 → deltaPacked
// ============================================================

import { rgbToHsl } from '../../src/utils/colorCompressor';
import {
  quantizeH,
  quantizeS,
  quantizeL,
  packRGB565,
  getAdaptiveBlockIndex,
  ADAPTIVE_BLOCK_COLS,
  ADAPTIVE_BLOCK_ROWS,
} from '../../src/core/ftxCore';
import { packMultiFrameToBinary, type FrameExportData } from '../../src/utils/multiFrameExport';
import type { SharedBaseColor } from '../../src/stores/useAppStore';

/** 与 ImageData 结构兼容（node 无 ImageData 全局，故用结构化类型） */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface AtlasSourceFrame {
  /** 帧名（导出后原样写进 ftx3，游戏端按此名取帧） */
  name: string;
  image: RgbaImage;
}

export interface AtlasPackOptions {
  /** 全体帧统一目标高度（0 / undefined = 不缩放，保持原尺寸） */
  targetHeight?: number;
  /** 共享调色板颜色数上限（FTX3 单帧 8bit regionId 上限 254） */
  paletteSize?: number;
  /** alpha ≥ 该值视为不透明像素 */
  alphaThreshold?: number;
  /** true = 每帧裁到内容紧包围盒；false = 保留整幅画布（组件间相对位置不丢） */
  tightCrop?: boolean;
  /** 帧间预测（同尺寸帧可省体积；尺寸不一致时游戏端解码不校验会错，默认关） */
  enablePrediction?: boolean;
}

export interface AtlasFrameInfo {
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  /** 不透明像素占比 */
  opaqueRatio: number;
  /** 使用 0.25 窄范围量化的分块占比（越高 = 残差越精细） */
  narrowBlockRatio: number;
  /** 残差通道最大绝对偏差（量化前，0.5 = 满量程） */
  maxDelta: number;
}

export interface AtlasPackResult {
  /** 未 gzip 的 FTX3 二进制 */
  binary: Uint8Array;
  palette: Array<{ h: number; s: number; l: number }>;
  frames: FrameExportData[];
  info: AtlasFrameInfo[];
  /** 全体帧不透明像素里残差被满量程截断的比例（>0 说明基色不够贴合） */
  clippedRatio: number;
}

const DEFAULTS = {
  targetHeight: 0,
  paletteSize: 128,
  alphaThreshold: 128,
  tightCrop: true,
  enablePrediction: false,
};

// ---------------- 1. alpha 紧包围盒 ----------------

function contentBBox(img: RgbaImage, alphaThreshold: number) {
  const { data, width, height } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------------- 2. 面积重采样（按 alpha 预乘，避免暗边） ----------------

export function areaResample(img: RgbaImage, dw: number, dh: number): RgbaImage {
  const { data, width: sw, height: sh } = img;
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const out = new Uint8ClampedArray(dw * dh * 4);
  if (dw === sw && dh === sh) {
    out.set(data);
    return { data: out, width: dw, height: dh };
  }
  const xr = sw / dw;
  const yr = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yr, y1 = y0 + yr;
    const iy0 = Math.floor(y0), iy1 = Math.min(sh, Math.ceil(y1));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xr, x1 = x0 + xr;
      const ix0 = Math.floor(x0), ix1 = Math.min(sw, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        const row = sy * sw * 4;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const p = row + sx * 4;
          const al = data[p + 3] / 255;
          r += data[p] * al * w;
          g += data[p + 1] * al * w;
          b += data[p + 2] * al * w;
          a += al * w;
          wsum += w;
        }
      }
      const idx = (dy * dw + dx) * 4;
      if (a > 1e-6) {
        out[idx] = r / a;
        out[idx + 1] = g / a;
        out[idx + 2] = b / a;
      }
      out[idx + 3] = wsum > 0 ? (a / wsum) * 255 : 0;
    }
  }
  return { data: out, width: dw, height: dh };
}

function cropTo(img: RgbaImage, bbox: { x: number; y: number; w: number; h: number }): RgbaImage {
  const { data, width } = img;
  const out = new Uint8ClampedArray(bbox.w * bbox.h * 4);
  for (let y = 0; y < bbox.h; y++) {
    const src = ((bbox.y + y) * width + bbox.x) * 4;
    out.set(data.subarray(src, src + bbox.w * 4), y * bbox.w * 4);
  }
  return { data: out, width: bbox.w, height: bbox.h };
}

// ---------------- 3. 调色板（k-means，hue 按环形距离） ----------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 环形 hue 差（最短弧，结果 ∈ [-0.5, 0.5]）；s/l 直接相减 */
function deltaHue(h: number, base: number): number {
  let d = h - base;
  d -= Math.round(d);
  return d;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function buildPalette(samples: Hsl[], k: number, seed = 0x9e3779b9): Hsl[] {
  const n = samples.length;
  if (n === 0) return [{ h: 0, s: 0, l: 0 }];
  k = Math.max(1, Math.min(k, n));
  const rnd = mulberry32(seed);
  const dist2 = (a: Hsl, b: Hsl) => {
    const dh = deltaHue(a.h, b.h);
    const ds = a.s - b.s;
    const dl = a.l - b.l;
    return dh * dh + ds * ds * 0.25 + dl * dl * 0.25;
  };

  // k-means++ 初始化
  const centers: Hsl[] = [samples[Math.floor(rnd() * n)]];
  const best = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(samples[i], last);
      if (d < best[i]) best[i] = d;
      sum += best[i];
    }
    let target = rnd() * sum;
    let pick = 0;
    for (let i = 0; i < n; i++) {
      target -= best[i];
      if (target <= 0) { pick = i; break; }
    }
    centers.push(samples[pick]);
  }

  // Lloyd 迭代（hue 用向量的 sin/cos 累加，避免 0/1 边界撕裂）
  const acc = new Float64Array(k * 5);
  for (let iter = 0; iter < 12; iter++) {
    acc.fill(0);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(s, centers[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      const o = bi * 5;
      const ang = s.h * Math.PI * 2;
      acc[o] += Math.cos(ang) * s.s;
      acc[o + 1] += Math.sin(ang) * s.s;
      acc[o + 2] += s.s;
      acc[o + 3] += s.l;
      acc[o + 4] += 1;
      counts[bi]++;
    }
    let moved = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // 空簇：重启到随机样本
        centers[c] = samples[Math.floor(rnd() * n)];
        moved++;
        continue;
      }
      const o = c * 5;
      let h = Math.atan2(acc[o + 1], acc[o]) / (Math.PI * 2);
      if (h < 0) h += 1;
      const s = acc[o + 2] / counts[c];
      const l = acc[o + 3] / counts[c];
      if (Math.abs(deltaHue(h, centers[c].h)) > 1e-4 || Math.abs(s - centers[c].s) > 1e-4 || Math.abs(l - centers[c].l) > 1e-4) moved++;
      centers[c] = { h, s, l };
    }
    if (moved === 0) break;
  }
  return centers;
}

// ---------------- 4. 最近基色查表（量化 HSL 网格 → 免去逐像素 K 次比较） ----------------

const LUT_H = 64, LUT_S = 16, LUT_L = 16;

function buildAssignmentLut(palette: Hsl[]): Uint8Array {
  const lut = new Uint8Array(LUT_H * LUT_S * LUT_L);
  for (let hi = 0; hi < LUT_H; hi++) {
    const h = (hi + 0.5) / LUT_H;
    for (let si = 0; si < LUT_S; si++) {
      const s = (si + 0.5) / LUT_S;
      for (let li = 0; li < LUT_L; li++) {
        const l = (li + 0.5) / LUT_L;
        let bi = 0, bd = Infinity;
        for (let c = 0; c < palette.length; c++) {
          const p = palette[c];
          const dh = deltaHue(h, p.h);
          const ds = s - p.s;
          const dl = l - p.l;
          const d = dh * dh + ds * ds * 0.25 + dl * dl * 0.25;
          if (d < bd) { bd = d; bi = c; }
        }
        lut[(hi * LUT_S + si) * LUT_L + li] = bi;
      }
    }
  }
  return lut;
}

// ---------------- 5. 主流程 ----------------

interface Prepared {
  name: string;
  image: RgbaImage;
  sourceWidth: number;
  sourceHeight: number;
  hsl: Float32Array; // w*h*3（透明像素未定义）
  opaque: Uint8Array; // w*h
}

function prepare(src: AtlasSourceFrame, opt: Required<AtlasPackOptions>): Prepared {
  let img = src.image;
  const sourceWidth = img.width;
  const sourceHeight = img.height;
  let box = { x: 0, y: 0, w: img.width, h: img.height };
  if (opt.tightCrop) {
    box = contentBBox(img, opt.alphaThreshold);
    img = cropTo(img, box);
  }
  if (opt.targetHeight > 0 && opt.targetHeight !== img.height) {
    const scale = opt.targetHeight / img.height;
    img = areaResample(img, Math.max(1, Math.round(img.width * scale)), opt.targetHeight);
  }
  const { data, width, height } = img;
  const total = width * height;
  const hsl = new Float32Array(total * 3);
  const opaque = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (data[p + 3] < opt.alphaThreshold) continue;
    const c = rgbToHsl(data[p], data[p + 1], data[p + 2]);
    hsl[i * 3] = c.h;
    hsl[i * 3 + 1] = c.s;
    hsl[i * 3 + 2] = c.l;
    opaque[i] = 1;
  }
  return { name: src.name, image: img, sourceWidth, sourceHeight, hsl, opaque };
}

/**
 * 只做「裁剪 + 缩放」的准备步骤，返回每帧实际参与编码的位图。
 * 用途：外部验收（把还原结果和这里的位图逐像素比对，避免把重采样误差算进编码误差）。
 */
export function prepareSources(
  sources: AtlasSourceFrame[],
  options: AtlasPackOptions = {},
): Array<{ name: string; image: RgbaImage }> {
  const opt: Required<AtlasPackOptions> = { ...DEFAULTS, ...options };
  return sources.map((s) => {
    const q = prepare(s, opt);
    return { name: q.name, image: q.image };
  });
}

export function packAtlas(sources: AtlasSourceFrame[], options: AtlasPackOptions = {}): AtlasPackResult {  const opt: Required<AtlasPackOptions> = { ...DEFAULTS, ...options };
  if (sources.length === 0) throw new Error('[图集打包] 没有输入帧');
  if (opt.paletteSize > 254) throw new Error('[图集打包] paletteSize 上限 254（FTX3 单帧 8bit regionId）');

  const prepared = sources.map((s) => prepare(s, opt));

  // 全体帧联合采样 → 共享调色板
  const MAX_SAMPLES = 30000;
  const totalOpaque = prepared.reduce((acc, p) => acc + p.image.width * p.image.height, 0);
  const stride = Math.max(1, Math.floor(totalOpaque / MAX_SAMPLES));
  const samples: Hsl[] = [];
  let counter = 0;
  for (const p of prepared) {
    const total = p.image.width * p.image.height;
    for (let i = 0; i < total; i++) {
      if (!p.opaque[i]) continue;
      if (counter++ % stride !== 0) continue;
      samples.push({ h: p.hsl[i * 3], s: p.hsl[i * 3 + 1], l: p.hsl[i * 3 + 2] });
    }
  }
  const palette = buildPalette(samples, opt.paletteSize);
  const lut = buildAssignmentLut(palette);

  const frames: FrameExportData[] = [];
  const info: AtlasFrameInfo[] = [];
  let clipped = 0;
  let opaqueTotal = 0;

  for (const p of prepared) {
    const w = p.image.width;
    const h = p.image.height;
    const total = w * h;
    const regionIdTex = new Uint16Array(total);
    const deltaH = new Float32Array(total);
    const deltaS = new Float32Array(total);
    const deltaL = new Float32Array(total);

    let opaqueCount = 0;
    for (let i = 0; i < total; i++) {
      if (!p.opaque[i]) continue;
      opaqueCount++;
      const ph = p.hsl[i * 3], ps = p.hsl[i * 3 + 1], pl = p.hsl[i * 3 + 2];
      const hi = Math.min(LUT_H - 1, Math.floor(ph * LUT_H));
      const si = Math.min(LUT_S - 1, Math.floor(ps * LUT_S));
      const li = Math.min(LUT_L - 1, Math.floor(pl * LUT_L));
      const ci = lut[(hi * LUT_S + si) * LUT_L + li];
      regionIdTex[i] = ci + 1;
      const base = palette[ci];
      deltaH[i] = deltaHue(ph, base.h);
      deltaS[i] = ps - base.s;
      deltaL[i] = pl - base.l;
    }
    opaqueTotal += opaqueCount;

    // 每 8×8 分块选量化范围：块内所有残差都落在 ±0.25 → 窄范围（更精细）
    const blockNarrow = new Uint8Array(ADAPTIVE_BLOCK_COLS * ADAPTIVE_BLOCK_ROWS);
    const blockMax = new Float32Array(ADAPTIVE_BLOCK_COLS * ADAPTIVE_BLOCK_ROWS);
    for (let i = 0; i < total; i++) {
      if (!p.opaque[i]) continue;
      const b = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
      const m = Math.max(Math.abs(deltaH[i]), Math.abs(deltaS[i]), Math.abs(deltaL[i]));
      if (m > blockMax[b]) blockMax[b] = m;
    }
    let narrow = 0;
    for (let b = 0; b < blockMax.length; b++) {
      if (blockMax[b] > 0 && blockMax[b] <= 0.25) { blockNarrow[b] = 1; narrow++; }
    }

    const blockFlags = blockNarrow.reduce(
      (acc, bit, b) => (bit ? (acc | (1n << BigInt(b))) : acc),
      0n,
    );

    const deltaPacked = new Uint16Array(total);
    let maxDelta = 0;
    for (let i = 0; i < total; i++) {
      if (!p.opaque[i]) continue;
      const b = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
      const range = blockNarrow[b] ? 0.25 : 0.5;
      const m = Math.max(Math.abs(deltaH[i]), Math.abs(deltaS[i]), Math.abs(deltaL[i]));
      if (m > maxDelta) maxDelta = m;
      if (m > range) clipped++;
      deltaPacked[i] = packRGB565(
        quantizeS(deltaS[i], range),
        quantizeH(deltaH[i], range),
        quantizeL(deltaL[i], range),
      );
    }

    frames.push({
      name: p.name,
      width: w,
      height: h,
      bbox: { x: 0, y: 0, w, h },
      regionIdTex,
      deltaPacked,
      blockFlags,
    });
    info.push({
      name: p.name,
      sourceWidth: p.sourceWidth,
      sourceHeight: p.sourceHeight,
      width: w,
      height: h,
      opaqueRatio: opaqueCount / total,
      narrowBlockRatio: narrow / blockMax.length,
      maxDelta,
    });
  }

  const paletteColors: SharedBaseColor[] = palette.map((c, i) => ({
    id: i + 1,
    h: c.h,
    s: c.s,
    l: c.l,
    // packMultiFrameToBinary 只用到 id/h/s/l；这两个字段是编辑器调色板的元信息
    frameIds: [],
    area: 0,
  }));

  const binary = packMultiFrameToBinary(paletteColors, frames, opt.enablePrediction);

  return {
    binary,
    palette,
    frames,
    info,
    clippedRatio: opaqueTotal > 0 ? clipped / (opaqueTotal * 3) : 0,
  };
}

// ---------------- 6. 解码（与游戏端 ftx.ts + renderer.ts 同一套公式） ----------------
// 用途：UI 里「打包后预览」——直接从成品二进制还原，所见即游戏所见。

function invertDelta8(filtered: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    out[i] = i % stride === 0 ? filtered[i] : filtered[i] + out[i - 1];
  }
  return out;
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export interface DecodedAtlasFrame {
  name: string;
  width: number;
  height: number;
  image: RgbaImage;
}

/** 把打包后的 FTX3 二进制还原成 RGBA（仅供预览/验证用） */
export function decodeAtlasFrame(binary: Uint8Array, frameIndex: number): DecodedAtlasFrame {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  let offset = 0;
  const magic = view.getUint32(offset, false); offset += 4;
  if (magic !== 0x46545833) throw new Error('不是 FTX3 二进制');
  const version = view.getUint8(offset); offset += 1;
  if (version !== 3) throw new Error(`不支持的 FTX 版本 ${version}`);
  const prediction = view.getUint8(offset); offset += 1;
  const frameCount = view.getUint16(offset, true); offset += 2;
  const paletteCount = view.getUint16(offset, true); offset += 2;
  const palette: Hsl[] = [];
  for (let i = 0; i < paletteCount; i++) {
    palette.push({
      h: view.getFloat32(offset, true),
      s: view.getFloat32(offset + 4, true),
      l: view.getFloat32(offset + 8, true),
    });
    offset += 12;
  }
  let prev: Uint8Array | null = null;
  let result: DecodedAtlasFrame | null = null;
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset); offset += 1;
    const name = new TextDecoder().decode(binary.subarray(offset, offset + nameLen));
    offset += nameLen;
    const width = view.getUint16(offset, true); offset += 2;
    const height = view.getUint16(offset, true); offset += 2;
    const bx = view.getUint16(offset, true); offset += 2;
    const by = view.getUint16(offset, true); offset += 2;
    const bw = view.getUint16(offset, true); offset += 2;
    const bh = view.getUint16(offset, true); offset += 2;
    const blockFlags = view.getBigUint64(offset, true); offset += 8;
    const ridLen = view.getUint32(offset, true); offset += 4;
    let regionIdTex = new Uint8Array(0);
    if (ridLen > 0) {
      const processed = invertDelta8(binary.subarray(offset, offset + ridLen), bw);
      offset += ridLen;
      regionIdTex = new Uint8Array(processed.length);
      for (let i = 0; i < processed.length; i++) {
        const val = processed[i];
        if (prediction === 1 && prev && val === 1) regionIdTex[i] = prev[i];
        else regionIdTex[i] = val === 0 ? 0 : val - 1;
      }
    }
    const dLen = view.getUint32(offset, true); offset += 4;
    let deltaPacked = new Uint16Array(0);
    if (dLen > 0) {
      const bytes = binary.subarray(offset, offset + dLen);
      offset += dLen;
      const totalPixels = bw * bh;
      const hCh = invertDelta8(bytes.subarray(0, totalPixels), bw);
      const sCh = invertDelta8(bytes.subarray(totalPixels, totalPixels * 2), bw);
      const lCh = invertDelta8(bytes.subarray(totalPixels * 2, totalPixels * 3), bw);
      deltaPacked = new Uint16Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        deltaPacked[i] = ((sCh[i] & 0x1f) << 11) | ((hCh[i] & 0x3f) << 5) | (lCh[i] & 0x1f);
      }
    }
    prev = regionIdTex;
    if (f !== frameIndex) continue;

    const totalPixels = bw * bh;
    const out = new Uint8ClampedArray(bw * bh * 4);
    for (let i = 0; i < totalPixels; i++) {
      const id = regionIdTex.length > 0 ? regionIdTex[i] : 0;
      if (id === 0) continue;
      const base = palette[id - 1] ?? { h: 0, s: 0, l: 0 };
      const packed = deltaPacked[i] ?? 0;
      const qS = (packed >> 11) & 0x1f;
      const qH = (packed >> 5) & 0x3f;
      const qL = packed & 0x1f;
      let r8 = Math.round((qH / 63) * 255);
      let g8 = Math.round((qS / 31) * 255);
      let b8 = Math.round((qL / 31) * 255);
      const blockIdx = getAdaptiveBlockIndex(i % bw, Math.floor(i / bw), bw, bh);
      if ((blockFlags & (1n << BigInt(blockIdx))) !== 0n) {
        r8 = Math.round(r8 * 0.5 + 64);
        g8 = Math.round(g8 * 0.5 + 64);
        b8 = Math.round(b8 * 0.5 + 64);
      }
      // renderer.ts 片元着色器：dH = (res.r * 2.0 - 1.0) * 0.5；res.r = r8/255
      const dH = r8 / 255 - 0.5;
      const dS = g8 / 255 - 0.5;
      const dL = b8 / 255 - 0.5;
      const finalH = ((base.h + dH) % 1 + 1) % 1;
      const finalS = Math.max(0, Math.min(1, base.s + dS));
      const finalL = Math.max(0, Math.min(1, base.l + dL));
      const [r, g, b] = hsl2rgb(finalH, finalS, finalL);
      const p = i * 4;
      out[p] = r * 255;
      out[p + 1] = g * 255;
      out[p + 2] = b * 255;
      out[p + 3] = 255;
    }
    result = { name, width, height, image: { data: out, width: bw, height: bh } };
  }
  if (!result) throw new Error(`帧索引越界：${frameIndex} / ${frameCount}`);
  return result;
}

export { packMultiFrameToBinary };
