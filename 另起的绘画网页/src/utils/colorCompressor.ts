import { useAppStore } from '../stores/useAppStore';
import { computeRegionsExact } from './regionDetectionExact';
import type { Point } from '../types';

// ==================== 颜色空间转换 ====================
export function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rL = srgbToLinear(r);
  const gL = srgbToLinear(g);
  const bL = srgbToLinear(b);
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
    r: Math.round(linearToSrgb(r) * 255), 
    g: Math.round(linearToSrgb(g) * 255), 
    b: Math.round(linearToSrgb(b) * 255) 
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

// ============ K-means + 连通分量 聚类算法 ============

function samplePixels(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number
): { pixelColors: Float32Array; pixelIndices: Uint32Array; count: number } {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const totalPixels = w * h;
  let count = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (mask[i] === 1) count++;
  }
  if (count === 0) {
    return { pixelColors: new Float32Array(0), pixelIndices: new Uint32Array(0), count: 0 };
  }

  const pixelColors = new Float32Array(count * 3);
  const pixelIndices = new Uint32Array(count);
  let idx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const localIdx = y * w + x;
      if (mask[localIdx] === 1) {
        const globalX = offsetX + x;
        const globalY = offsetY + y;
        const pixelIdx = (globalY * sourceWidth + globalX) * 4;
        pixelColors[idx * 3] = paintBuffer.data[pixelIdx];
        pixelColors[idx * 3 + 1] = paintBuffer.data[pixelIdx + 1];
        pixelColors[idx * 3 + 2] = paintBuffer.data[pixelIdx + 2];
        pixelIndices[idx] = localIdx;
        idx++;
      }
    }
  }
  return { pixelColors, pixelIndices, count };
}

function kmeansPlusPlusInit(
  pixels: Float32Array,
  k: number,
  seed: number
): Float32Array[] {
  const n = pixels.length / 3;
  const centroids: Float32Array[] = [];
  let rng = seed;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };

  const firstIdx = Math.floor(rand() * n);
  centroids.push(new Float32Array([pixels[firstIdx * 3], pixels[firstIdx * 3 + 1], pixels[firstIdx * 3 + 2]]));

  const dists = new Float32Array(n);
  for (let iter = 1; iter < k; iter++) {
    let sumDist = 0;
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const c of centroids) {
        const dx = pixels[i * 3] - c[0];
        const dy = pixels[i * 3 + 1] - c[1];
        const dz = pixels[i * 3 + 2] - c[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDist) minDist = d;
      }
      dists[i] = minDist;
      sumDist += minDist;
    }
    let target = rand() * sumDist;
    let chosen = -1;
    for (let i = 0; i < n; i++) {
      target -= dists[i];
      if (target <= 0) { chosen = i; break; }
    }
    if (chosen === -1) chosen = n - 1;
    centroids.push(new Float32Array([pixels[chosen * 3], pixels[chosen * 3 + 1], pixels[chosen * 3 + 2]]));
  }
  return centroids;
}

function kmeans(
  pixels: Float32Array,
  k: number,
  maxIter: number = 20,
  seed: number = 42
): { centroids: Float32Array[]; labels: Uint8Array } {
  const n = pixels.length / 3;
  if (n === 0 || k === 0) {
    return { centroids: [], labels: new Uint8Array(0) };
  }
  if (k > n) k = n;

  let centroids = kmeansPlusPlusInit(pixels, k, seed);
  const labels = new Uint8Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let bestLabel = 0;
      for (let c = 0; c < centroids.length; c++) {
        const dx = pixels[i * 3] - centroids[c][0];
        const dy = pixels[i * 3 + 1] - centroids[c][1];
        const dz = pixels[i * 3 + 2] - centroids[c][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDist) {
          minDist = d;
          bestLabel = c;
        }
      }
      if (labels[i] !== bestLabel) {
        labels[i] = bestLabel;
        changed = true;
      }
    }
    if (!changed) break;

    const counts = new Uint32Array(centroids.length);
    const sums = centroids.map(() => new Float32Array(3));
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c]++;
      sums[c][0] += pixels[i * 3];
      sums[c][1] += pixels[i * 3 + 1];
      sums[c][2] += pixels[i * 3 + 2];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) {
        centroids[c][0] = sums[c][0] / counts[c];
        centroids[c][1] = sums[c][1] / counts[c];
        centroids[c][2] = sums[c][2] / counts[c];
      }
    }
  }
  return { centroids, labels };
}

