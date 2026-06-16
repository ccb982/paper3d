import { useAppStore } from '../stores/useAppStore';
import { computeRegionsExact } from './regionDetectionExact';
import type { Point } from '../types';

// ==================== 颜色空间转换 ====================
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

// ==================== 主压缩函数 ====================
export function compressLayerColors(layerId: string): any {
  const state = useAppStore.getState();

  // 1. 获取虚线 shapes
  const dashShapes = state.shapes.filter(s => s.color === '#ffaa00' && s.layerId === layerId);
  if (dashShapes.length === 0) {
    console.warn('[颜色压缩] 没有虚线图形');
    return null;
  }

  // 2. 计算闭合区域
  const worldBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const regions = computeRegionsExact(dashShapes, worldBounds, 600);
  if (regions.length === 0) {
    console.warn('[颜色压缩] 没有检测到闭合区域');
    return null;
  }

  // 3. 获取 paintBuffer
  const buffer = state.paintBuffers[layerId];
  if (!buffer) {
    console.warn('[颜色压缩] 当前图层没有 paintBuffer');
    return null;
  }

  const canvasWidth = state.canvasWidth;
  const canvasHeight = state.canvasHeight;

  // 4. 对每个区域提取像素并聚类
  const regionResults: Array<{
    regionIndex: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    clusters: Array<{ pixelCount: number; avgHsl: { h: number; s: number; l: number } }>;
  }> = [];

  const globalPalette: Array<{ h: number; s: number; l: number }> = [];

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    // 生成掩码
    const mask = rasterizeRegionMask(region, canvasWidth, canvasHeight);

    // 计算包围盒（基于掩码）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const idx = y * canvasWidth + x;
        if (mask[idx]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // 扩展1像素抗锯齿
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(canvasWidth - 1, maxX + 1);
    maxY = Math.min(canvasHeight - 1, maxY + 1);

    // BFS 聚类
    const clusters = bfsHueClustering(mask, canvasWidth, canvasHeight, buffer, 0.05);

    // 收集聚类信息
    const clusterInfos = clusters.map(cluster => ({
      pixelCount: cluster.pixels.length,
      avgHsl: cluster.avgHsl,
    }));
    clusterInfos.forEach(info => globalPalette.push(info.avgHsl));

    regionResults.push({
      regionIndex: ri,
      bbox: { minX, minY, maxX, maxY },
      clusters: clusterInfos,
    });
  }

  // 5. 返回压缩数据（供后续生成纹理和导出JSON）
  const result = {
    version: 2,
    resolution: [canvasWidth, canvasHeight] as [number, number],
    regionCount: regions.length,
    palette: globalPalette,
    regions: regionResults,
  };

  console.log('[颜色压缩] 压缩完成，全局调色板大小:', globalPalette.length);
  console.log('[颜色压缩] 区域详情:', regionResults.map(r => ({
    region: r.regionIndex,
    bbox: r.bbox,
    clusterCount: r.clusters.length,
    avgHsls: r.clusters.map(c => c.avgHsl),
  })));

  return result;
}
