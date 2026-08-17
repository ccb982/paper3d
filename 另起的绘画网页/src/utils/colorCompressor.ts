import { isPointInPolygonWithHoles } from './regionDetection';
import type { Point } from '../types';
import {
  ADAPTIVE_BLOCK_COLS,
  ADAPTIVE_BLOCK_ROWS,
  ADAPTIVE_TOTAL_BLOCKS,
  getAdaptiveBlockIndex,
  getRangeForBlock,
  quantizeH,
  quantizeS,
  quantizeL,
  dequantizeH,
  dequantizeS,
  dequantizeL,
  uint8ToBase64,
  packRGB565,
  unpackRGB565,
} from '../core/ftxCore';
import type { FrameExportData } from './multiFrameExport';
import type { SharedBaseColor } from '../stores/useAppStore';

export {
  ADAPTIVE_BLOCK_COLS,
  ADAPTIVE_BLOCK_ROWS,
  ADAPTIVE_TOTAL_BLOCKS,
  getAdaptiveBlockIndex,
  getRangeForBlock,
  quantizeH,
  quantizeS,
  quantizeL,
  dequantizeH,
  dequantizeS,
  dequantizeL,
};

// ==================== 颜色空间转换 ====================
export function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rL = r / 255;
  const gL = g / 255;
  const bL = b / 255;
  const max = Math.max(rL, gL, bL), min = Math.min(rL, gL, bL);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rL) h = ((gL - bL) / d + (gL < bL ? 6 : 0)) / 6;
    else if (max === gL) h = ((bL - rL) / d + 2) / 6;
    else h = ((rL - gL) / d + 4) / 6;
  }
  return { h, s, l };
}

export function linearToSrgb(c: number): number {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1/2.4) - 0.055;
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
  return { 
    r: Math.round(r * 255), 
    g: Math.round(g * 255), 
    b: Math.round(b * 255) 
  };
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
  hueThreshold: number = 0.025
): Array<{ pixels: number[]; avgHsl: { h: number; s: number; l: number } }> {
  const visited = new Uint8Array(width * height);
  const clusters: Array<{ pixels: number[]; avgHsl: { h: number; s: number; l: number } }> = [];

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

function clusterByColorAndSpace(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number = 512,
  maxColors: number = 256
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint16Array } {
  const { w, h } = bbox;
  const totalPixels = w * h;

  const sampled = samplePixelsWithCoords(mask, bbox, paintBuffer, sourceWidth);
  if (sampled.count === 0) {
    return { baseColors: [], regionIdTex: new Uint16Array(totalPixels) };
  }

  const { rgb, coords, count } = sampled;

  const hsl = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    hsl[i * 3] = h;
    hsl[i * 3 + 1] = s;
    hsl[i * 3 + 2] = l;
  }

  const result = hardRadiusClustering(hsl, coords, count);
  let { baseColors, regionIdTex: rawRegionId } = result;

  if (baseColors.length > maxColors) {
    const colorCounts = new Uint32Array(baseColors.length);
    for (let i = 0; i < count; i++) {
      const cid = rawRegionId[i] - 1;
      if (cid >= 0 && cid < baseColors.length) colorCounts[cid]++;
    }
    const sortedIndices = Array.from({ length: baseColors.length }, (_, i) => i)
      .sort((a, b) => colorCounts[b] - colorCounts[a])
      .slice(0, maxColors);
    const keepSet = new Set(sortedIndices);
    const newColors: Array<{ h: number; s: number; l: number }> = [];
    const oldToNew = new Map<number, number>();
    for (let i = 0; i < sortedIndices.length; i++) {
      const oldIdx = sortedIndices[i];
      oldToNew.set(oldIdx, i);
      newColors.push(baseColors[oldIdx]);
    }
    const newRegionId = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      const oldId = rawRegionId[i] - 1;
      if (keepSet.has(oldId)) {
        newRegionId[i] = oldToNew.get(oldId)! + 1;
      } else {
        let minDist = Infinity;
        let bestNew = 0;
        const h = hsl[i * 3];
        const s = hsl[i * 3 + 1];
        const l = hsl[i * 3 + 2];
        for (const [, newIdx] of oldToNew) {
          const c = newColors[newIdx];
          const dh = deltaHue(h, c.h);
          const ds = Math.abs(s - c.s);
          const dl = Math.abs(l - c.l);
          const dist = dh * 1.0 + ds * 0.5 + dl * 0.5;
          if (dist < minDist) { minDist = dist; bestNew = newIdx; }
        }
        newRegionId[i] = bestNew + 1;
      }
    }
    baseColors = newColors;
    rawRegionId = newRegionId;
  }

  const regionIdTex = new Uint16Array(totalPixels);
  for (let i = 0; i < count; i++) {
    const pixelIdx = sampled.pixelIndices[i];
    regionIdTex[pixelIdx] = rawRegionId[i];
  }

  return { baseColors, regionIdTex };
}

function samplePixelsWithCoords(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number
): { rgb: Float32Array; coords: Float32Array; pixelIndices: Uint32Array; count: number } {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const totalPixels = w * h;
  let count = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (mask[i] === 1) count++;
  }
  if (count === 0) {
    return { rgb: new Float32Array(0), coords: new Float32Array(0), pixelIndices: new Uint32Array(0), count: 0 };
  }

  const rgb = new Float32Array(count * 3);
  const coords = new Float32Array(count * 2);
  const pixelIndices = new Uint32Array(count);
  let idx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const localIdx = y * w + x;
      if (mask[localIdx] === 1) {
        const globalX = offsetX + x;
        const globalY = offsetY + y;
        const pixelIdx = (globalY * sourceWidth + globalX) * 4;
        rgb[idx * 3] = paintBuffer.data[pixelIdx];
        rgb[idx * 3 + 1] = paintBuffer.data[pixelIdx + 1];
        rgb[idx * 3 + 2] = paintBuffer.data[pixelIdx + 2];
        coords[idx * 2] = x / w;
        coords[idx * 2 + 1] = y / h;
        pixelIndices[idx] = localIdx;
        idx++;
      }
    }
  }
  return { rgb, coords, pixelIndices, count };
}

