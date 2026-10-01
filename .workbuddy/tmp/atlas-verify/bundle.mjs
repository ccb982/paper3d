// entry.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ../../../另起的绘画网页/src/core/ftxCore.ts
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
function packRGB565(s, h, l) {
  return (s & 31) << 11 | (h & 63) << 5 | l & 31;
}
function unpackRGB565(packed2) {
  return {
    s: packed2 >> 11 & 31,
    h: packed2 >> 5 & 63,
    l: packed2 & 31
  };
}
function getAdaptiveBlockIndex(x, y, w, h) {
  const col = Math.min(Math.floor(x / w * ADAPTIVE_BLOCK_COLS), ADAPTIVE_BLOCK_COLS - 1);
  const row = Math.min(Math.floor(y / h * ADAPTIVE_BLOCK_ROWS), ADAPTIVE_BLOCK_ROWS - 1);
  return row * ADAPTIVE_BLOCK_COLS + col;
}
function applyDelta8(data, stride) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (i % stride === 0) out[i] = data[i];
    else out[i] = data[i] - data[i - 1];
  }
  return out;
}

// ../../../另起的绘画网页/src/utils/colorCompressor.ts
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

// ../../../另起的绘画网页/src/utils/multiFrameExport.ts
function packMultiFrameToBinary(palette, frames, enablePrediction = true) {
  const exportMaxId = 254;
  let maxPaletteId = 0;
  for (const c of palette) {
    if (c.id > maxPaletteId) maxPaletteId = c.id;
  }
  if (palette.length > exportMaxId || maxPaletteId > exportMaxId) {
    throw new Error(
      `[\u591A\u5E27\u5BFC\u51FA] \u8C03\u8272\u677F ${palette.length} \u79CD\u989C\u8272 / \u6700\u5927 id ${maxPaletteId}\uFF0C\u8D85\u8FC7 8bit \u683C\u5F0F\u4E0A\u9650 ${exportMaxId}\u3002\u8BF7\u5148\u4F7F\u7528"\u91CD\u65B0\u805A\u7C7B/\u5408\u5E76\u9ED1\u8272"\u6E05\u7406\u989C\u8272\u540E\u518D\u5BFC\u51FA\uFF08\u5BFC\u51FA\u683C\u5F0F\u4EC5\u652F\u6301 254 \u8272\uFF09\u3002`
    );
  }
  const headerSize = 4 + 1 + 1 + 2 + 2;
  let totalSize = headerSize;
  totalSize += palette.length * 12;
  console.log("========================================");
  console.log("[\u591A\u5E27\u5BFC\u51FA] \u5F00\u59CB\u6253\u5305\uFF0C\u5171", frames.length, "\u5E27\uFF0C\u9884\u6D4B:", enablePrediction ? "\u542F\u7528" : "\u7981\u7528");
  console.log("========================================");
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    console.log(`[\u591A\u5E27\u5BFC\u51FA] \u5E27 ${i} "${frame.name}" blockFlags = 0x${frame.blockFlags.toString(16).padStart(16, "0")}`);
    logBlockFlagsDetail(frame.blockFlags, frame.bbox);
  }
  const frameChunks = [];
  let prevRegionIdTex = null;
  let prevBboxW = 0, prevBboxH = 0;
  for (const frame of frames) {
    const { bbox, regionIdTex, deltaPacked, blockFlags, name, width, height } = frame;
    const nameBytes = new TextEncoder().encode(name);
    const totalPixels = bbox.w * bbox.h;
    const processedRegion = new Uint8Array(totalPixels);
    const canPredict = enablePrediction && prevRegionIdTex !== null && prevBboxW === bbox.w && prevBboxH === bbox.h;
    if (canPredict) {
      for (let i = 0; i < totalPixels; i++) {
        const id = regionIdTex[i];
        const prevId = prevRegionIdTex[i];
        if (id === prevId) {
          processedRegion[i] = 1;
        } else {
          processedRegion[i] = id === 0 ? 0 : id + 1;
        }
      }
    } else {
      for (let i = 0; i < totalPixels; i++) {
        const id = regionIdTex[i];
        processedRegion[i] = id === 0 ? 0 : id + 1;
      }
    }
    const regionDiff = applyDelta8(processedRegion, bbox.w);
    const hChannel = new Uint8Array(totalPixels);
    const sChannel = new Uint8Array(totalPixels);
    const lChannel = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const packed2 = deltaPacked[i];
      const { s, h, l } = unpackRGB565(packed2);
      hChannel[i] = h;
      sChannel[i] = s;
      lChannel[i] = l;
    }
    const hDiff = applyDelta8(hChannel, bbox.w);
    const sDiff = applyDelta8(sChannel, bbox.w);
    const lDiff = applyDelta8(lChannel, bbox.w);
    const deltaDiffBytes = new Uint8Array(hDiff.length + sDiff.length + lDiff.length);
    deltaDiffBytes.set(hDiff, 0);
    deltaDiffBytes.set(sDiff, hDiff.length);
    deltaDiffBytes.set(lDiff, hDiff.length + sDiff.length);
    let frameSize = 1 + nameBytes.length;
    frameSize += 2 + 2 + 2 + 2 + 2 + 2;
    frameSize += 8;
    frameSize += 4 + regionDiff.length;
    frameSize += 4 + deltaDiffBytes.length;
    const frameBuf = new ArrayBuffer(frameSize);
    const view = new DataView(frameBuf);
    let offset2 = 0;
    view.setUint8(offset2, nameBytes.length);
    offset2 += 1;
    new Uint8Array(frameBuf, offset2, nameBytes.length).set(nameBytes);
    offset2 += nameBytes.length;
    view.setUint16(offset2, width, true);
    offset2 += 2;
    view.setUint16(offset2, height, true);
    offset2 += 2;
    view.setUint16(offset2, bbox.x, true);
    offset2 += 2;
    view.setUint16(offset2, bbox.y, true);
    offset2 += 2;
    view.setUint16(offset2, bbox.w, true);
    offset2 += 2;
    view.setUint16(offset2, bbox.h, true);
    offset2 += 2;
    view.setBigUint64(offset2, blockFlags, true);
    offset2 += 8;
    view.setUint32(offset2, regionDiff.length, true);
    offset2 += 4;
    new Uint8Array(frameBuf, offset2, regionDiff.length).set(regionDiff);
    offset2 += regionDiff.length;
    view.setUint32(offset2, deltaDiffBytes.length, true);
    offset2 += 4;
    new Uint8Array(frameBuf, offset2, deltaDiffBytes.length).set(deltaDiffBytes);
    offset2 += deltaDiffBytes.length;
    frameChunks.push(new Uint8Array(frameBuf));
    totalSize += frameSize;
    prevRegionIdTex = regionIdTex;
    prevBboxW = bbox.w;
    prevBboxH = bbox.h;
  }
  const finalBuffer = new Uint8Array(totalSize);
  let offset = 0;
  new DataView(finalBuffer.buffer).setUint32(offset, 1179932723, false);
  offset += 4;
  finalBuffer[offset++] = 3;
  finalBuffer[offset++] = enablePrediction ? 1 : 0;
  new DataView(finalBuffer.buffer).setUint16(offset, frames.length, true);
  offset += 2;
  new DataView(finalBuffer.buffer).setUint16(offset, palette.length, true);
  offset += 2;
  for (const color of palette) {
    new DataView(finalBuffer.buffer).setFloat32(offset, color.h, true);
    offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.s, true);
    offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.l, true);
    offset += 4;
  }
  for (const chunk of frameChunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }
  console.log("========================================");
  console.log("[\u591A\u5E27\u5BFC\u51FA] \u6253\u5305\u5B8C\u6210\uFF0C\u5F00\u59CB\u9A8C\u8BC1\u5BFC\u51FA\u6570\u636E");
  console.log("========================================");
  verifyPackedBlockFlags(finalBuffer, frames);
  return finalBuffer;
}
function logBlockFlagsDetail(blockFlags, bbox) {
  const ADAPTIVE_BLOCK_COLS3 = 8;
  const ADAPTIVE_BLOCK_ROWS3 = 8;
  const ADAPTIVE_TOTAL_BLOCKS2 = ADAPTIVE_BLOCK_COLS3 * ADAPTIVE_BLOCK_ROWS3;
  let detailStr = "[blockFlags \u8BE6\u7EC6\u4FE1\u606F]\n";
  detailStr += `  BBox: x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}
`;
  detailStr += `  \u5206\u5757\u7F51\u683C: ${ADAPTIVE_BLOCK_COLS3}x${ADAPTIVE_BLOCK_ROWS3} = ${ADAPTIVE_TOTAL_BLOCKS2} \u5757
`;
  detailStr += "  \u6BCF\u5757\u91CF\u5316\u8303\u56F4:\n";
  let smallRangeCount = 0;
  let largeRangeCount = 0;
  for (let row = 0; row < ADAPTIVE_BLOCK_ROWS3; row++) {
    let line = "    ";
    for (let col = 0; col < ADAPTIVE_BLOCK_COLS3; col++) {
      const blockIdx = row * ADAPTIVE_BLOCK_COLS3 + col;
      const hasSmallRange = (blockFlags & 1n << BigInt(blockIdx)) !== 0n;
      if (hasSmallRange) {
        line += "\u25CF";
        smallRangeCount++;
      } else {
        line += "\u25CB";
        largeRangeCount++;
      }
    }
    detailStr += line + "\n";
  }
  detailStr += `  \u7EDF\u8BA1: \u5C0F\u8303\u56F4(0.25) = ${smallRangeCount} \u5757, \u5927\u8303\u56F4(0.5) = ${largeRangeCount} \u5757
`;
  detailStr += `  \u4E8C\u8FDB\u5236: 0b${blockFlags.toString(2).padStart(64, "0").slice(-64)}`;
  console.log(detailStr);
}
function verifyPackedBlockFlags(buffer, originalFrames) {
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.getUint32(offset, false);
  offset += 4;
  view.getUint8(offset);
  offset += 1;
  view.getUint8(offset);
  offset += 1;
  const frameCount = view.getUint16(offset, true);
  offset += 2;
  const paletteCount = view.getUint16(offset, true);
  offset += 2;
  offset += paletteCount * 12;
  let allMatch = true;
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset);
    offset += 1;
    offset += nameLen;
    offset += 2;
    offset += 2;
    offset += 2;
    offset += 2;
    offset += 2;
    offset += 2;
    const packedBlockFlags = view.getBigUint64(offset, true);
    offset += 8;
    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    offset += regionIdTexLen;
    const deltaPackedLen = view.getUint32(offset, true);
    offset += 4;
    offset += deltaPackedLen;
    const original = originalFrames[f];
    const match = packedBlockFlags === original.blockFlags;
    console.log(`[\u9A8C\u8BC1] \u5E27 ${f} "${original.name}":`);
    console.log(`       \u539F\u59CB blockFlags = 0x${original.blockFlags.toString(16).padStart(16, "0")}`);
    console.log(`       \u6253\u5305\u540E blockFlags = 0x${packedBlockFlags.toString(16).padStart(16, "0")}`);
    console.log(`       \u5339\u914D: ${match ? "\u2705 \u4E00\u81F4" : "\u274C \u4E0D\u4E00\u81F4"}`);
    if (!match) {
      allMatch = false;
      console.error(`[\u9519\u8BEF] \u5E27 ${f} \u7684 blockFlags \u4E0D\u4E00\u81F4\uFF01`);
    }
  }
  console.log("========================================");
  console.log(allMatch ? "[\u9A8C\u8BC1\u7ED3\u679C] \u2705 \u6240\u6709\u5E27\u7684 blockFlags \u9A8C\u8BC1\u901A\u8FC7\uFF01" : "[\u9A8C\u8BC1\u7ED3\u679C] \u274C \u5B58\u5728 blockFlags \u4E0D\u4E00\u81F4\u7684\u5E27\uFF01");
  console.log("========================================");
}