function mergeCentroids(
  centroids: Float32Array[],
  labels: Uint8Array,
  mergeThreshold: number = 5.0
): { centroids: Float32Array[]; labels: Uint8Array } {
  if (centroids.length <= 1) return { centroids, labels };

  const counts = new Uint32Array(centroids.length);
  for (let i = 0; i < labels.length; i++) {
    counts[labels[i]]++;
  }

  let merged = true;
  let currentCentroids = centroids.map(c => new Float32Array(c));
  let currentLabels = new Uint8Array(labels);

  while (merged) {
    merged = false;
    const k = currentCentroids.length;
    if (k <= 1) break;

    let minDist = Infinity;
    let mergeA = -1, mergeB = -1;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const dx = currentCentroids[i][0] - currentCentroids[j][0];
        const dy = currentCentroids[i][1] - currentCentroids[j][1];
        const dz = currentCentroids[i][2] - currentCentroids[j][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDist) {
          minDist = d;
          mergeA = i;
          mergeB = j;
        }
      }
    }

    if (minDist < mergeThreshold * mergeThreshold) {
      merged = true;
      const newCentroids: Float32Array[] = [];
      const total = counts[mergeA] + counts[mergeB];
      const mergedCentroid = new Float32Array(3);
      for (let d = 0; d < 3; d++) {
        mergedCentroid[d] = (currentCentroids[mergeA][d] * counts[mergeA] + currentCentroids[mergeB][d] * counts[mergeB]) / total;
      }

      const newCounts: number[] = [];
      const mapOldToNew = new Map<number, number>();
      let newIdx = 0;
      for (let i = 0; i < k; i++) {
        if (i === mergeA || i === mergeB) {
          if (i === mergeA) {
            newCentroids.push(mergedCentroid);
            newCounts.push(total);
            mapOldToNew.set(mergeA, newIdx);
            mapOldToNew.set(mergeB, newIdx);
            newIdx++;
          }
        } else {
          newCentroids.push(currentCentroids[i]);
          newCounts.push(counts[i]);
          mapOldToNew.set(i, newIdx);
          newIdx++;
        }
      }

      const newLabels = new Uint8Array(currentLabels.length);
      for (let i = 0; i < currentLabels.length; i++) {
        newLabels[i] = mapOldToNew.get(currentLabels[i])!;
      }
      currentCentroids = newCentroids;
      currentLabels = newLabels;
      counts.set(new Uint32Array(newCounts));
    } else {
      break;
    }
  }
  return { centroids: currentCentroids, labels: currentLabels };
}

function extractConnectedComponents(
  labelMask: Uint8Array,
  w: number,
  h: number,
  targetLabel: number
): { componentPixels: Uint32Array[] } {
  const visited = new Uint8Array(w * h);
  const components: Uint32Array[] = [];
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labelMask[idx] === targetLabel && visited[idx] === 0) {
        const queue: number[] = [idx];
        visited[idx] = 1;
        const pixels: number[] = [];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          pixels.push(cur);
          const cy = Math.floor(cur / w);
          const cx = cur % w;
          for (const [dy, dx] of dirs) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              const nIdx = ny * w + nx;
              if (labelMask[nIdx] === targetLabel && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
        if (pixels.length > 0) {
          components.push(new Uint32Array(pixels));
        }
      }
    }
  }
  return { componentPixels: components };
}

function clusterByColorAndSpace(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  sourceWidth: number = 512,
  maxColors: number = 256
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint8Array } {
  const { w, h } = bbox;
  const totalPixels = w * h;

  const { pixelColors, pixelIndices, count } = samplePixels(mask, bbox, paintBuffer, sourceWidth);
  if (count === 0) {
    return { baseColors: [], regionIdTex: new Uint8Array(totalPixels) };
  }

  const kInit = Math.min(20, count);
  let { centroids, labels } = kmeans(pixelColors, kInit, 20, 42);

  const mergeResult = mergeCentroids(centroids, labels, 5.0);
  centroids = mergeResult.centroids;
  labels = mergeResult.labels;
  const finalK = centroids.length;

  const fullLabel = new Uint8Array(totalPixels);
  for (let i = 0; i < count; i++) {
    fullLabel[pixelIndices[i]] = labels[i];
  }

  interface Component {
    pixels: Uint32Array;
    avgR: number;
    avgG: number;
    avgB: number;
  }
  const components: Component[] = [];

  for (let c = 0; c < finalK; c++) {
    const { componentPixels } = extractConnectedComponents(fullLabel, w, h, c);
    for (const pixels of componentPixels) {
      if (pixels.length === 0) continue;
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < pixels.length; i++) {
        const idx = pixels[i];
        const globalX = bbox.x + (idx % w);
        const globalY = bbox.y + Math.floor(idx / w);
        const pIdx = (globalY * sourceWidth + globalX) * 4;
        sumR += paintBuffer.data[pIdx];
        sumG += paintBuffer.data[pIdx + 1];
        sumB += paintBuffer.data[pIdx + 2];
      }
      components.push({
        pixels,
        avgR: sumR / pixels.length,
        avgG: sumG / pixels.length,
        avgB: sumB / pixels.length
      });
    }
  }

  components.sort((a, b) => b.pixels.length - a.pixels.length);

  const finalColors: Array<{ h: number; s: number; l: number }> = [];
  const componentToColorIdx = new Map<number, number>();

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const hsl = rgbToHsl(comp.avgR, comp.avgG, comp.avgB);
    let matched = false;
    for (let j = 0; j < finalColors.length; j++) {
      const fc = finalColors[j];
      const dh = Math.min(Math.abs(hsl.h - fc.h), 1 - Math.abs(hsl.h - fc.h));
      const ds = Math.abs(hsl.s - fc.s);
      const dl = Math.abs(hsl.l - fc.l);
      if (dh < 0.02 && ds < 0.05 && dl < 0.05) {
        componentToColorIdx.set(i, j);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const newIdx = finalColors.length;
      finalColors.push(hsl);
      componentToColorIdx.set(i, newIdx);
    }
  }

  const regionIdTex = new Uint8Array(totalPixels);
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const colorIdx = componentToColorIdx.get(i)! + 1;
    for (let j = 0; j < comp.pixels.length; j++) {
      regionIdTex[comp.pixels[j]] = colorIdx;
    }
  }

  if (finalColors.length > maxColors) {
    const kept = finalColors.slice(0, maxColors);
    const validSet = new Set<number>();
    for (let i = 1; i <= kept.length; i++) validSet.add(i);
    for (let i = 0; i < totalPixels; i++) {
      if (!validSet.has(regionIdTex[i])) {
        regionIdTex[i] = 0;
      }
    }
    return { baseColors: kept, regionIdTex };
  }

  return { baseColors: finalColors, regionIdTex };
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