interface Cluster {
  centerH: number;
  centerS: number;
  centerL: number;
  pixels: number[];
  sumH: number;
  sumS: number;
  sumL: number;
  bboxCenterX: number;
  bboxCenterY: number;
}

function hardRadiusClustering(
  hsl: Float32Array,
  coords: Float32Array,
  count: number
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint16Array } {
  const RADIUS = 0.25;
  const MIN_PIXELS = Math.max(10, count * 0.005);
  const MAX_ITER = 5;

  const order = Array.from({ length: count }, (_, i) => i);

  const clusters: Cluster[] = [];
  for (const idx of order) {
    const h = hsl[idx * 3];
    const s = hsl[idx * 3 + 1];
    const l = hsl[idx * 3 + 2];
    const x = coords[idx * 2];
    const y = coords[idx * 2 + 1];

    let bestClusterIdx = -1;
    let bestDist = Infinity;

    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c];
      const dh = deltaHue(h, cl.centerH);
      const ds = Math.abs(s - cl.centerS);
      const dl = Math.abs(l - cl.centerL);
      if (dh <= RADIUS && ds <= RADIUS && dl <= RADIUS) {
        const dist = dh * 1.0 + ds * 0.5 + dl * 0.5;
        if (dist < bestDist) {
          bestDist = dist;
          bestClusterIdx = c;
        }
      }
    }

    if (bestClusterIdx === -1) {
      clusters.push({
        centerH: h,
        centerS: s,
        centerL: l,
        pixels: [idx],
        sumH: h,
        sumS: s,
        sumL: l,
        bboxCenterX: x,
        bboxCenterY: y,
      });
    } else {
      const cl = clusters[bestClusterIdx];
      cl.pixels.push(idx);
      const total = cl.pixels.length;
      cl.centerH = (cl.sumH + h) / total;
      cl.centerS = (cl.sumS + s) / total;
      cl.centerL = (cl.sumL + l) / total;
      cl.sumH += h;
      cl.sumS += s;
      cl.sumL += l;
      cl.bboxCenterX = (cl.bboxCenterX * (total - 1) + x) / total;
      cl.bboxCenterY = (cl.bboxCenterY * (total - 1) + y) / total;
    }
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    for (const cl of clusters) {
      cl.pixels = [];
      cl.sumH = 0;
      cl.sumS = 0;
      cl.sumL = 0;
      cl.bboxCenterX = 0;
      cl.bboxCenterY = 0;
    }

    const newClusters: Cluster[] = [];
    for (let idx = 0; idx < count; idx++) {
      const h = hsl[idx * 3];
      const s = hsl[idx * 3 + 1];
      const l = hsl[idx * 3 + 2];
      const x = coords[idx * 2];
      const y = coords[idx * 2 + 1];

      let bestClusterIdx = -1;
      let bestDist = Infinity;

      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        const dh = deltaHue(h, cl.centerH);
        const ds = Math.abs(s - cl.centerS);
        const dl = Math.abs(l - cl.centerL);
        if (dh <= RADIUS && ds <= RADIUS && dl <= RADIUS) {
          const dist = dh * 1.0 + ds * 0.5 + dl * 0.5;
          if (dist < bestDist) {
            bestDist = dist;
            bestClusterIdx = c;
          }
        }
      }

      if (bestClusterIdx !== -1) {
        const cl = clusters[bestClusterIdx];
        cl.pixels.push(idx);
        cl.sumH += h;
        cl.sumS += s;
        cl.sumL += l;
        cl.bboxCenterX += x;
        cl.bboxCenterY += y;
      } else {
        newClusters.push({
          centerH: h,
          centerS: s,
          centerL: l,
          pixels: [idx],
          sumH: h,
          sumS: s,
          sumL: l,
          bboxCenterX: x,
          bboxCenterY: y,
        });
      }
    }

    clusters.push(...newClusters);

    for (const cl of clusters) {
      const cnt = cl.pixels.length;
      if (cnt === 0) continue;
      cl.centerH = cl.sumH / cnt;
      cl.centerS = cl.sumS / cnt;
      cl.centerL = cl.sumL / cnt;
      cl.bboxCenterX = cl.bboxCenterX / cnt;
      cl.bboxCenterY = cl.bboxCenterY / cnt;
    }

    const nonEmpty = clusters.filter(c => c.pixels.length > 0);
    clusters.length = 0;
    clusters.push(...nonEmpty);

    if (newClusters.length === 0 && iter > 0) break;
  }

  const largeClusters: Cluster[] = [];
  const smallClusters: Cluster[] = [];
  for (const cl of clusters) {
    if (cl.pixels.length >= MIN_PIXELS) {
      largeClusters.push(cl);
    } else {
      smallClusters.push(cl);
    }
  }

  for (const small of smallClusters) {
    let nearestLarge: Cluster | null = null;
    let nearestDist = Infinity;

    for (const large of largeClusters) {
      const dh = deltaHue(small.centerH, large.centerH);
      const ds = Math.abs(small.centerS - large.centerS);
      const dl = Math.abs(small.centerL - large.centerL);
      if (dh > RADIUS || ds > RADIUS || dl > RADIUS) continue;

      const dx = small.bboxCenterX - large.bboxCenterX;
      const dy = small.bboxCenterY - large.bboxCenterY;
      const spaceDist = dx * dx + dy * dy;
      if (spaceDist < nearestDist) {
        nearestDist = spaceDist;
        nearestLarge = large;
      }
    }

    if (nearestLarge) {
      for (const idx of small.pixels) {
        nearestLarge.pixels.push(idx);
      }
      let sH = 0, sS = 0, sL = 0;
      let cx = 0, cy = 0;
      for (const idx of nearestLarge.pixels) {
        sH += hsl[idx * 3];
        sS += hsl[idx * 3 + 1];
        sL += hsl[idx * 3 + 2];
        cx += coords[idx * 2];
        cy += coords[idx * 2 + 1];
      }
      const cnt = nearestLarge.pixels.length;
      nearestLarge.centerH = sH / cnt;
      nearestLarge.centerS = sS / cnt;
      nearestLarge.centerL = sL / cnt;
      nearestLarge.sumH = sH;
      nearestLarge.sumS = sS;
      nearestLarge.sumL = sL;
      nearestLarge.bboxCenterX = cx / cnt;
      nearestLarge.bboxCenterY = cy / cnt;
    } else {
      largeClusters.push(small);
    }
  }

  const finalClusters = largeClusters;
  const baseColors = finalClusters.map(c => ({
    h: c.centerH,
    s: c.centerS,
    l: c.centerL
  }));

  const regionIdTex = new Uint16Array(count);
  for (let cIdx = 0; cIdx < finalClusters.length; cIdx++) {
    for (const idx of finalClusters[cIdx].pixels) {
      regionIdTex[idx] = cIdx + 1;
    }
  }

  return { baseColors, regionIdTex };
}