// ../../../另起的绘画网页/src/utils/atlasPacker.ts
var DEFAULTS = {
  targetHeight: 0,
  paletteSize: 128,
  alphaThreshold: 128,
  tightCrop: true,
  enablePrediction: false
};
function contentBBox(img, alphaThreshold) {
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
function areaResample(img, dw, dh) {
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
      out[idx + 3] = wsum > 0 ? a / wsum * 255 : 0;
    }
  }
  return { data: out, width: dw, height: dh };
}
function cropTo(img, bbox) {
  const { data, width } = img;
  const out = new Uint8ClampedArray(bbox.w * bbox.h * 4);
  for (let y = 0; y < bbox.h; y++) {
    const src = ((bbox.y + y) * width + bbox.x) * 4;
    out.set(data.subarray(src, src + bbox.w * 4), y * bbox.w * 4);
  }
  return { data: out, width: bbox.w, height: bbox.h };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function deltaHue(h, base) {
  let d = h - base;
  d -= Math.round(d);
  return d;
}
function buildPalette(samples, k, seed = 2654435769) {
  const n = samples.length;
  if (n === 0) return [{ h: 0, s: 0, l: 0 }];
  k = Math.max(1, Math.min(k, n));
  const rnd = mulberry32(seed);
  const dist2 = (a, b) => {
    const dh = deltaHue(a.h, b.h);
    const ds = a.s - b.s;
    const dl = a.l - b.l;
    return dh * dh + ds * ds * 0.25 + dl * dl * 0.25;
  };
  const centers = [samples[Math.floor(rnd() * n)]];
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
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.push(samples[pick]);
  }
  const acc = new Float64Array(k * 5);
  for (let iter = 0; iter < 12; iter++) {
    acc.fill(0);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(s, centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
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
var LUT_H = 64;
var LUT_S = 16;
var LUT_L = 16;
function buildAssignmentLut(palette) {
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
          if (d < bd) {
            bd = d;
            bi = c;
          }
        }
        lut[(hi * LUT_S + si) * LUT_L + li] = bi;
      }
    }
  }
  return lut;
}
function prepare(src, opt) {
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
function packAtlas(sources2, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  if (sources2.length === 0) throw new Error("[\u56FE\u96C6\u6253\u5305] \u6CA1\u6709\u8F93\u5165\u5E27");
  if (opt.paletteSize > 254) throw new Error("[\u56FE\u96C6\u6253\u5305] paletteSize \u4E0A\u9650 254\uFF08FTX3 \u5355\u5E27 8bit regionId\uFF09");
  const prepared = sources2.map((s) => prepare(s, opt));
  const MAX_SAMPLES = 3e4;
  const totalOpaque = prepared.reduce((acc, p) => acc + p.image.width * p.image.height, 0);
  const stride = Math.max(1, Math.floor(totalOpaque / MAX_SAMPLES));
  const samples = [];
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
  const frames = [];
  const info = [];
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
      if (blockMax[b] > 0 && blockMax[b] <= 0.25) {
        blockNarrow[b] = 1;
        narrow++;
      }
    }
    const blockFlags = blockNarrow.reduce(
      (acc, bit, b) => bit ? acc | 1n << BigInt(b) : acc,
      0n
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
        quantizeL(deltaL[i], range)
      );
    }
    frames.push({
      name: p.name,
      width: w,
      height: h,
      bbox: { x: 0, y: 0, w, h },
      regionIdTex,
      deltaPacked,
      blockFlags
    });
    info.push({
      name: p.name,
      sourceWidth: p.sourceWidth,
      sourceHeight: p.sourceHeight,
      width: w,
      height: h,
      opaqueRatio: opaqueCount / total,
      narrowBlockRatio: narrow / blockMax.length,
      maxDelta
    });
  }
  const paletteColors = palette.map((c, i) => ({
    id: i + 1,
    h: c.h,
    s: c.s,
    l: c.l,
    // packMultiFrameToBinary 只用到 id/h/s/l；这两个字段是编辑器调色板的元信息
    frameIds: [],
    area: 0
  }));
  const binary = packMultiFrameToBinary(paletteColors, frames, opt.enablePrediction);
  return {
    binary,
    palette,
    frames,
    info,
    clippedRatio: opaqueTotal > 0 ? clipped / (opaqueTotal * 3) : 0
  };
}

