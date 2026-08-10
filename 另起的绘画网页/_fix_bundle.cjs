"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/colorCompressor.ts
var colorCompressor_exports = {};
__export(colorCompressor_exports, {
  ADAPTIVE_BLOCK_COLS: () => ADAPTIVE_BLOCK_COLS,
  ADAPTIVE_BLOCK_ROWS: () => ADAPTIVE_BLOCK_ROWS,
  ADAPTIVE_TOTAL_BLOCKS: () => ADAPTIVE_TOTAL_BLOCKS,
  bakeBaseColorFTX2: () => bakeBaseColorFTX2,
  bfsHueClustering: () => bfsHueClustering,
  clusterAndGenerateTexturesV2: () => clusterAndGenerateTexturesV2,
  compressLayerColors: () => compressLayerColors,
  computeBBoxAllRings: () => computeBBoxAllRings,
  cropTextureByPolygon: () => cropTextureByPolygon,
  decodeFTX2: () => decodeFTX2,
  decodeFrameToTextures: () => decodeFrameToTextures,
  decodeFrameWithGlobalPalette: () => decodeFrameWithGlobalPalette,
  decodeFrameWithRegionColors: () => decodeFrameWithRegionColors,
  decodeResidualFromFrame: () => decodeResidualFromFrame,
  dequantizeFTX2: () => dequantizeFTX2,
  dequantizeH: () => dequantizeH,
  dequantizeL: () => dequantizeL,
  dequantizeS: () => dequantizeS,
  forcedFixBrush: () => forcedFixBrush,
  getAdaptiveBlockIndex: () => getAdaptiveBlockIndex,
  getRangeForBlock: () => getRangeForBlock,
  hslToRgb: () => hslToRgb,
  linearToSrgb: () => linearToSrgb,
  quantizeH: () => quantizeH,
  quantizeL: () => quantizeL,
  quantizeS: () => quantizeS,
  rasterizeRegionMask: () => rasterizeRegionMask,
  rasterizeRegionMaskLocal: () => rasterizeRegionMaskLocal,
  rgbToHsl: () => rgbToHsl,
  srgbToLinear: () => srgbToLinear
});
module.exports = __toCommonJS(colorCompressor_exports);

// src/utils/regionDetection.ts
function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}
function isPointInPolygon(point, polygon, tolerance = 1e-9) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  if (!inside && polygon.length >= 3) {
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if (pointToSegmentDistance(point, a, b) < tolerance) return true;
    }
  }
  return inside;
}
function isPointInPolygonWithHoles(point, rings, tolerance = 1e-9) {
  if (rings.length === 0) return false;
  const outer = rings[0];
  if (!isPointInPolygon(point, outer, tolerance)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (isPointInPolygon(point, rings[i], tolerance)) return false;
  }
  return true;
}