function deltaHue(a: number, b: number): number {
  let d = a - b;
  if (d > 0.5) d -= 1.0;
  if (d < -0.5) d += 1.0;
  return Math.abs(d);
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
  blockFlags: bigint;
}

export interface CompressionResultV2 {
  version: 3;
  resolution: [number, number];
  regionCount: number;
  regions: CompressedRegionV2[];
  quantization: 'uint8' | 'rgb565';
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

export function clusterAndGenerateTexturesV2(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number = PAINT_BUFFER_SIZE
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint16Array | null; deltaPacked: Uint16Array; blockFlags: bigint } {
  const { w, h } = bbox;
  const totalPixels = w * h;

  const { baseColors, regionIdTex } = clusterByColorAndSpace(mask, bbox, paintBuffer, sourceWidth);

  if (baseColors.length === 0 || totalPixels === 0) {
    return { baseColors: [], regionIdTex: null, deltaPacked: new Uint16Array(0), blockFlags: 0n };
  }

  const tempDeltas = new Float32Array(totalPixels * 3);
  const blockMax = new Float32Array(ADAPTIVE_TOTAL_BLOCKS * 3);

  for (let i = 0; i < totalPixels; i++) {
    const colorIdx = regionIdTex[i];
    if (colorIdx === 0) continue;
    const base = baseColors[colorIdx - 1];
    if (!base) continue;

    const globalX = bbox.x + (i % w);
    const globalY = bbox.y + Math.floor(i / w);
    const pIdx = (globalY * sourceWidth + globalX) * 4;
    const r = paintBuffer.data[pIdx];
    const g = paintBuffer.data[pIdx + 1];
    const b = paintBuffer.data[pIdx + 2];
    const hsl = rgbToHsl(r, g, b);

    const dH = normalizeHueDelta(hsl.h - base.h);
    const dS = hsl.s - base.s;
    const dL = hsl.l - base.l;

    const idx3 = i * 3;
    tempDeltas[idx3] = dH;
    tempDeltas[idx3 + 1] = dS;
    tempDeltas[idx3 + 2] = dL;

    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const baseIdx = blockIdx * 3;
    blockMax[baseIdx] = Math.max(blockMax[baseIdx], Math.abs(dH));
    blockMax[baseIdx + 1] = Math.max(blockMax[baseIdx + 1], Math.abs(dS));
    blockMax[baseIdx + 2] = Math.max(blockMax[baseIdx + 2], Math.abs(dL));
  }

  const blockPixelCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
  const blockSmallCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
  for (let i = 0; i < totalPixels; i++) {
    const colorIdx = regionIdTex[i];
    if (colorIdx === 0) continue;
    const base = baseColors[colorIdx - 1];
    if (!base) continue;
    
    const idx3 = i * 3;
    const dH = tempDeltas[idx3];
    const dS = tempDeltas[idx3 + 1];
    const dL = tempDeltas[idx3 + 2];
    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    blockPixelCount[blockIdx]++;
    if (Math.abs(dH) <= 0.25 && Math.abs(dS) <= 0.25 && Math.abs(dL) <= 0.25) {
      blockSmallCount[blockIdx]++;
    }
  }

  let blockFlags = 0n;
  const ranges = new Float32Array(ADAPTIVE_TOTAL_BLOCKS);
  for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
    if (blockPixelCount[b] > 0) {
      const ratio = blockSmallCount[b] / blockPixelCount[b];
      if (ratio >= 0.95) {
        blockFlags |= (1n << BigInt(b));
        ranges[b] = 0.25;
      } else {
        ranges[b] = 0.5;
      }
    } else {
      ranges[b] = 0.5;
    }
  }

  const deltaPacked = new Uint16Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const colorIdx = regionIdTex[i];
    if (colorIdx === 0) continue;
    const base = baseColors[colorIdx - 1];
    if (!base) continue;

    const idx3 = i * 3;
    const dH = tempDeltas[idx3];
    const dS = tempDeltas[idx3 + 1];
    const dL = tempDeltas[idx3 + 2];

    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const range = ranges[blockIdx];

    const qH = quantizeH(dH, range);
    const qS = quantizeS(dS, range);
    const qL = quantizeL(dL, range);

    deltaPacked[i] = packRGB565(qS, qH, qL);
  }

  return {
    baseColors,
    regionIdTex: regionIdTex.length > 0 ? regionIdTex : null,
    deltaPacked,
    blockFlags
  };
}