function hueDistance(h1: number, h2: number): number {
  let d = h2 - h1;
  if (d > 0.5) d -= 1.0;
  else if (d < -0.5) d += 1.0;
  return Math.abs(d);
}

function areColorsSimilar(
  a: { h: number; s: number; l: number },
  b: { h: number; s: number; l: number },
  hThresh: number,
  sThresh: number,
  lThresh: number
): boolean {
  let dh = Math.abs(a.h - b.h);
  if (dh > 0.5) dh = 1 - dh;
  return dh < hThresh && Math.abs(a.s - b.s) < sThresh && Math.abs(a.l - b.l) < lThresh;
}

function mergeBaseColors(
  baseColors: Array<{ h: number; s: number; l: number }>,
  clusterSizes: number[],
  hueThreshold: number = 0.01,
  satThreshold: number = 0.05,
  lightThreshold: number = 0.05
): {
  mergedColors: Array<{ h: number; s: number; l: number }>;
  oldToNewMap: Uint8Array;
} {
  const sortedIndices = baseColors.map((_, i) => i).sort((a, b) => clusterSizes[b] - clusterSizes[a]);
  const merged: Array<{ h: number; s: number; l: number }> = [];
  const map = new Uint8Array(baseColors.length + 1);

  for (const idx of sortedIndices) {
    let assigned = false;
    for (let m = 0; m < merged.length; m++) {
      const rep = merged[m];
      if (areColorsSimilar(baseColors[idx], rep, hueThreshold, satThreshold, lightThreshold)) {
        map[idx + 1] = m + 1;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      map[idx + 1] = merged.length + 1;
      merged.push({ ...baseColors[idx] });
    }
  }

  return { mergedColors: merged, oldToNewMap: map };
}

function clusterAndGenerateTexturesV2(
  mask: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  paintBuffer: ImageData,
  hueThreshold: number = 0.025,
  sourceWidth: number = PAINT_BUFFER_SIZE
): { baseColors: Array<{ h: number; s: number; l: number }>; regionIdTex: Uint8Array | null; deltaTex: Uint8Array } {
  const { w, h } = bbox;
  const totalPixels = w * h;

  const { baseColors, regionIdTex } = clusterByColorAndSpace(mask, bbox, paintBuffer, sourceWidth);

  if (baseColors.length === 0 || totalPixels === 0) {
    return { baseColors: [], regionIdTex: null, deltaTex: new Uint8Array(0) };
  }

  const deltaTex = new Uint8Array(totalPixels * 3);

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
    deltaTex[idx3] = quantizeH(dH);
    deltaTex[idx3 + 1] = quantizeS(dS);
    deltaTex[idx3 + 2] = quantizeL(dL);
  }

  return {
    baseColors,
    regionIdTex: regionIdTex.length > 0 ? regionIdTex : null,
    deltaTex
  };
}

// 导出辅助函数供外部使用（bakeRegionLayerTexture）
// FTX 2.0 量化（直接返回 0~63 / 0~31）
export function quantizeH(dH: number): number {
  return Math.round((dH + 0.5) * 63);
}

export function quantizeS(dS: number): number {
  return Math.round((dS + 1.0) * 15.5);
}

export function quantizeL(dL: number): number {
  return Math.round((dL + 1.0) * 15.5);
}

// FTX 2.0 反量化（从 0~63 / 0~31 还原物理值）
export function dequantizeH(encoded: number): number {
  return encoded / 63 - 0.5;
}

export function dequantizeS(encoded: number): number {
  return encoded / 15.5 - 1.0;
}

export function dequantizeL(encoded: number): number {
  return encoded / 15.5 - 1.0;
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
  const regions = computeRegionsExact(dashShapes, worldBounds, 1000);
  if (regions.length === 0) { console.warn('[颜色压缩] 没有检测到闭合区域'); return null; }

  const buffer = state.paintBuffers[layerId];
  if (!buffer) { console.warn('[颜色压缩] 当前图层没有 paintBuffer'); return null; }

  const compressedRegions: CompressedRegionV2[] = [];
  const hueThreshold = 0.025;

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
