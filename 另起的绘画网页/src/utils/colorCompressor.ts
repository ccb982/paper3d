import { useAppStore } from '../stores/useAppStore';
import { computeRegionsExact } from './regionDetectionExact';
import type { Point } from '../types';

// ==================== 颜色空间转换 ====================
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ==================== 区域掩码光栅化 ====================
export function rasterizeRegionMask(region: Point[][], width: number, height: number): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 黑色背景
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  // 绘制所有环（白色填充）
  ctx.fillStyle = 'white';
  for (const ring of region) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pts = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
  }

  // 描边（保证边界像素被包含）
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  for (const ring of region) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pts = ring.map(p => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i], g = imageData.data[i+1], b = imageData.data[i+2];
    if (r > 200 && g > 200 && b > 200) mask[i/4] = 1;
  }
  return mask;
}

// ==================== BFS 按色相聚类 ====================
export function bfsHueClustering(
  mask: Uint8Array,
  width: number,
  height: number,
  buffer: ImageData,
  hueThreshold: number = 0.05
): Array<{ pixels: number[]; avgHsl: { h: number; s: number; l: number } }> {
  const visited = new Uint8Array(width * height);
  const clusters: Array<{ pixels: number[]; sumR: number; sumG: number; sumB: number }> = [];

  const getIndex = (x: number, y: number) => y * width + x;
  const getColor = (idx: number) => {
    const i = idx * 4;
    return { r: buffer.data[i], g: buffer.data[i+1], b: buffer.data[i+2] };
  };

  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      if (mask[idx] === 0 || visited[idx]) continue;

      // 种子像素
      const seedColor = getColor(idx);
      const seedHsl = rgbToHsl(seedColor.r, seedColor.g, seedColor.b);

      // BFS
      const queue: [number, number][] = [[x, y]];
      visited[idx] = 1;
      const clusterPixels: number[] = [];
      let sumR = 0, sumG = 0, sumB = 0;

      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        const ci = getIndex(cx, cy);
        clusterPixels.push(ci);
        const col = getColor(ci);
        sumR += col.r; sumG += col.g; sumB += col.b;

        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = getIndex(nx, ny);
          if (mask[ni] === 0 || visited[ni]) continue;

          const neighborCol = getColor(ni);
          const neighborHsl = rgbToHsl(neighborCol.r, neighborCol.g, neighborCol.b);
          // 色相差值（考虑环形）
          let dh = neighborHsl.h - seedHsl.h;
          if (dh > 0.5) dh -= 1.0;
          else if (dh < -0.5) dh += 1.0;
          if (Math.abs(dh) < hueThreshold) {
            visited[ni] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      if (clusterPixels.length > 0) {
        const avgR = sumR / clusterPixels.length;
        const avgG = sumG / clusterPixels.length;
        const avgB = sumB / clusterPixels.length;
        const avgHsl = rgbToHsl(avgR, avgG, avgB);
        clusters.push({ pixels: clusterPixels, avgHsl });
      }
    }
  }

  return clusters;
}

// ==================== 主压缩函数（V2 多级色块纹理压缩） ====================
const PAINT_BUFFER_SIZE = 512;

// ==================== 类型定义 ====================
export interface CompressedRegionV2 {
  id: number;
  bbox: { x: number; y: number; w: number; h: number };
  baseColors: Array<{ h: number; s: number; l: number }>;
  regionIdTexture?: string;
  deltaTexture: string;
}

export interface CompressionResultV2 {
  version: 2;
  resolution: [number, number];
  regionCount: number;
  regions: CompressedRegionV2[];
  quantization: 'uint8';
  hueThreshold: number;
}

// ==================== 辅助函数 ====================
function computeBBoxAllRings(region: Point[][]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of region) {
    for (const p of ring) {
      const px = p.x * PAINT_BUFFER_SIZE;
      const py = (1 - p.y) * PAINT_BUFFER_SIZE;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  const padding = 2;
  minX = Math.max(0, Math.floor(minX) - padding);
  minY = Math.max(0, Math.floor(minY) - padding);
  maxX = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(maxX) + padding);
  maxY = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(maxY) + padding);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function projectPolygonToBBox(region: Point[][], bbox: { x: number; y: number; w: number; h: number }): Point[][] {
  return region.map(ring =>
    ring.map(p => ({
      x: (p.x * PAINT_BUFFER_SIZE - bbox.x),
      y: ((1 - p.y) * PAINT_BUFFER_SIZE - bbox.y),
    }))
  );
}

function rasterizeRegionMaskLocal(region: Point[][], bbox: { x: number; y: number; w: number; h: number }): Uint8Array {
  const { w, h } = bbox;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  const localRings = projectPolygonToBBox(region, bbox);
  ctx.fillStyle = 'white';
  for (const ring of localRings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
  }
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  for (const ring of localRings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  const imageData = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (imageData.data[i] > 200 && imageData.data[i+1] > 200 && imageData.data[i+2] > 200) mask[i / 4] = 1;
  }
  return mask;
}