// ==================== 强制修正笔刷（4×4） ====================
// 用途：基础色编辑器里，用户用 4×4 笔刷强制修正 bbox 内像素。
// 修正策略（按优先级，目标：残差尽量小，利于差分压缩）：
//   a. 左右邻居的 base 色（残差 = target - 邻居base，可量化则用）
//   b. 上下邻居的 base 色
//   c. 斜向邻居的 base 色
//   d. 全不行 → 新算法：为像素新建 base（= target 色），残差 = 0
// 修正后同步重置 baseColors 列表（从新 regionIdTex 重新统计）。

export interface ForcedFixResult {
  regionIdTex: Uint16Array;
  deltaPacked: Uint16Array;
  baseColors: Array<{ id: number; h: number; s: number; l: number }>;
  blockFlags: bigint;
  /** 统计：改动的像素数 */
  changedCount: number;
  /** 统计：最终仍未达标的像素数 */
  remainingBadCount: number;
  /** 统计：修正前后平均误差（HSL 合成色 vs 目标色） */
  avgErrorBefore: number;
  avgErrorAfter: number;
}

// ★ 达标阈值：合成色（base+残差）vs 原图像素 HSL 各通道差 ≤ 0.02 即达标
//   新方案修复后残差=0、base=target → 合成色=target，必然达标（不受量化影响）
const FIX_HUE_THRESHOLD = 0.02;
const FIX_SAT_THRESHOLD = 0.02;
const FIX_LIGHT_THRESHOLD = 0.02;

function hueDistance(h1: number, h2: number): number {
  let d = Math.abs(h1 - h2);
  if (d > 0.5) d = 1 - d;
  return d;
}

/** 量化往返（模拟实际渲染的残差：quantize → dequantize） */
function quantizeRoundTrip(
  dH: number, dS: number, dL: number,
  range: number,
): { h: number; s: number; l: number } {
  return {
    h: dequantizeH(quantizeH(dH, range), range),
    s: dequantizeS(quantizeS(dS, range), range),
    l: dequantizeL(quantizeL(dL, range), range),
  };
}

/**
 * 强制修正区域（bbox 局部坐标）。
 *
 * ★ 核心目标：保证区域内每个像素的合成色（base + 残差）都符合阈值。
 *
 * 逻辑（简单、严格、无噪点）：
 *   1. 遍历区域内每个像素：
 *      - 空像素 / 透明像素：跳过
 *      - 已达标（当前 base + 当前残差合成色 ≈ 原图色，各通道差 ≤ 0.02）：不动
 *      - 未达标：修复 → 优先复用色距足够近的现有 base（残差 0，合成≈target）；
 *                否则新建 base = target + 残差 0（合成色 = target，必然达标）
 *   2. 重新打包 deltaPacked（保持原 blockFlags 的 range）
 *
 * 关键设计：
 *   - 修复后的像素残差恒为 0 → 不涉及量化误差 → 合成色必然符合阈值
 *   - base = target（原图像素 HSL）→ 无黑灰/错色风险（rgbToHsl→hslToRgb 往返零误差）
 *   - 不复用"量化后可能不达标"的邻居 base → 无碎片化噪点
 */