// src/core/ftxCore.ts
var ADAPTIVE_BLOCK_COLS = 8;
var ADAPTIVE_BLOCK_ROWS = 8;
var ADAPTIVE_TOTAL_BLOCKS = ADAPTIVE_BLOCK_COLS * ADAPTIVE_BLOCK_ROWS;
function quantizeH(dH, range = 0.5) {
  const clamped = Math.max(-range, Math.min(range, dH));
  return Math.round((clamped + range) / (2 * range) * 63);
}
function quantizeS(dS, range = 0.5) {
  const clamped = Math.max(-range, Math.min(range, dS));
  return Math.round((clamped + range) / (2 * range) * 31);
}
function quantizeL(dL, range = 0.5) {
  const clamped = Math.max(-range, Math.min(range, dL));
  return Math.round((clamped + range) / (2 * range) * 31);
}
function dequantizeH(encoded, range = 0.5) {
  return encoded / 63 * 2 * range - range;
}
function dequantizeS(encoded, range = 0.5) {
  return encoded / 31 * 2 * range - range;
}
function dequantizeL(encoded, range = 0.5) {
  return encoded / 31 * 2 * range - range;
}
function packRGB565(s, h, l) {
  return (s & 31) << 11 | (h & 63) << 5 | l & 31;
}
function unpackRGB565(packed) {
  return {
    s: packed >> 11 & 31,
    h: packed >> 5 & 63,
    l: packed & 31
  };
}
function getAdaptiveBlockIndex(x, y, w, h) {
  const col = Math.min(Math.floor(x / w * ADAPTIVE_BLOCK_COLS), ADAPTIVE_BLOCK_COLS - 1);
  const row = Math.min(Math.floor(y / h * ADAPTIVE_BLOCK_ROWS), ADAPTIVE_BLOCK_ROWS - 1);
  return row * ADAPTIVE_BLOCK_COLS + col;
}
function getRangeForBlock(blockFlags, blockIdx) {
  return blockFlags & 1n << BigInt(blockIdx) ? 0.25 : 0.5;
}
function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// src/utils/colorCompressor.ts
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToHsl(r, g, b) {
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
function linearToSrgb(c) {
  c = Math.max(0, Math.min(1, c));
  return c <= 31308e-7 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p2, q2, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
      if (t < 1 / 2) return q2;
      if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
      return p2;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}
function rasterizeRegionMask(region, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "white";
  for (const ring of region) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pts = ring.map((p) => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
  }
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1;
  for (const ring of region) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    const pts = ring.map((p) => ({ x: p.x * width, y: (1 - p.y) * height }));
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
    if (r > 200 && g > 200 && b > 200) mask[i / 4] = 1;
  }
  return mask;
}
function bfsHueClustering(mask, width, height, buffer, hueThreshold = 0.025) {
  const visited = new Uint8Array(width * height);
  const clusters = [];
  const getIndex = (x, y) => y * width + x;
  const getColor = (idx) => {
    const i = idx * 4;
    return { r: buffer.data[i], g: buffer.data[i + 1], b: buffer.data[i + 2] };
  };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      if (mask[idx] === 0 || visited[idx]) continue;
      const seedColor = getColor(idx);
      const seedHsl = rgbToHsl(seedColor.r, seedColor.g, seedColor.b);
      const queue = [[x, y]];
      visited[idx] = 1;
      const clusterPixels = [];
      let sumR = 0, sumG = 0, sumB = 0;
      while (queue.length) {
        const [cx, cy] = queue.shift();
        const ci = getIndex(cx, cy);
        clusterPixels.push(ci);
        const col = getColor(ci);
        sumR += col.r;
        sumG += col.g;
        sumB += col.b;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = getIndex(nx, ny);
          if (mask[ni] === 0 || visited[ni]) continue;
          const neighborCol = getColor(ni);
          const neighborHsl = rgbToHsl(neighborCol.r, neighborCol.g, neighborCol.b);
          let dh = neighborHsl.h - seedHsl.h;
          if (dh > 0.5) dh -= 1;
          else if (dh < -0.5) dh += 1;
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
function clusterByColorAndSpace(mask, bbox, paintBuffer, sourceWidth = 512, maxColors = 256) {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const sampled = samplePixelsWithCoords(mask, bbox, paintBuffer, sourceWidth);
  if (sampled.count === 0) {
    return { baseColors: [], regionIdTex: new Uint8Array(totalPixels) };
  }
  const { rgb, coords, count } = sampled;
  const hsl = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const { h: h2, s, l } = rgbToHsl(r, g, b);
    hsl[i * 3] = h2;
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
    const sortedIndices = Array.from({ length: baseColors.length }, (_, i) => i).sort((a, b) => colorCounts[b] - colorCounts[a]).slice(0, maxColors);
    const keepSet = new Set(sortedIndices);
    const newColors = [];
    const oldToNew = /* @__PURE__ */ new Map();
    for (let i = 0; i < sortedIndices.length; i++) {
      const oldIdx = sortedIndices[i];
      oldToNew.set(oldIdx, i);
      newColors.push(baseColors[oldIdx]);
    }
    const newRegionId = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const oldId = rawRegionId[i] - 1;
      if (keepSet.has(oldId)) {
        newRegionId[i] = oldToNew.get(oldId) + 1;
      } else {
        let minDist = Infinity;
        let bestNew = 0;
        const h2 = hsl[i * 3];
        const s = hsl[i * 3 + 1];
        const l = hsl[i * 3 + 2];
        for (const [, newIdx] of oldToNew) {
          const c = newColors[newIdx];
          const dh = deltaHue(h2, c.h);
          const ds = Math.abs(s - c.s);
          const dl = Math.abs(l - c.l);
          const dist = dh * 1 + ds * 0.5 + dl * 0.5;
          if (dist < minDist) {
            minDist = dist;
            bestNew = newIdx;
          }
        }
        newRegionId[i] = bestNew + 1;
      }
    }
    baseColors = newColors;
    rawRegionId = newRegionId;
  }
  const regionIdTex = new Uint8Array(totalPixels);
  for (let i = 0; i < count; i++) {
    const pixelIdx = sampled.pixelIndices[i];
    regionIdTex[pixelIdx] = rawRegionId[i];
  }
  return { baseColors, regionIdTex };
}
function samplePixelsWithCoords(mask, bbox, paintBuffer, sourceWidth) {
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
function hardRadiusClustering(hsl, coords, count) {
  const RADIUS = 0.25;
  const MIN_PIXELS = Math.max(10, count * 5e-3);
  const MAX_ITER = 5;
  const order = Array.from({ length: count }, (_, i) => i);
  const clusters = [];
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
        const dist = dh * 1 + ds * 0.5 + dl * 0.5;
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
        bboxCenterY: y
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
    const newClusters = [];
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
          const dist = dh * 1 + ds * 0.5 + dl * 0.5;
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
          bboxCenterY: y
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
    const nonEmpty = clusters.filter((c) => c.pixels.length > 0);
    clusters.length = 0;
    clusters.push(...nonEmpty);
    if (newClusters.length === 0 && iter > 0) break;
  }
  const largeClusters = [];
  const smallClusters = [];
  for (const cl of clusters) {
    if (cl.pixels.length >= MIN_PIXELS) {
      largeClusters.push(cl);
    } else {
      smallClusters.push(cl);
    }
  }
  for (const small of smallClusters) {
    let nearestLarge = null;
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
  const baseColors = finalClusters.map((c) => ({
    h: c.centerH,
    s: c.centerS,
    l: c.centerL
  }));
  const regionIdTex = new Uint8Array(count);
  for (let cIdx = 0; cIdx < finalClusters.length; cIdx++) {
    for (const idx of finalClusters[cIdx].pixels) {
      regionIdTex[idx] = cIdx + 1;
    }
  }
  return { baseColors, regionIdTex };
}
function deltaHue(a, b) {
  let d = a - b;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return Math.abs(d);
}
var PAINT_BUFFER_SIZE = 512;
function computeBBoxAllRings(region) {
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
function projectPolygonToBBox(region, bbox) {
  return region.map(
    (ring) => ring.map((p) => ({
      x: p.x * PAINT_BUFFER_SIZE - bbox.x,
      y: (1 - p.y) * PAINT_BUFFER_SIZE - bbox.y
    }))
  );
}
function rasterizeRegionMaskLocal(region, bbox) {
  const { w, h } = bbox;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  const localRings = projectPolygonToBBox(region, bbox);
  ctx.fillStyle = "white";
  for (const ring of localRings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
  }
  ctx.strokeStyle = "white";
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
    if (imageData.data[i] > 200 && imageData.data[i + 1] > 200 && imageData.data[i + 2] > 200) mask[i / 4] = 1;
  }
  return mask;
}
function normalizeHueDelta(delta) {
  if (delta > 0.5) return delta - 1;
  if (delta < -0.5) return delta + 1;
  return delta;
}
function clusterAndGenerateTexturesV2(mask, bbox, paintBuffer, sourceWidth = PAINT_BUFFER_SIZE) {
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
    const globalX = bbox.x + i % w;
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
        blockFlags |= 1n << BigInt(b);
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
var FIX_HUE_THRESHOLD = 0.02;
var FIX_SAT_THRESHOLD = 0.02;
var FIX_LIGHT_THRESHOLD = 0.02;
function hueDistance(h1, h2) {
  let d = Math.abs(h1 - h2);
  if (d > 0.5) d = 1 - d;
  return d;
}
function quantizeRoundTrip(dH, dS, dL, range) {
  return {
    h: dequantizeH(quantizeH(dH, range), range),
    s: dequantizeS(quantizeS(dS, range), range),
    l: dequantizeL(quantizeL(dL, range), range)
  };
}
function forcedFixBrush(regionIdTex, baseColors, deltaPacked, blockFlags, bbox, paintBuffer, sourceWidth, cx, cy, brushSize = 8) {
  const { w, h } = bbox;
  if (w <= 0 || h <= 0) {
    return { regionIdTex, deltaPacked, baseColors, blockFlags, changedCount: 0, remainingBadCount: 0, avgErrorBefore: 0, avgErrorAfter: 0 };
  }
  const totalPixels = w * h;
  const baseById = /* @__PURE__ */ new Map();
  let maxBaseId = 0;
  for (const c of baseColors) {
    baseById.set(c.id, c);
    if (c.id > maxBaseId) maxBaseId = c.id;
  }
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
  const halfLo = Math.floor((brushSize - 1) / 2);
  const x0 = Math.max(0, cx - halfLo);
  const x1 = Math.min(w - 1, x0 + brushSize - 1);
  const y0 = Math.max(0, cy - halfLo);
  const y1 = Math.min(h - 1, y0 + brushSize - 1);
  const idxOf = (x, y) => y * w + x;
  const getTargetHsl = (x, y) => {
    const gx = bbox.x + x;
    const gy = bbox.y + y;
    if (gx < 0 || gy < 0 || gx >= sourceWidth) return null;
    const pIdx = (gy * sourceWidth + gx) * 4;
    const alpha = paintBuffer.data[pIdx + 3];
    if (alpha < 128) return null;
    return rgbToHsl(
      paintBuffer.data[pIdx],
      paintBuffer.data[pIdx + 1],
      paintBuffer.data[pIdx + 2]
    );
  };
  const isAcceptable = (base, dH, dS, dL, target) => {
    let finalH = base.h + dH;
    if (finalH < 0) finalH += 1;
    else if (finalH >= 1) finalH -= 1;
    const finalS = Math.max(0, Math.min(1, base.s + dS));
    const finalL = Math.max(0, Math.min(1, base.l + dL));
    return hueDistance(finalH, target.h) <= FIX_HUE_THRESHOLD && Math.abs(finalS - target.s) <= FIX_SAT_THRESHOLD && Math.abs(finalL - target.l) <= FIX_LIGHT_THRESHOLD;
  };
  const colorDist = (a, b) => hueDistance(a.h, b.h) + Math.abs(a.s - b.s) + Math.abs(a.l - b.l);
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
  let changedCount = 0;
  let remainingBadCount = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = idxOf(x, y);
      const colorIdx = regionIdTex[idx];
      if (colorIdx === 0) continue;
      const target = getTargetHsl(x, y);
      if (!target) continue;
      const curBase = baseById.get(colorIdx);
      if (curBase && isAcceptable(curBase, tempDeltas[idx * 3], tempDeltas[idx * 3 + 1], tempDeltas[idx * 3 + 2], target)) {
        continue;
      }
      let reusedId = 0;
      let bestDist = Infinity;
      for (const c of baseColors) {
        const d = colorDist(c, target);
        if (d < bestDist) {
          bestDist = d;
          reusedId = c.id;
        }
      }
      if (reusedId !== 0 && reusedId !== colorIdx && bestDist <= FIX_SAT_THRESHOLD * 0.5) {
        regionIdTex[idx] = reusedId;
        tempDeltas[idx * 3] = 0;
        tempDeltas[idx * 3 + 1] = 0;
        tempDeltas[idx * 3 + 2] = 0;
        changedCount++;
        continue;
      }
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
  const newDeltaPacked = new Uint16Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const cIdx = regionIdTex[i];
    if (cIdx === 0) {
      newDeltaPacked[i] = 0;
      continue;
    }
    const idx3 = i * 3;
    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);
    newDeltaPacked[i] = packRGB565(
      quantizeS(tempDeltas[idx3 + 1], range),
      quantizeH(tempDeltas[idx3], range),
      quantizeL(tempDeltas[idx3 + 2], range)
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
    avgErrorAfter
  };
}
function dequantizeFTX2(encodedH, encodedS, encodedL) {
  const quantH = encodedH / 255 * 63;
  const quantS = encodedS / 255 * 31;
  const quantL = encodedL / 255 * 31;
  return {
    dH: quantH / 63 - 0.5,
    // -0.5 ~ +0.5
    dS: quantS / 31 - 1,
    // -1.0 ~ +1.0
    dL: quantL / 31 - 1
    // -1.0 ~ +1.0
  };
}
function bakeBaseColorFTX2(base) {
  return {
    h: base.h - 0.5,
    s: base.s - 1,
    l: base.l - 1
  };
}
function decodeFTX2(baseShifted, encodedH, encodedS, encodedL) {
  const finalH = fract(baseShifted.h + encodedH / 255);
  const finalS = clamp(baseShifted.s + encodedS / 127.5 - 1, 0, 1);
  const finalL = clamp(baseShifted.l + encodedL / 127.5 - 1, 0, 1);
  return { h: finalH, s: finalS, l: finalL };
}
function fract(x) {
  return x - Math.floor(x);
}
function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}
function decodeFrameToTextures(frame, palette) {
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
  const colorMap = /* @__PURE__ */ new Map();
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
    finalH = (finalH % 1 + 1) % 1;
    const finalS = Math.max(0, Math.min(1, baseColor.s + dS));
    const finalL = Math.max(0, Math.min(1, baseColor.l + dL));
    const baseRgb = hslToRgb(baseColor.h, baseColor.s, baseColor.l);
    const compRgb = hslToRgb(finalH, finalS, finalL);
    const globalX = bbox.x + px;
    const globalY = bbox.y + py;
    const idx = (globalY * texWidth + globalX) * 4;
    baseData[idx] = baseRgb.r;
    baseData[idx + 1] = baseRgb.g;
    baseData[idx + 2] = baseRgb.b;
    baseData[idx + 3] = 255;
    resData[idx] = compRgb.r;
    resData[idx + 1] = compRgb.g;
    resData[idx + 2] = compRgb.b;
    resData[idx + 3] = 255;
  }
  return { baseTexture: baseImageData, residualTexture: resImageData };
}
function decodeFrameWithRegionColors(regionIdTex, deltaPacked, regionColors, bbox, blockFlags, texSize = 512) {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const baseImageData = new ImageData(texSize, texSize);
  const baseData = baseImageData.data;
  const resImageData = new ImageData(texSize, texSize);
  const resData = resImageData.data;
  if (totalPixels === 0 || !deltaPacked || deltaPacked.length === 0) {
    return { baseTexture: baseImageData, residualTexture: resImageData };
  }
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
    finalH = (finalH % 1 + 1) % 1;
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
    const rRes = Math.round(qH / 63 * 255);
    const gRes = Math.round(qS / 31 * 255);
    const bRes = Math.round(qL / 31 * 255);
    resData[idx] = rRes;
    resData[idx + 1] = gRes;
    resData[idx + 2] = bRes;
    resData[idx + 3] = 255;
  }
  return { baseTexture: baseImageData, residualTexture: resImageData };
}
function decodeFrameWithGlobalPalette(regionIdTex, deltaPacked, palette, bbox, blockFlags, textureSize = 512) {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const imageData = new ImageData(textureSize, textureSize);
  const data = imageData.data;
  data.fill(0);
  const colorMap = /* @__PURE__ */ new Map();
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
    finalH = (finalH % 1 + 1) % 1;
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
function decodeResidualFromFrame(regionIdTex, deltaPacked, palette, bbox, textureSize = 512) {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const imageData = new ImageData(textureSize, textureSize);
  const data = imageData.data;
  data.fill(0);
  if (!deltaPacked || deltaPacked.length === 0) return imageData;
  const colorMap = /* @__PURE__ */ new Map();
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
    data[idx] = Math.round(qH / 63 * 255);
    data[idx + 1] = Math.round(qS / 31 * 255);
    data[idx + 2] = Math.round(qL / 31 * 255);
    data[idx + 3] = 255;
  }
  return imageData;
}
function cropTextureByPolygon(imageData, polygon, textureSize = 512) {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  const data = result.data;
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const worldX = x / textureSize;
      const worldY = 1 - y / textureSize;
      const inside = isPointInPolygonWithHoles({ x: worldX, y: worldY }, polygon);
      if (!inside) {
        const idx = (y * textureSize + x) * 4;
        data[idx + 3] = 0;
      }
    }
  }
  return result;
}
function compressLayerColors(input) {
  const { frame, palette } = input;
  if (!frame || !frame.regionIdTex || frame.regionIdTex.length === 0) {
    console.warn("[\u989C\u8272\u538B\u7F29] \u5F53\u524D\u5E27\u6CA1\u6709\u6709\u6548\u6570\u636E");
    return null;
  }
  if (palette.length === 0) {
    console.warn("[\u989C\u8272\u538B\u7F29] \u8C03\u8272\u677F\u4E3A\u7A7A");
    return null;
  }
  const idToIndex = /* @__PURE__ */ new Map();
  palette.forEach((c, idx) => idToIndex.set(c.id, idx + 1));
  const localRegionIdTex = new Uint8Array(frame.regionIdTex.length);
  for (let i = 0; i < frame.regionIdTex.length; i++) {
    const globalId = frame.regionIdTex[i];
    localRegionIdTex[i] = globalId === 0 ? 0 : idToIndex.get(globalId) || 0;
  }
  const baseColors = palette.map((c) => ({ h: c.h, s: c.s, l: c.l }));
  const bbox = frame.bbox;
  if (!bbox) {
    console.warn("[\u989C\u8272\u538B\u7F29] \u5E27\u7F3A\u5C11 bbox");
    return null;
  }
  const { w, h } = bbox;
  if (w === 0 || h === 0) {
    console.warn("[\u989C\u8272\u538B\u7F29] \u5E27 bbox \u65E0\u6548");
    return null;
  }
  const deltaPacked = frame.deltaPacked || new Uint16Array(0);
  const blockFlags = frame.blockFlags ?? 0n;
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
  const region = {
    id: 0,
    // 单区域
    bbox,
    baseColors,
    regionIdTexture: uint8ToBase64(localRegionIdTex),
    deltaTexture: uint8ToBase64(deltaBytes),
    blockFlags
  };
  return {
    version: 3,
    resolution: [512, 512],
    regionCount: 1,
    regions: [region],
    quantization: "rgb565",
    hueThreshold: 0.025
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ADAPTIVE_BLOCK_COLS,
  ADAPTIVE_BLOCK_ROWS,
  ADAPTIVE_TOTAL_BLOCKS,
  bakeBaseColorFTX2,
  bfsHueClustering,
  clusterAndGenerateTexturesV2,
  compressLayerColors,
  computeBBoxAllRings,
  cropTextureByPolygon,
  decodeFTX2,
  decodeFrameToTextures,
  decodeFrameWithGlobalPalette,
  decodeFrameWithRegionColors,
  decodeResidualFromFrame,
  dequantizeFTX2,
  dequantizeH,
  dequantizeL,
  dequantizeS,
  forcedFixBrush,
  getAdaptiveBlockIndex,
  getRangeForBlock,
  hslToRgb,
  linearToSrgb,
  quantizeH,
  quantizeL,
  quantizeS,
  rasterizeRegionMask,
  rasterizeRegionMaskLocal,
  rgbToHsl,
  srgbToLinear
});