// ../../../全新的游戏/src/vendor/player/core/ftx.ts
function invertDelta8(filtered, stride) {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    if (i % stride === 0) out[i] = filtered[i];
    else out[i] = filtered[i] + out[i - 1];
  }
  return out;
}
function unpackRGB5652(packed2) {
  return { s: packed2 >> 11 & 31, h: packed2 >> 5 & 63, l: packed2 & 31 };
}
function decodeMultiFrame(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const magic = view.getUint32(offset, false);
  offset += 4;
  if (magic !== 1179932723) throw new Error("\u65E0\u6548\u7684 FTX3 \u683C\u5F0F (Magic \u4E0D\u5339\u914D)");
  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 3) throw new Error(`\u4E0D\u652F\u6301\u7684 FTX \u7248\u672C: ${version}`);
  const predictionFlag = view.getUint8(offset);
  offset += 1;
  const enablePrediction = predictionFlag === 1;
  const frameCount = view.getUint16(offset, true);
  offset += 2;
  const paletteCount = view.getUint16(offset, true);
  offset += 2;
  const palette = [];
  for (let i = 0; i < paletteCount; i++) {
    palette.push({
      h: view.getFloat32(offset, true),
      s: view.getFloat32(offset + 4, true),
      l: view.getFloat32(offset + 8, true)
    });
    offset += 12;
  }
  const frames = [];
  let prevDecodedRegion = null;
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset);
    offset += 1;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const name = new TextDecoder().decode(nameBytes);
    offset += nameLen;
    const width = view.getUint16(offset, true);
    offset += 2;
    const height = view.getUint16(offset, true);
    offset += 2;
    const bboxX = view.getUint16(offset, true);
    offset += 2;
    const bboxY = view.getUint16(offset, true);
    offset += 2;
    const bboxW = view.getUint16(offset, true);
    offset += 2;
    const bboxH = view.getUint16(offset, true);
    offset += 2;
    const bbox = { x: bboxX, y: bboxY, w: bboxW, h: bboxH };
    const blockFlags = view.getBigUint64(offset, true);
    offset += 8;
    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    let regionIdTex;
    if (regionIdTexLen > 0) {
      const regionDiff = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      const processedRegion = invertDelta8(regionDiff, bbox.w);
      if (!enablePrediction) {
        regionIdTex = new Uint8Array(processedRegion.length);
        for (let i = 0; i < processedRegion.length; i++) {
          const val = processedRegion[i];
          regionIdTex[i] = val === 0 ? 0 : val - 1;
        }
      } else {
        if (prevDecodedRegion === null) {
          regionIdTex = new Uint8Array(processedRegion.length);
          for (let i = 0; i < processedRegion.length; i++) {
            const val = processedRegion[i];
            regionIdTex[i] = val === 0 ? 0 : val - 1;
          }
        } else {
          regionIdTex = new Uint8Array(processedRegion.length);
          for (let i = 0; i < processedRegion.length; i++) {
            const val = processedRegion[i];
            if (val === 1) {
              regionIdTex[i] = prevDecodedRegion[i];
            } else {
              regionIdTex[i] = val === 0 ? 0 : val - 1;
            }
          }
        }
        prevDecodedRegion = regionIdTex;
      }
    } else {
      regionIdTex = new Uint8Array(0);
    }
    const deltaPackedLen = view.getUint32(offset, true);
    offset += 4;
    let deltaPacked;
    if (deltaPackedLen > 0) {
      const deltaBytes = new Uint8Array(buffer, offset, deltaPackedLen);
      offset += deltaPackedLen;
      const totalPixels = bbox.w * bbox.h;
      const hDiff = deltaBytes.slice(0, totalPixels);
      const sDiff = deltaBytes.slice(totalPixels, totalPixels * 2);
      const lDiff = deltaBytes.slice(totalPixels * 2, totalPixels * 3);
      const hChannel = invertDelta8(hDiff, bbox.w);
      const sChannel = invertDelta8(sDiff, bbox.w);
      const lChannel = invertDelta8(lDiff, bbox.w);
      deltaPacked = new Uint16Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        deltaPacked[i] = (sChannel[i] & 31) << 11 | (hChannel[i] & 63) << 5 | lChannel[i] & 31;
      }
    } else {
      deltaPacked = new Uint16Array(0);
    }
    frames.push({ name, width, height, bbox, regionIdTex, deltaPacked, blockFlags });
  }
  return { palette, frames };
}
function buildBaseHslData(frame, palette) {
  const { bbox, regionIdTex } = frame;
  const w = bbox.w;
  const h = bbox.h;
  if (w === 0 || h === 0) return null;
  const totalPixels = w * h;
  const data = new Float32Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const idx4 = i * 4;
    const colorId = regionIdTex.length > 0 ? regionIdTex[i] : 0;
    if (colorId === 0) {
      data[idx4 + 3] = 0;
    } else {
      const paletteIdx = colorId - 1;
      const base = paletteIdx < palette.length ? palette[paletteIdx] : { h: 0, s: 0, l: 0 };
      data[idx4] = base.h;
      data[idx4 + 1] = base.s;
      data[idx4 + 2] = base.l;
      data[idx4 + 3] = 1;
    }
  }
  return { data, width: w, height: h };
}
function buildResidualData(frame) {
  const { bbox, deltaPacked, blockFlags } = frame;
  const w = bbox.w;
  const h = bbox.h;
  if (w === 0 || h === 0) return null;
  const totalPixels = w * h;
  const data = new Uint8Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 0;
  }
  if (deltaPacked.length === 0) {
    return { data, width: w, height: h };
  }
  for (let i = 0; i < totalPixels; i++) {
    const idx4 = i * 4;
    const colorId = frame.regionIdTex.length > 0 ? frame.regionIdTex[i] : 0;
    if (colorId === 0) continue;
    const packed2 = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB5652(packed2);
    const blockIdx = getAdaptiveBlockIndex2(i % w, Math.floor(i / w), w, h);
    const isSmall = (blockFlags & 1n << BigInt(blockIdx)) !== 0n;
    let r8 = Math.round(qH / 63 * 255);
    let g8 = Math.round(qS / 31 * 255);
    let b8 = Math.round(qL / 31 * 255);
    if (isSmall) {
      r8 = Math.round(r8 * 0.5 + 64);
      g8 = Math.round(g8 * 0.5 + 64);
      b8 = Math.round(b8 * 0.5 + 64);
    }
    data[idx4] = r8;
    data[idx4 + 1] = g8;
    data[idx4 + 2] = b8;
    data[idx4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
var ADAPTIVE_BLOCK_COLS2 = 8;
var ADAPTIVE_BLOCK_ROWS2 = 8;
function getAdaptiveBlockIndex2(x, y, w, h) {
  const col = Math.min(Math.floor(x / w * ADAPTIVE_BLOCK_COLS2), ADAPTIVE_BLOCK_COLS2 - 1);
  const row = Math.min(Math.floor(y / h * ADAPTIVE_BLOCK_ROWS2), ADAPTIVE_BLOCK_ROWS2 - 1);
  return row * ADAPTIVE_BLOCK_COLS2 + col;
}

// entry.ts
import { mkdirSync, existsSync } from "node:fs";
var ROOT = process.argv[2];
var OUT_GZ = process.argv[3];
var TARGET_H = Number(process.argv[4] ?? 256);
var PALETTE = Number(process.argv[5] ?? 128);
var realLog = console.log;
console.log = () => {
};
console.error = () => {
};
var manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
var sources = manifest.map((m) => {
  const buf = readFileSync(join(ROOT, "raw", m.file));
  return {
    name: m.name,
    image: { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), width: m.width, height: m.height }
  };
});
var t0 = Date.now();
var packed = packAtlas(sources, {
  targetHeight: TARGET_H,
  paletteSize: PALETTE,
  tightCrop: true,
  enablePrediction: false
});
var tPack = Date.now() - t0;
console.log = realLog;
console.error = (...a) => process.stderr.write(a.join(" ") + "\n");
var gzBlob = await new Blob([packed.binary]).stream().pipeThrough(new CompressionStream("gzip"));
var gzBytes = new Uint8Array(await new Response(gzBlob).arrayBuffer());
writeFileSync(OUT_GZ, gzBytes);
var raw = gzBytes[0] === 31 && gzBytes[1] === 139 ? new Uint8Array(await new Response(new Blob([gzBytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()) : gzBytes;
var decoded = decodeMultiFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
function hsl2rgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
console.log(`\u5E27\u6570=${decoded.frames.length}  \u8C03\u8272\u677F=${decoded.palette.length}  \u76EE\u6807\u9AD8=${TARGET_H}  \u6253\u5305\u8017\u65F6=${tPack}ms`);
console.log(`\u672A\u538B\u7F29=${packed.binary.length}B  gzip=${gzBytes.length}B  \u538B\u7F29\u7387=${(gzBytes.length / packed.binary.length * 100).toFixed(1)}%`);
console.log("");
console.log("\u5E27\u540D          \u6E90\u5C3A\u5BF8 \u2192 \u8F93\u51FA\u5C3A\u5BF8   \u4E0D\u900F\u660E   \u7A84\u5757%   PSNR(dB)  \u6700\u5927\u901A\u9053\u8BEF\u5DEE");
var totalErr = 0;
var totalPx = 0;
for (let i = 0; i < decoded.frames.length; i++) {
  const f = decoded.frames[i];
  const base = buildBaseHslData(f, decoded.palette);
  const res = buildResidualData(f);
  const info = packed.info[i];
  const w = base.width, h = base.height;
  const srcFrame = sources[i];
  const srcData = srcFrame.image.data;
  const sw = srcFrame.image.width, sh = srcFrame.image.height;
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (srcData[(y * sw + x) * 4 + 3] >= 128) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const xr = box.w / w, yr = box.h / h;
  let se = 0, n = 0, maxErr = 0;
  for (let dy = 0; dy < h; dy++) {
    const sy0 = box.y + dy * yr, sy1 = sy0 + yr;
    for (let dx = 0; dx < w; dx++) {
      const di = (dy * w + dx) * 4;
      if (base.data[di + 3] < 0.5) continue;
      const sx0 = box.x + dx * xr, sx1 = sx0 + xr;
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(sh, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy1, sy + 1) - Math.max(sy0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.min(sw, Math.ceil(sx1)); sx++) {
          const wx = Math.min(sx1, sx + 1) - Math.max(sx0, sx);
          if (wx <= 0) continue;
          const p = (sy * sw + sx) * 4;
          const al = srcData[p + 3] / 255;
          r += srcData[p] * al * wx * wy;
          g += srcData[p + 1] * al * wx * wy;
          b += srcData[p + 2] * al * wx * wy;
          a += al * wx * wy;
          ws += wx * wy;
        }
      }
      if (a < 1e-6) continue;
      const sr = r / a, sg = g / a, sb = b / a;
      const qH = res.data[di], qS = res.data[di + 1], qL = res.data[di + 2];
      const ddH = qH / 255 - 0.5;
      const ddS = qS / 255 - 0.5;
      const ddL = qL / 255 - 0.5;
      const finalH = ((base.data[di] + ddH) % 1 + 1) % 1;
      const finalS = Math.max(0, Math.min(1, base.data[di + 1] + ddS));
      const finalL = Math.max(0, Math.min(1, base.data[di + 2] + ddL));
      const [rr, gg, bb] = hsl2rgb(finalH, finalS, finalL);
      const e = [Math.abs(rr * 255 - sr), Math.abs(gg * 255 - sg), Math.abs(bb * 255 - sb)];
      const m = Math.max(...e);
      if (m > maxErr) maxErr = m;
      se += (rr * 255 - sr) ** 2 + (gg * 255 - sg) ** 2 + (bb * 255 - sb) ** 2;
      n += 3;
    }
  }
  const mse = se / n;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
  totalErr += se;
  totalPx += n;
  console.log(
    `${f.name.padEnd(12, " ")} ${info.sourceWidth}x${info.sourceHeight} \u2192 ${w}x${h}`.padEnd(48, " ") + `${(info.opaqueRatio * 100).toFixed(1)}%`.padStart(8) + `${(info.narrowBlockRatio * 100).toFixed(0)}%`.padStart(7) + `${psnr.toFixed(2)}`.padStart(11) + `${maxErr.toFixed(0)}`.padStart(14)
  );
}
var gMse = totalErr / totalPx;
console.log("");
console.log(`\u603B\u8BA1 PSNR = ${(10 * Math.log10(255 * 255 / gMse)).toFixed(2)} dB   \u6B8B\u5DEE\u622A\u65AD\u6BD4\u4F8B = ${(packed.clippedRatio * 100).toFixed(3)}%`);
var decDir = join(ROOT, "decoded");
if (!existsSync(decDir)) mkdirSync(decDir, { recursive: true });
var decManifest = [];
for (let i = 0; i < decoded.frames.length; i++) {
  const f = decoded.frames[i];
  const base = buildBaseHslData(f, decoded.palette);
  const res = buildResidualData(f);
  const w = base.width, h = base.height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    if (base.data[k * 4 + 3] < 0.5) continue;
    const qH = res.data[k * 4], qS = res.data[k * 4 + 1], qL = res.data[k * 4 + 2];
    const fh = ((base.data[k * 4] + (qH / 255 - 0.5)) % 1 + 1) % 1;
    const fs = Math.max(0, Math.min(1, base.data[k * 4 + 1] + (qS / 255 - 0.5)));
    const fl = Math.max(0, Math.min(1, base.data[k * 4 + 2] + (qL / 255 - 0.5)));
    const [r, g, b] = hsl2rgb(fh, fs, fl);
    out[k * 4] = r * 255;
    out[k * 4 + 1] = g * 255;
    out[k * 4 + 2] = b * 255;
    out[k * 4 + 3] = 255;
  }
  const nm = `d_${i}.bin`;
  writeFileSync(join(decDir, nm), Buffer.from(out.buffer));
  decManifest.push({ index: i, name: f.name, file: nm, width: w, height: h });
}
writeFileSync(join(decDir, "manifest.json"), JSON.stringify({ targetHeight: TARGET_H, palette: PALETTE, frames: decManifest }, null, 1));