export function forcedFixBrush(
  regionIdTex: Uint16Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  deltaPacked: Uint16Array,
  blockFlags: bigint,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number,
  cx: number,
  cy: number,
  brushSize: number = 8,
): ForcedFixResult {
  const { w, h } = bbox;
  if (w <= 0 || h <= 0) {
    return { regionIdTex, deltaPacked, baseColors, blockFlags, changedCount: 0, remainingBadCount: 0, avgErrorBefore: 0, avgErrorAfter: 0 };
  }
  const totalPixels = w * h;

  // id → base 映射（regionIdTex 存的是全局色 ID）
  const baseById = new Map<number, { id: number; h: number; s: number; l: number }>();
  let maxBaseId = 0;
  for (const c of baseColors) {
    baseById.set(c.id, c);
    if (c.id > maxBaseId) maxBaseId = c.id;
  }

  // 解包残差为浮点（供达标校验用）
  const tempDeltas = new Float32Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    const packed = deltaPacked[i];
    const { s, h: qH, l: qL } = unpackRGB565(packed);
    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);
    tempDeltas[i * 3] = dequantizeH(qH, range);
    tempDeltas[i * 3 + 1] = dequantizeS(s, range);
    tempDeltas[i * 3 + 2] = dequantizeL(qL, range);
  }

  // 笔刷范围（bbox 局部）—— 8×8 以 cx,cy 为中心
  // ★ 贴边时右侧补足：x1 = x0 + brushSize - 1（始终覆盖 brushSize 个像素）
  const halfLo = Math.floor((brushSize - 1) / 2); // 8 → 3
  const x0 = Math.max(0, cx - halfLo);
  const x1 = Math.min(w - 1, x0 + brushSize - 1);
  const y0 = Math.max(0, cy - halfLo);
  const y1 = Math.min(h - 1, y0 + brushSize - 1);
  const idxOf = (x: number, y: number) => y * w + x;

  // 取原图 target 色（HSL），透明像素返回 null
  const getTargetHsl = (x: number, y: number): { h: number; s: number; l: number } | null => {
    const gx = bbox.x + x;
    const gy = bbox.y + y;
    if (gx < 0 || gy < 0 || gx >= sourceWidth) return null;
    const pIdx = (gy * sourceWidth + gx) * 4;
    const alpha = paintBuffer.data[pIdx + 3];
    if (alpha < 128) return null;
    return rgbToHsl(
      paintBuffer.data[pIdx],
      paintBuffer.data[pIdx + 1],
      paintBuffer.data[pIdx + 2],
    );
  };

  // 合成色误差（当前 base + 当前残差 vs target），用于"是否已达标"
  const isAcceptable = (
    base: { h: number; s: number; l: number },
    dH: number, dS: number, dL: number,
    target: { h: number; s: number; l: number },
  ): boolean => {
    let finalH = base.h + dH;
    if (finalH < 0) finalH += 1.0;
    else if (finalH >= 1.0) finalH -= 1.0;
    const finalS = Math.max(0, Math.min(1, base.s + dS));
    const finalL = Math.max(0, Math.min(1, base.l + dL));
    return (
      hueDistance(finalH, target.h) <= FIX_HUE_THRESHOLD &&
      Math.abs(finalS - target.s) <= FIX_SAT_THRESHOLD &&
      Math.abs(finalL - target.l) <= FIX_LIGHT_THRESHOLD
    );
  };

  // 色距（用于复用相近 base）
  const colorDist = (
    a: { h: number; s: number; l: number },
    b: { h: number; s: number; l: number },
  ): number => hueDistance(a.h, b.h) + Math.abs(a.s - b.s) + Math.abs(a.l - b.l);

  // ============ 修正前误差统计（量化往返后，供调试对比） ============
  let totalErrBefore = 0, errCountBefore = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = idxOf(x, y);
      const cIdx = regionIdTex[idx];
      if (cIdx === 0) continue;
      const base = baseById.get(cIdx);
      const target = getTargetHsl(x, y);
      if (!base || !target) continue;
      const blockIdx = getAdaptiveBlockIndex(x, y, w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);
      const q = quantizeRoundTrip(tempDeltas[idx * 3], tempDeltas[idx * 3 + 1], tempDeltas[idx * 3 + 2], range);
      const eH = hueDistance(Math.max(0, Math.min(1, base.h + q.h)), target.h);
      const eS = Math.abs(Math.max(0, Math.min(1, base.s + q.s)) - target.s);
      const eL = Math.abs(Math.max(0, Math.min(1, base.l + q.l)) - target.l);
      totalErrBefore += eH + eS + eL;
      errCountBefore++;
    }
  }
  const avgErrorBefore = errCountBefore > 0 ? totalErrBefore / errCountBefore : 0;

  // ============ 核心：只保证范围内每个像素合成色达标 ============
  // 已达标 → 不动；未达标 → 新建 base(=target) + 残差 0（合成色=target，必然达标）
  // 可选：复用色距足够近的现有 base（残差 0 时合成色≈target，减少碎片化）
  let changedCount = 0;
  let remainingBadCount = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = idxOf(x, y);
      const colorIdx = regionIdTex[idx];
      if (colorIdx === 0) continue; // 空像素
      const target = getTargetHsl(x, y);
      if (!target) continue; // 透明

      const curBase = baseById.get(colorIdx);
      // 已达标 → 跳过
      if (curBase && isAcceptable(curBase, tempDeltas[idx * 3], tempDeltas[idx * 3 + 1], tempDeltas[idx * 3 + 2], target)) {
        continue;
      }

      // 未达标 → 修复：优先复用色距足够近的现有 base（残差 0，合成≈target）
      let reusedId = 0;
      let bestDist = Infinity;
      for (const c of baseColors) {
        const d = colorDist(c, target);
        if (d < bestDist) { bestDist = d; reusedId = c.id; }
      }
      // 复用条件：色距 + 残差0的量化偏移 ≤ 阈值
      //   残差 0 量化往返偏移 ≈ range/31（S/L），加上色距仍须达标
      if (reusedId !== 0 && reusedId !== colorIdx && bestDist <= FIX_SAT_THRESHOLD * 0.5) {
        regionIdTex[idx] = reusedId;
        tempDeltas[idx * 3] = 0;
        tempDeltas[idx * 3 + 1] = 0;
        tempDeltas[idx * 3 + 2] = 0;
        changedCount++;
        continue;
      }

      // 新建 base = target，残差 0（合成色 = target，必然达标）
      // ★ regionIdTex 已是 Uint16Array（上限 65535），编辑器内不再限制 255；
      //   255 限制移到导出阶段（导出格式为 8bit id+1，palette 超限会报错提示）
      const newId = maxBaseId + 1;
      maxBaseId = newId;
      const newBase = { id: newId, ...target };
      baseColors.push(newBase);
      baseById.set(newId, newBase);
      regionIdTex[idx] = newId;
      tempDeltas[idx * 3] = 0;
      tempDeltas[idx * 3 + 1] = 0;
      tempDeltas[idx * 3 + 2] = 0;
      changedCount++;
    }
  }

  // 统计：范围内像素修复后的误差（量化往返后，与真实渲染一致）
  let totalErrAfter = 0, errCountAfter = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = idxOf(x, y);
      const cIdx = regionIdTex[idx];
      if (cIdx === 0) continue;
      const base = baseById.get(cIdx);
      const target = getTargetHsl(x, y);
      if (!base || !target) continue;
      const blockIdx = getAdaptiveBlockIndex(x, y, w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);
      const q = quantizeRoundTrip(tempDeltas[idx * 3], tempDeltas[idx * 3 + 1], tempDeltas[idx * 3 + 2], range);
      const err = isAcceptable(base, q.h, q.s, q.l, target);
      if (!err) remainingBadCount++;
      const eH = hueDistance(Math.max(0, Math.min(1, base.h + q.h)), target.h);
      const eS = Math.abs(Math.max(0, Math.min(1, base.s + q.s)) - target.s);
      const eL = Math.abs(Math.max(0, Math.min(1, base.l + q.l)) - target.l);
      totalErrAfter += eH + eS + eL;
      errCountAfter++;
    }
  }
  const avgErrorAfter = errCountAfter > 0 ? totalErrAfter / errCountAfter : 0;

  // 重新打包残差（全部像素，用原始 blockFlags 的 range）
  const newDeltaPacked = new Uint16Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const cIdx = regionIdTex[i];
    if (cIdx === 0) { newDeltaPacked[i] = 0; continue; }
    const idx3 = i * 3;
    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);
    newDeltaPacked[i] = packRGB565(
      quantizeS(tempDeltas[idx3 + 1], range),
      quantizeH(tempDeltas[idx3], range),
      quantizeL(tempDeltas[idx3 + 2], range),
    );
  }

  return {
    regionIdTex,
    deltaPacked: newDeltaPacked,
    baseColors,
    blockFlags,
    changedCount,
    remainingBadCount,
    avgErrorBefore,
    avgErrorAfter,
  };
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