function normalizeHueDelta(delta: number): number {
  if (delta > 0.5) return delta - 1.0;
  if (delta < -0.5) return delta + 1.0;
  return delta;
}

function hueDistance(h1: number, h2: number): number {
  let d = h2 - h1;
  if (d > 0.5) d -= 1.0;
  else if (d < -0.5) d += 1.0;
  return Math.abs(d);
}

function clusterAndGenerateTexturesV2(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  hueThreshold: number = 0.05,
  sourceWidth: number = PAINT_BUFFER_SIZE  // 支持外部指定源图像宽度
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint8Array | null; deltaTex: Uint8Array } {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const totalPixels = w * h;
  const visited = new Uint8Array(totalPixels);
  interface Cluster { pixels: number[]; sumH: number; sumS: number; sumL: number; count: number; avgH: number; avgS: number; avgL: number; }
  const clusters: Cluster[] = [];

  const getColor = (idx: number) => {
    const globalIdx = ((offsetY + Math.floor(idx / w)) * sourceWidth + (offsetX + (idx % w))) * 4;
    return { r: paintBuffer.data[globalIdx], g: paintBuffer.data[globalIdx + 1], b: paintBuffer.data[globalIdx + 2] };
  };
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0 || visited[idx]) continue;
      const seedColor = getColor(idx);
      const seedHsl = rgbToHsl(seedColor.r, seedColor.g, seedColor.b);
      const queue: [number, number][] = [[x, y]];
      visited[idx] = 1;
      const cluster: Cluster = { pixels: [], sumH: seedHsl.h, sumS: seedHsl.s, sumL: seedHsl.l, count: 1, avgH: seedHsl.h, avgS: seedHsl.s, avgL: seedHsl.l };
      cluster.pixels.push(idx);

      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        const ci = cy * w + cx;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] === 0 || visited[ni]) continue;
          const neighborColor = getColor(ni);
          const neighborHsl = rgbToHsl(neighborColor.r, neighborColor.g, neighborColor.b);
          const hDist = hueDistance(cluster.avgH, neighborHsl.h);
          if (hDist < hueThreshold) {
            visited[ni] = 1;
            queue.push([nx, ny]);
            cluster.pixels.push(ni);
            cluster.sumH += neighborHsl.h; cluster.sumS += neighborHsl.s; cluster.sumL += neighborHsl.l;
            cluster.count++;
            cluster.avgH = cluster.sumH / cluster.count;
            cluster.avgS = cluster.sumS / cluster.count;
            cluster.avgL = cluster.sumL / cluster.count;
          }
        }
      }
      if (cluster.pixels.length > 0) clusters.push(cluster);
    }
  }

  if (clusters.length === 0) return { baseColors: [], regionIdTex: null, deltaTex: new Uint8Array(0) };

  const baseColors = clusters.map(c => ({ h: c.sumH / c.count, s: c.sumS / c.count, l: c.sumL / c.count }));
  const regionIdTex = clusters.length > 1 ? new Uint8Array(totalPixels) : null;
  const deltaTex = new Uint8Array(totalPixels * 3);
  
  // 量化公式（与 dequantize 配套）：
  // dH = ((value / 255) - 0.5) * 0.5 * 2 = value/255 - 0.5
  //    => value = (dH + 0.5) * 255, dH ∈ [-0.5, 0.5]
  // dS = ((value / 255) - 0.5) * 1.0 * 2 = value/127.5 - 1
  //    => value = (dS + 1) * 127.5, dS ∈ [-1, 1]
  // dL 同 S
  const quantize = (value: number, range: number): number => {
    const normalized = (value / range) * 0.5 + 0.5;
    return Math.round(Math.max(0, Math.min(1, normalized)) * 255);
  };

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const base = baseColors[ci];
    for (const pixelIdx of cluster.pixels) {
      if (regionIdTex) regionIdTex[pixelIdx] = ci + 1;
      const col = getColor(pixelIdx);
      const hsl = rgbToHsl(col.r, col.g, col.b);
      const dH = normalizeHueDelta(hsl.h - base.h);
      const dS = hsl.s - base.s;
      const dL = hsl.l - base.l;
      const idx3 = pixelIdx * 3;
      deltaTex[idx3] = quantize(dH * 0.5, 0.25);
      deltaTex[idx3 + 1] = quantize(dS, 1.0);
      deltaTex[idx3 + 2] = quantize(dL, 1.0);
    }
  }
  return { baseColors, regionIdTex, deltaTex };
}

// 导出辅助函数供外部使用（bakeRegionLayerTexture）
export function dequantize(value: number, range: number): number {
  return ((value / 255) - 0.5) * range * 2;
}

