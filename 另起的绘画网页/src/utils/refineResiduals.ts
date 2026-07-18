import { rgbToHsl } from './colorCompressor';
import { getAdaptiveBlockIndex, ADAPTIVE_TOTAL_BLOCKS } from '../core/ftxCore';

function hueDistance(h1: number, h2: number): number {
  let d = Math.abs(h1 - h2);
  if (d > 0.5) d = 1 - d;
  return d;
}

function getBackgroundRgbAt(
  px: number, py: number,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  textureSize: number
): { r: number; g: number; b: number } {
  const gx = Math.round(bbox.x + px);
  const gy = Math.round(bbox.y + py);
  const idx = (gy * textureSize + gx) * 4;
  return {
    r: bgImageData.data[idx],
    g: bgImageData.data[idx + 1],
    b: bgImageData.data[idx + 2],
  };
}

function getBackgroundHslAt(
  px: number, py: number,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  textureSize: number
): { h: number; s: number; l: number } {
  const rgb = getBackgroundRgbAt(px, py, bbox, bgImageData, textureSize);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function normalizeHueDelta(d: number): number {
  if (d > 0.5) return d - 1.0;
  if (d < -0.5) return d + 1.0;
  return d;
}

export function refineResidualsAndColors(
  regionIdTex: Uint8Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  tempDeltas: Float32Array,
  textureSize: number,
  hueThreshold: number = 0.01,
  maxNewColors: number = 3
): { blockFlags: number; changed: boolean; changedPixelCount: number } {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const DELTA_THRESHOLD = 0.25;

  // 构建颜色映射：ID -> 基础色（baseColors 排序后索引与 ID 不再对应）
  const colorMapById = new Map<number, { h: number; s: number; l: number }>();
  for (const c of baseColors) {
    colorMapById.set(c.id, { h: c.h, s: c.s, l: c.l });
  }

  // 步骤1：识别异常像素（叠加色与背景色色相差 > 阈值）
  const badPixels: number[] = [];
  for (let idx = 0; idx < totalPixels; idx++) {
    const colorId = regionIdTex[idx];
    if (colorId === 0) continue;
    const base = colorMapById.get(colorId);
    if (!base) continue;

    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgHsl = getBackgroundHslAt(px, py, bbox, bgImageData, textureSize);

    const dH = tempDeltas[idx * 3];
    let overlayH = base.h + dH;
    overlayH = ((overlayH % 1) + 1) % 1;

    const hDist = hueDistance(overlayH, bgHsl.h);
    if (hDist > hueThreshold) {
      badPixels.push(idx);
    }
  }

  if (badPixels.length === 0) {
    const blockPixelCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
    const blockSmallCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
    for (let idx = 0; idx < totalPixels; idx++) {
      const colorId = regionIdTex[idx];
      if (colorId === 0) continue;
      const px = idx % w;
      const py = Math.floor(idx / w);
      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      blockPixelCount[blockIdx]++;

      const dH = tempDeltas[idx * 3];
      const dS = tempDeltas[idx * 3 + 1];
      const dL = tempDeltas[idx * 3 + 2];
      if (Math.abs(dH) <= DELTA_THRESHOLD && Math.abs(dS) <= DELTA_THRESHOLD && Math.abs(dL) <= DELTA_THRESHOLD) {
        blockSmallCount[blockIdx]++;
      }
    }

    let blockFlags = 0;
    for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
      if (blockPixelCount[b] > 0) {
        const ratio = blockSmallCount[b] / blockPixelCount[b];
        if (ratio >= 0.95) {
          blockFlags |= (1 << b);
        }
      }
    }
    return { blockFlags, changed: false, changedPixelCount: 0 };
  }

  // 步骤2：对每个异常像素，寻找最佳替代基础色
  let newColorCount = 0;
  let changedCount = 0;

  for (const idx of badPixels) {
    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgHsl = getBackgroundHslAt(px, py, bbox, bgImageData, textureSize);

    // ---- 第一步：收集周围通过校验的基础色 ----
    const candidates = new Map<number, number>();
    const searchRadius = 3;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        const nColorId = regionIdTex[nIdx];
        if (nColorId === 0) continue;
        const nBase = colorMapById.get(nColorId);
        if (!nBase) continue;
        const nBgHsl = getBackgroundHslAt(nx, ny, bbox, bgImageData, textureSize);
        if (hueDistance(nBase.h, nBgHsl.h) < hueThreshold) {
          candidates.set(nColorId, (candidates.get(nColorId) || 0) + 1);
        }
      }
    }

    let bestId: number | null = null;
    let bestScore = -1;

    // 如果有候选，选出现次数最多的
    if (candidates.size > 0) {
      for (const [id, count] of candidates) {
        if (count > bestScore) {
          bestScore = count;
          bestId = id;
        }
      }
    }

    // 如果没有周围合适的，尝试全局基础色中与背景色最接近的
    if (bestId === null) {
      let minDist = Infinity;
      for (const c of baseColors) {
        const dist = hueDistance(c.h, bgHsl.h);
        if (dist < minDist) {
          minDist = dist;
          bestId = c.id;
        }
      }
      // 如果最小距离仍大于阈值，且允许创建新颜色
      if (minDist > hueThreshold && newColorCount < maxNewColors) {
        let duplicate = false;
        let duplicateId: number | null = null;
        const newHsl = { h: bgHsl.h, s: bgHsl.s, l: bgHsl.l };
        for (const c of baseColors) {
          if (hueDistance(c.h, newHsl.h) < 0.02 && Math.abs(c.s - newHsl.s) < 0.05 && Math.abs(c.l - newHsl.l) < 0.05) {
            duplicate = true;
            duplicateId = c.id;
            break;
          }
        }
        if (!duplicate) {
          // 生成新 ID（取现有最大 ID + 1）
          let maxId = 0;
          for (const c of baseColors) {
            if (c.id > maxId) maxId = c.id;
          }
          const newId = maxId + 1;
          const newColor = { id: newId, ...newHsl };
          baseColors.push(newColor);
          colorMapById.set(newId, newHsl);
          bestId = newId;
          newColorCount++;
        } else {
          bestId = duplicateId;
        }
      }
    }

    // 如果最终 bestId 有效且与原来不同，则更新
    if (bestId !== null && bestId !== regionIdTex[idx]) {
      regionIdTex[idx] = bestId;
      changedCount++;
    }
  }

  // 步骤3：重新计算所有像素的残差（基于更新后的 regionIdTex）
  for (let idx = 0; idx < totalPixels; idx++) {
    const colorId = regionIdTex[idx];
    if (colorId === 0) {
      tempDeltas[idx * 3] = 0;
      tempDeltas[idx * 3 + 1] = 0;
      tempDeltas[idx * 3 + 2] = 0;
      continue;
    }
    const base = colorMapById.get(colorId);
    if (!base) continue;

    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgRgb = getBackgroundRgbAt(px, py, bbox, bgImageData, textureSize);
    const hsl = rgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);

    const dH = normalizeHueDelta(hsl.h - base.h);
    const dS = hsl.s - base.s;
    const dL = hsl.l - base.l;
    tempDeltas[idx * 3] = dH;
    tempDeltas[idx * 3 + 1] = dS;
    tempDeltas[idx * 3 + 2] = dL;
  }

  // 步骤4：重新计算 blockFlags
  const blockPixelCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
  const blockSmallCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
  for (let idx = 0; idx < totalPixels; idx++) {
    const colorId = regionIdTex[idx];
    if (colorId === 0) continue;
    const px = idx % w;
    const py = Math.floor(idx / w);
    const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
    blockPixelCount[blockIdx]++;

    const dH = tempDeltas[idx * 3];
    const dS = tempDeltas[idx * 3 + 1];
    const dL = tempDeltas[idx * 3 + 2];
    if (Math.abs(dH) <= DELTA_THRESHOLD && Math.abs(dS) <= DELTA_THRESHOLD && Math.abs(dL) <= DELTA_THRESHOLD) {
      blockSmallCount[blockIdx]++;
    }
  }

  let newBlockFlags = 0;
  for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
    if (blockPixelCount[b] > 0) {
      const ratio = blockSmallCount[b] / blockPixelCount[b];
      if (ratio >= 0.95) {
        newBlockFlags |= (1 << b);
      }
    }
  }

  return { blockFlags: newBlockFlags, changed: true, changedPixelCount: changedCount };
}