export { computeBBoxAllRings, rasterizeRegionMaskLocal };

// ==================== 多帧解码：从帧数据生成底图和残差纹理 ====================
/**
 * 将一帧的数据（regionIdTex + deltaPacked + 调色板）解码为全尺寸的基础色纹理和残差纹理
 */
export function decodeFrameToTextures(
  frame: FrameExportData,
  palette: SharedBaseColor[]
): { baseTexture: ImageData; residualTexture: ImageData } {
  const { bbox, regionIdTex, deltaPacked, blockFlags, width, height } = frame;
  const texWidth = width;
  const texHeight = height;
  const totalPixels = bbox.w * bbox.h;

  const baseImageData = new ImageData(texWidth, texHeight);
  const baseData = baseImageData.data;
  const resImageData = new ImageData(texWidth, texHeight);
  const resData = resImageData.data;

  if (totalPixels === 0 || deltaPacked.length === 0) {
    return { baseTexture: baseImageData, residualTexture: resImageData };
  }

  // 构建调色板映射
  const colorMap = new Map<number, { h: number; s: number; l: number }>();
  for (const c of palette) {
    colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });
  }

  for (let i = 0; i < totalPixels; i++) {
    const colorId = regionIdTex[i] || 0;
    if (colorId === 0) continue;
    const baseColor = colorMap.get(colorId);
    if (!baseColor) continue;

    const px = i % bbox.w;
    const py = Math.floor(i / bbox.w);
    const blockIdx = getAdaptiveBlockIndex(px, py, bbox.w, bbox.h);
    const range = getRangeForBlock(blockFlags, blockIdx);

    const packed = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    const dH = dequantizeH(qH, range);
    const dS = dequantizeS(qS, range);
    const dL = dequantizeL(qL, range);

    let finalH = baseColor.h + dH;
    finalH = ((finalH % 1) + 1) % 1;
    const finalS = Math.max(0, Math.min(1, baseColor.s + dS));
    const finalL = Math.max(0, Math.min(1, baseColor.l + dL));

    // 基础色（纯调色板颜色，不加残差）
    const baseRgb = hslToRgb(baseColor.h, baseColor.s, baseColor.l);
    // 叠加色（基础色+残差后的合成颜色）
    const compRgb = hslToRgb(finalH, finalS, finalL);

    const globalX = bbox.x + px;
    const globalY = bbox.y + py;
    const idx = (globalY * texWidth + globalX) * 4;

    // baseTexture = 纯基础色
    baseData[idx] = baseRgb.r;
    baseData[idx + 1] = baseRgb.g;
    baseData[idx + 2] = baseRgb.b;
    baseData[idx + 3] = 255;

    // residualTexture = 叠加色（基础色+残差）
    resData[idx] = compRgb.r;
    resData[idx + 1] = compRgb.g;
    resData[idx + 2] = compRgb.b;
    resData[idx + 3] = 255;
  }

  return { baseTexture: baseImageData, residualTexture: resImageData };
}

// ===== 辅助函数：用区域颜色列表解码帧（用于绑定操作）=====
export function decodeFrameWithRegionColors(
  regionIdTex: Uint16Array,
  deltaPacked: Uint16Array | null,
  regionColors: Array<{ h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  blockFlags: bigint,
  texSize: number = 512
): { baseTexture: ImageData; residualTexture: ImageData } {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const baseImageData = new ImageData(texSize, texSize);
  const baseData = baseImageData.data;
  const resImageData = new ImageData(texSize, texSize);
  const resData = resImageData.data;

  if (totalPixels === 0 || !deltaPacked || deltaPacked.length === 0) {
    return { baseTexture: baseImageData, residualTexture: resImageData };
  }

  // 从 regionColors 直接解码
  for (let i = 0; i < totalPixels; i++) {
    const colorIdx = regionIdTex[i] || 0;
    if (colorIdx === 0) continue;
    const baseColor = regionColors[colorIdx - 1];
    if (!baseColor) continue;

    const px = i % w;
    const py = Math.floor(i / w);
    const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);

    const packed = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    const dH = dequantizeH(qH, range);
    const dS = dequantizeS(qS, range);
    const dL = dequantizeL(qL, range);

    let finalH = baseColor.h + dH;
    finalH = ((finalH % 1) + 1) % 1;
    const finalS = Math.max(0, Math.min(1, baseColor.s + dS));
    const finalL = Math.max(0, Math.min(1, baseColor.l + dL));

    const rgb = hslToRgb(finalH, finalS, finalL);

    const globalX = bbox.x + px;
    const globalY = bbox.y + py;
    const idx = (globalY * texSize + globalX) * 4;
    baseData[idx] = rgb.r;
    baseData[idx + 1] = rgb.g;
    baseData[idx + 2] = rgb.b;
    baseData[idx + 3] = 255;

    const rRes = Math.round((qH / 63) * 255);
    const gRes = Math.round((qS / 31) * 255);
    const bRes = Math.round((qL / 31) * 255);
    resData[idx] = rRes;
    resData[idx + 1] = gRes;
    resData[idx + 2] = bRes;
    resData[idx + 3] = 255;
  }

  return { baseTexture: baseImageData, residualTexture: resImageData };
}