// ==================== FTX 2.0 解码函数 ====================
// 量化公式：
//   Encoded_H = (dH + 0.5) * 63  → 0~63 (6位)
//   Encoded_S = (dS + 1.0) * 15.5 → 0~31 (5位)
//   Encoded_L = (dL + 1.0) * 15.5 → 0~31 (5位)
// 偏置烘焙：
//   Base_Shifted = (Base_H - 0.5, Base_S - 1.0, Base_L - 1.0)
// 解码公式：
//   Final_HSL = Base_Shifted + Delta_Encoded（仅加法）

/**
 * FTX 2.0 反量化：从 uint8 编码值还原物理残差
 * @param encodedH 0~255 编码值（对应 0~63 量化范围）
 * @param encodedS 0~255 编码值（对应 0~31 量化范围）
 * @param encodedL 0~255 编码值（对应 0~31 量化范围）
 */
export function dequantizeFTX2(
  encodedH: number,
  encodedS: number,
  encodedL: number
): { dH: number; dS: number; dL: number } {
  // uint8 → 量化整数
  const quantH = encodedH / 255 * 63;
  const quantS = encodedS / 255 * 31;
  const quantL = encodedL / 255 * 31;
  
  // 量化整数 → 物理残差
  return {
    dH: (quantH / 63) - 0.5,      // -0.5 ~ +0.5
    dS: (quantS / 31) - 1.0,      // -1.0 ~ +1.0
    dL: (quantL / 31) - 1.0       // -1.0 ~ +1.0
  };
}

/**
 * FTX 2.0 基础色偏置烘焙
 * @param base 原始基础色 (H, S, L)
 */
export function bakeBaseColorFTX2(base: { h: number; s: number; l: number }): { h: number; s: number; l: number } {
  return {
    h: base.h - 0.5,
    s: base.s - 1.0,
    l: base.l - 1.0
  };
}

/**
 * FTX 2.0 解码：从偏置基础色和编码残差还原最终 HSL
 * @param baseShifted 偏置后的基础色
 * @param encodedH 0~255 编码值
 * @param encodedS 0~255 编码值
 * @param encodedL 0~255 编码值
 */
export function decodeFTX2(
  baseShifted: { h: number; s: number; l: number },
  encodedH: number,
  encodedS: number,
  encodedL: number
): { h: number; s: number; l: number } {
  // 量化公式验证：
  // H: quantize = (dH + 0.5) * 255, decode = encoded / 255
  // S: quantize = (dS + 1.0) * 127.5, decode = (encoded / 127.5) - 1
  // L: quantize = (dL + 1.0) * 127.5, decode = (encoded / 127.5) - 1
  const finalH = fract(baseShifted.h + (encodedH / 255));
  const finalS = clamp(baseShifted.s + (encodedS / 127.5) - 1.0, 0, 1);
  const finalL = clamp(baseShifted.l + (encodedL / 127.5) - 1.0, 0, 1);
  return { h: finalH, s: finalS, l: finalL };
}

// 辅助函数
function fract(x: number): number {
  return x - Math.floor(x);
}
function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export { computeBBoxAllRings, rasterizeRegionMaskLocal, clusterAndGenerateTexturesV2 };

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ==================== 主压缩函数 ====================
export function compressLayerColors(layerId: string): CompressionResultV2 | null {
  const state = useAppStore.getState();
  const dashShapes = state.shapes.filter(s => s.color === '#ffaa00' && s.layerId === layerId);
  if (dashShapes.length === 0) { console.warn('[颜色压缩] 没有虚线图形'); return null; }

  const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const regions = computeRegionsExact(dashShapes, worldBounds, 600);
  if (regions.length === 0) { console.warn('[颜色压缩] 没有检测到闭合区域'); return null; }

  const buffer = state.paintBuffers[layerId];
  if (!buffer) { console.warn('[颜色压缩] 当前图层没有 paintBuffer'); return null; }

  const compressedRegions: CompressedRegionV2[] = [];
  const hueThreshold = 0.05;

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    const bbox = computeBBoxAllRings(region);
    const mask = rasterizeRegionMaskLocal(region, bbox);
    const { baseColors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(mask, bbox, buffer, hueThreshold);
    if (baseColors.length === 0) continue;

    compressedRegions.push({
      id: ri,
      bbox,
      baseColors,
      regionIdTexture: regionIdTex ? bufferToBase64(regionIdTex.buffer) : undefined,
      deltaTexture: bufferToBase64(deltaTex.buffer),
    });
  }

  const result: CompressionResultV2 = {
    version: 2,
    resolution: [PAINT_BUFFER_SIZE, PAINT_BUFFER_SIZE],
    regionCount: compressedRegions.length,
    regions: compressedRegions,
    quantization: 'uint8',
    hueThreshold,
  };

  console.log('[颜色压缩] 压缩完成，区域数:', compressedRegions.length);
  return result;
}