// ===== 新架构：用全局调色板解码帧数据（regionIdTex 已经是全局 ID）=====
/**
 * 使用全局调色板解码帧数据为全尺寸 ImageData（512x512）。
 * regionIdTex 中的值直接就是全局调色板 ID，无需再做映射。
 */
export function decodeFrameWithGlobalPalette(
  regionIdTex: Uint16Array,
  deltaPacked: Uint16Array,
  palette: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  blockFlags: bigint,
  textureSize: number = 512,
  textureSizeY?: number
): ImageData {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const texH = textureSizeY ?? textureSize;
  const imageData = new ImageData(textureSize, texH);
  const data = imageData.data;
  data.fill(0);

  const colorMap = new Map<number, { h: number; s: number; l: number }>();
  for (const c of palette) {
    colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });
  }

  for (let i = 0; i < totalPixels; i++) {
    const globalId = regionIdTex[i];
    if (globalId === 0) continue;
    const base = colorMap.get(globalId);
    if (!base) continue;

    const px = i % w;
    const py = Math.floor(i / w);
    const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);

    const packed = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    const dH = dequantizeH(qH, range);
    const dS = dequantizeS(qS, range);
    const dL = dequantizeL(qL, range);

    let finalH = base.h + dH;
    finalH = ((finalH % 1) + 1) % 1;
    const finalS = Math.max(0, Math.min(1, base.s + dS));
    const finalL = Math.max(0, Math.min(1, base.l + dL));

    const rgb = hslToRgb(finalH, finalS, finalL);

    const globalX = bbox.x + px;
    const globalY = bbox.y + py;
    const idx = (globalY * textureSize + globalX) * 4;
    data[idx] = rgb.r;
    data[idx + 1] = rgb.g;
    data[idx + 2] = rgb.b;
    data[idx + 3] = 255;
  }

  return imageData;
}

/**
 * 解码「残差纹理」（量化 delta），供 FluidSolver MCSDA/浓度平流使用。
 *
 * 与编辑器 buildFluidTexturesFromRawFrame 的残差编码完全一致：
 *   R = qH/63*255, G = qS/31*255, B = qL/31*255, A = 255
 * （FluidSolver.loadResidual / 合成着色器按同一约定反量化，固定 range 0.5）
 *
 * 主绘画页面绑定区域时也用本函数生成 boundResidualTexture，使浓度/速度
 * 平流作用于「真实残差」而非中性空场（否则注入永远不可见）。
 *
 * @param regionIdTex 区域 ID 纹理（全局 ID，0 = 未绘制）
 * @param deltaPacked 量化 delta（RGB565 打包）
 * @param palette     全局调色板（仅用于判断哪些像素已绘制）
 * @param bbox        帧数据 bbox（像素坐标，row 0 = 顶部）
 * @param textureSize 全帧纹理尺寸（sourceResolution）
 * @returns 全帧尺寸残差 ImageData（像素置于全局坐标，外部像素 0）
 */
export function decodeResidualFromFrame(
  regionIdTex: Uint16Array,
  deltaPacked: Uint16Array,
  palette: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  textureSize: number = 512,
  blockFlags: bigint = 0n,
): ImageData {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const imageData = new ImageData(textureSize, textureSize);
  const data = imageData.data;
  // ★ 全图填充中性残差（R=G=B=128, A=0）：区域外 = 中性（delta≈0）+ 透明。
  //   与主绘画页面 residTex/residBase 的约定统一：
  //   - 合成 alpha 用「残差非中性度」判定（区域外中性 → 不显示 → 纯透明背景）
  //   - 区域内量化残差覆盖 RGB，alpha=255
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 0;
  }

  if (!deltaPacked || deltaPacked.length === 0) return imageData;

  const colorMap = new Map<number, { h: number; s: number; l: number }>();
  for (const c of palette) colorMap.set(c.id, { h: c.h, s: c.s, l: c.l });

  for (let i = 0; i < totalPixels; i++) {
    const colorId = regionIdTex[i];
    if (colorId === 0) continue;
    if (!colorMap.has(colorId)) continue;

    const px = i % w;
    const py = Math.floor(i / w);
    const packed = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);

    const globalX = bbox.x + px;
    const globalY = bbox.y + py;
    const idx = (globalY * textureSize + globalX) * 4;
    data[idx] = Math.round((qH / 63) * 255);
    data[idx + 1] = Math.round((qS / 31) * 255);
    data[idx + 2] = Math.round((qL / 31) * 255);
    data[idx + 3] = 255;
  }

  // ★ 0.25 范围块 → 0.5 兼容格式（否则流体合成时 delta 放大 → 色相偏移）
  adjustResidualForUniformRange(imageData, bbox, blockFlags);

  return imageData;
}

/**
 * 残差量化范围预调整（0.25 范围块 → 0.5 兼容格式）。
 *
 * 基础色编辑器使用自适应量化：每个 8×8 块可能是 range=0.25 或 0.5。
 * 流体解算器统一使用 range=0.5 反量化公式：d = (val*2 - 1) * 0.5。
 * 对 range=0.25 的块：原始反量化 d = (val*2 - 1) * 0.25，
 * 调整后 val' = val*0.5 + 64，解算器反量化 d' = (val'*2-1)*0.5 ≈ d（量化误差范围内）。
 * 不加此转换 → 0.25 块残差被当作 0.5 范围反量化 → delta 放大 → 色相偏移。
 *
 * 与流体编辑器 FluidEditorUI.adjustResidualForUniformRange 逻辑一致。
 *
 * @param imageData 残差纹理（bbox 局部尺寸 或 全帧尺寸，内容在 bbox 内）
 * @param bbox      帧内容 bbox（像素）
 * @param blockFlags 分块范围标志（bigint，1=0.25，0=0.5）
 * @returns 原引用（就地修改）
 */
export function adjustResidualForUniformRange(
  imageData: ImageData,
  bbox: { x: number; y: number; w: number; h: number },
  blockFlags: bigint,
): ImageData {
  const { w, h } = bbox;
  if (w <= 0 || h <= 0) return imageData;
  const data = imageData.data;
  const texW = imageData.width;
  const texH = imageData.height;
  // 纹理 = bbox 尺寸（局部）还是全帧尺寸（内容偏移在 bbox.x/y）？
  const isLocal = texW === w && texH === h;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      if (getRangeForBlock(blockFlags, blockIdx) !== 0.25) continue;
      const sx = isLocal ? px : bbox.x + px;
      const sy = isLocal ? py : bbox.y + py;
      if (sx < 0 || sx >= texW || sy < 0 || sy >= texH) continue;
      const idx = (sy * texW + sx) * 4;
      data[idx] = Math.round(data[idx] * 0.5 + 64);       // R (H)
      data[idx + 1] = Math.round(data[idx + 1] * 0.5 + 64); // G (S)
      data[idx + 2] = Math.round(data[idx + 2] * 0.5 + 64); // B (L)
    }
  }
  return imageData;
}

/**
 * 根据多边形掩码裁剪纹理，外部像素置为透明。
 * polygon 使用世界坐标 [0,1]，与 region 边界一致。
 */
export function cropTextureByPolygon(
  imageData: ImageData,
  polygon: Point[][],
  textureSize: number = 512
): ImageData {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  const data = result.data;

  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const worldX = x / textureSize;
      const worldY = 1 - y / textureSize;  // canvas Y → 世界坐标 Y（向上）
      const inside = isPointInPolygonWithHoles({ x: worldX, y: worldY }, polygon);
      if (!inside) {
        const idx = (y * textureSize + x) * 4;
        data[idx + 3] = 0;
      }
    }
  }
  return result;
}

// ==================== 主压缩函数 ====================
export interface CompressLayerColorsInput {
  frame: {
    regionIdTex: Uint16Array;
    bbox: { x: number; y: number; w: number; h: number } | null;
    deltaPacked?: Uint16Array;
    blockFlags?: bigint;
  } | null;
  palette: Array<{ id: number; h: number; s: number; l: number }>;
}

export function compressLayerColors(input: CompressLayerColorsInput): CompressionResultV2 | null {
  const { frame, palette } = input;

  // 优先从 skillGroupEditor.frames 获取当前帧数据（含修正结果）
  if (!frame || !frame.regionIdTex || frame.regionIdTex.length === 0) {
    console.warn('[颜色压缩] 当前帧没有有效数据');
    return null;
  }

  // 获取全局调色板（已按面积排序）
  if (palette.length === 0) {
    console.warn('[颜色压缩] 调色板为空');
    return null;
  }

  // ★ 导出限制：单区域 base64 格式为 8bit id（0 保留，id+1 编码 → 上限 254），
  //   超出时明确报错，绝不静默截断（截断会导致纹理变灰/花）
  const exportMaxId = 254;
  if (palette.length > exportMaxId) {
    console.warn(`[颜色压缩] 导出失败：调色板有 ${palette.length} 种颜色，超过 8bit 格式上限 ${exportMaxId}，请先合并/清理颜色`);
    return null;
  }

  // 构建 region 数据：将全局颜色 ID 映射为本地索引（1-based）
  const idToIndex = new Map<number, number>();
  palette.forEach((c, idx) => idToIndex.set(c.id, idx + 1));

  const localRegionIdTex = new Uint16Array(frame.regionIdTex.length);
  for (let i = 0; i < frame.regionIdTex.length; i++) {
    const globalId = frame.regionIdTex[i];
    localRegionIdTex[i] = globalId === 0 ? 0 : (idToIndex.get(globalId) || 0);
  }

  // 构建 baseColors（按本地索引顺序）
  const baseColors = palette.map(c => ({ h: c.h, s: c.s, l: c.l }));

  const bbox = frame.bbox;
  if (!bbox) {
    console.warn('[颜色压缩] 帧缺少 bbox');
    return null;
  }
  const { w, h } = bbox;
  if (w === 0 || h === 0) {
    console.warn('[颜色压缩] 帧 bbox 无效');
    return null;
  }

  const deltaPacked = frame.deltaPacked || new Uint16Array(0);
  const blockFlags = frame.blockFlags ?? 0n;

  // 将 deltaPacked 解包为 H/S/L 三通道字节序列
  const totalPixels = w * h;
  const hChannel = new Uint8Array(totalPixels);
  const sChannel = new Uint8Array(totalPixels);
  const lChannel = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const packed = i < deltaPacked.length ? deltaPacked[i] : 0;
    const { s, h: qH, l: qL } = unpackRGB565(packed);
    hChannel[i] = qH;
    sChannel[i] = s;
    lChannel[i] = qL;
  }
  const deltaBytes = new Uint8Array(totalPixels * 3);
  deltaBytes.set(hChannel, 0);
  deltaBytes.set(sChannel, totalPixels);
  deltaBytes.set(lChannel, totalPixels * 2);

  const region: CompressedRegionV2 = {
    id: 0, // 单区域
    bbox,
    baseColors,
    // 导出限制后本地索引 ≤ palette.length ≤ 254，安全转 8bit
    regionIdTexture: uint8ToBase64(new Uint8Array(localRegionIdTex)),
    deltaTexture: uint8ToBase64(deltaBytes),
    blockFlags,
  };

  return {
    version: 3,
    resolution: [512, 512],
    regionCount: 1,
    regions: [region],
    quantization: 'rgb565',
    hueThreshold: 0.025,
  };
}