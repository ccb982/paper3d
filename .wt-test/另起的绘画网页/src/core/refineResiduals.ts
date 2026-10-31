import { rgbToHsl } from '../utils/colorCompressor';
import { getAdaptiveBlockIndex, ADAPTIVE_TOTAL_BLOCKS, quantizeH, quantizeS, quantizeL, dequantizeH, dequantizeS, dequantizeL, getRangeForBlock, packRGB565, unpackRGB565 } from './ftxCore';

function hueDistance(h1: number, h2: number): number {
  let d = Math.abs(h1 - h2);
  if (d > 0.5) d = 1 - d;
  return d;
}

function getBackgroundRgbAt(
  px: number, py: number,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData
): { r: number; g: number; b: number } {
  // ★ 使用 bgImageData.width 作为步长（防止 texSize 与 bgImageData 尺寸不一致时索引错位）
  const stride = bgImageData.width;
  const gx = Math.round(bbox.x + px);
  const gy = Math.round(bbox.y + py);
  const idx = (gy * stride + gx) * 4;
  return {
    r: bgImageData.data[idx],
    g: bgImageData.data[idx + 1],
    b: bgImageData.data[idx + 2],
  };
}

function getBackgroundHslAt(
  px: number, py: number,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData
): { h: number; s: number; l: number } {
  const rgb = getBackgroundRgbAt(px, py, bbox, bgImageData);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function normalizeHueDelta(d: number): number {
  if (d > 0.5) return d - 1.0;
  if (d < -0.5) return d + 1.0;
  return d;
}

function isPixelAcceptable(
  finalHsl: { h: number; s: number; l: number },
  bgHsl: { h: number; s: number; l: number },
  hThresh: number = 0.02,
  sThresh: number = 0.02,
  lThresh: number = 0.02
): boolean {
  const dh = hueDistance(finalHsl.h, bgHsl.h);
  const ds = Math.abs(finalHsl.s - bgHsl.s);
  const dl = Math.abs(finalHsl.l - bgHsl.l);
  return dh < hThresh && ds < sThresh && dl < lThresh;
}

function hslWeightedDistance(
  a: { h: number; s: number; l: number },
  b: { h: number; s: number; l: number }
): number {
  const dh = hueDistance(a.h, b.h);
  const ds = Math.abs(a.s - b.s);
  const dl = Math.abs(a.l - b.l);
  return dh * 2.0 + ds + dl;
}

export function refineResidualsAndColors(
  regionIdTex: Uint16Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  tempDeltas: Float32Array,
  hueThreshold: number = 0.02,
  maxNewColors: number = 3,
  /**
   * ★ 是否自动创建新基础色（默认 false）。
   * false = 坏像素归到最近的现有基础色，不新增（解耦设计，需手动调用 createMissingBaseColors）
   * true  = 坏像素距离过远时自动创建新基础色（旧行为）
   */
  autoAddColors: boolean = false,
): { blockFlags: bigint; changed: boolean; changedPixelCount: number; badPixels: number[] } {
  const { w, h } = bbox;
  const totalPixels = w * h;
  const DELTA_THRESHOLD = 0.25;

  const colorMapById = new Map<number, { h: number; s: number; l: number }>();
  for (const c of baseColors) {
    colorMapById.set(c.id, { h: c.h, s: c.s, l: c.l });
  }

  let blockPixelCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
  let blockSmallCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
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

  let blockFlags = 0n;
  for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
    if (blockPixelCount[b] > 0) {
      const ratio = blockSmallCount[b] / blockPixelCount[b];
      if (ratio >= 0.95) {
        blockFlags |= (1n << BigInt(b));
      }
    }
  }

  const badPixels: number[] = [];
  for (let idx = 0; idx < totalPixels; idx++) {
    const colorId = regionIdTex[idx];
    if (colorId === 0) continue;
    const base = colorMapById.get(colorId);
    if (!base) continue;

    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgHsl = getBackgroundHslAt(px, py, bbox, bgImageData);

    const dH = tempDeltas[idx * 3];
    const dS = tempDeltas[idx * 3 + 1];
    const dL = tempDeltas[idx * 3 + 2];

    const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);

    const qH = quantizeH(dH, range);
    const qS = quantizeS(dS, range);
    const qL = quantizeL(dL, range);
    const dH_decoded = dequantizeH(qH, range);
    const dS_decoded = dequantizeS(qS, range);
    const dL_decoded = dequantizeL(qL, range);

    let finalH = base.h + dH_decoded;
    if (finalH < 0) finalH += 1.0;
    else if (finalH >= 1.0) finalH -= 1.0;
    const finalS = Math.max(0, Math.min(1, base.s + dS_decoded));
    const finalL = Math.max(0, Math.min(1, base.l + dL_decoded));

    if (!isPixelAcceptable({ h: finalH, s: finalS, l: finalL }, bgHsl, hueThreshold, 0.02, 0.02)) {
      badPixels.push(idx);
    }
  }

  if (badPixels.length === 0) {
    return { blockFlags, changed: false, changedPixelCount: 0, badPixels: [] };
  }

  let newColorCount = 0;
  let changedCount = 0;

  for (const idx of badPixels) {
    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgHsl = getBackgroundHslAt(px, py, bbox, bgImageData);

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
        const nBgHsl = getBackgroundHslAt(nx, ny, bbox, bgImageData);
        if (isPixelAcceptable(nBase, nBgHsl, hueThreshold, 0.02, 0.02)) {
          candidates.set(nColorId, (candidates.get(nColorId) || 0) + 1);
        }
      }
    }

    let bestId: number | null = null;
    let bestScore = -1;

    if (candidates.size > 0) {
      for (const [id, count] of candidates) {
        if (count > bestScore) {
          bestScore = count;
          bestId = id;
        }
      }
    }

    if (bestId === null) {
      let minDist = Infinity;
      for (const c of baseColors) {
        const dist = hslWeightedDistance(c, bgHsl);
        if (dist < minDist) {
          minDist = dist;
          bestId = c.id;
        }
      }
      if (autoAddColors && minDist > hueThreshold * 2 && newColorCount < maxNewColors) {
        let duplicate = false;
        let duplicateId: number | null = null;
        const newHsl = { h: bgHsl.h, s: bgHsl.s, l: bgHsl.l };
        for (const c of baseColors) {
          if (hueDistance(c.h, newHsl.h) < 0.02 && Math.abs(c.s - newHsl.s) < 0.015 && Math.abs(c.l - newHsl.l) < 0.015) {
            duplicate = true;
            duplicateId = c.id;
            break;
          }
        }
        if (!duplicate) {
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

    if (bestId !== null && bestId !== regionIdTex[idx]) {
      regionIdTex[idx] = bestId;
      changedCount++;
    }
  }

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
    const bgRgb = getBackgroundRgbAt(px, py, bbox, bgImageData);
    const hsl = rgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);

    const dH = normalizeHueDelta(hsl.h - base.h);
    const dS = hsl.s - base.s;
    const dL = hsl.l - base.l;
    tempDeltas[idx * 3] = dH;
    tempDeltas[idx * 3 + 1] = dS;
    tempDeltas[idx * 3 + 2] = dL;
  }

  blockPixelCount.fill(0);
  blockSmallCount.fill(0);
  let newBlockFlags = 0n;
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

  for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
    if (blockPixelCount[b] > 0) {
      const ratio = blockSmallCount[b] / blockPixelCount[b];
      if (ratio >= 0.95) {
        newBlockFlags |= (1n << BigInt(b));
      }
    }
  }

  return { blockFlags: newBlockFlags, changed: true, changedPixelCount: changedCount, badPixels };
}

/**
 * ★ 为无法匹配现有基础色的坏像素创建新基础色（从 refineResidualsAndColors 剥离）。
 *
 * 逻辑：遍历坏像素，如果背景色与所有现有基础色距离过远（>hueThreshold*2），
 * 则创建新基础色并更新 regionIdTex。最多创建 maxNewColors 个新色。
 *
 * 使用场景：recalculateResidual 默认不自动新增基础色（autoAddColors=false），
 * 用户确认坏像素列表后，手动调用此函数补充缺失的基础色。
 *
 * @param badPixels  来自 refineResidualsAndColors 返回值的坏像素索引列表
 * @returns 新创建的基础色列表 + 是否有变化 + 变化像素数
 *   - newColors：新创建的基础色（已 push 到 baseColors 数组）
 *   - 调用方需将 newColors 同步到全局调色板（addColorToPalette）
 *   - regionIdTex 已就地更新为新色 ID
 */
export function createMissingBaseColors(
  regionIdTex: Uint16Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  badPixels: number[],
  hueThreshold: number = 0.015,
  maxNewColors: number = 3,
): {
  newColors: Array<{ id: number; h: number; s: number; l: number }>;
  changed: boolean;
  changedPixelCount: number;
} {
  const { w } = bbox;
  let newColorCount = 0;
  let changedCount = 0;
  const newColors: Array<{ id: number; h: number; s: number; l: number }> = [];

  // 找到当前最大 ID
  let maxId = 0;
  for (const c of baseColors) {
    if (c.id > maxId) maxId = c.id;
  }

  for (const idx of badPixels) {
    const px = idx % w;
    const py = Math.floor(idx / w);
    const bgHsl = getBackgroundHslAt(px, py, bbox, bgImageData);

    // 检查与所有现有基础色的距离
    let minDist = Infinity;
    let nearestId: number | null = null;
    for (const c of baseColors) {
      const dist = hslWeightedDistance(c, bgHsl);
      if (dist < minDist) {
        minDist = dist;
        nearestId = c.id;
      }
    }

    // 距离过远且还能创建新色 → 创建新基础色
    if (minDist > hueThreshold * 2 && newColorCount < maxNewColors) {
      // 检查重复
      let duplicate = false;
      let duplicateId: number | null = null;
      const newHsl = { h: bgHsl.h, s: bgHsl.s, l: bgHsl.l };
      for (const c of baseColors) {
        if (hueDistance(c.h, newHsl.h) < 0.02 && Math.abs(c.s - newHsl.s) < 0.015 && Math.abs(c.l - newHsl.l) < 0.015) {
          duplicate = true;
          duplicateId = c.id;
          break;
        }
      }
      if (!duplicate) {
        const newId = ++maxId;
        const newColor = { id: newId, ...newHsl };
        baseColors.push(newColor);
        newColors.push(newColor);
        if (regionIdTex[idx] !== newId) {
          regionIdTex[idx] = newId;
          changedCount++;
        }
        newColorCount++;
      } else if (duplicateId !== null && duplicateId !== regionIdTex[idx]) {
        regionIdTex[idx] = duplicateId;
        changedCount++;
      }
    } else if (nearestId !== null && nearestId !== regionIdTex[idx]) {
      // 不够远 → 归到最近现有色
      regionIdTex[idx] = nearestId;
      changedCount++;
    }
  }

  return { newColors, changed: changedCount > 0, changedPixelCount: changedCount };
}

/**
 * ★ 碎簇清理：把面积 < minArea 像素的孤立小区域归并到周围像素的颜色。
 *
 * 用途：缩放/提取/重新聚类后，聚类会留下孤立小簇（砖缝、噪声、缩放伪影），
 * 在画面上呈现为斑点噪点。此函数按"连通区域"统计面积（同一 id 可能分成
 * 多个区域：大区域保留、小区域归并），把小区域像素归并到 8 邻域中占多数的
 * 稳定颜色（邻域无稳定色时用色距最近的色），并重算残差。
 *
 * ★ 校验（必须保证阈值以内）：残差按新 base 重算 → 量化往返 → 合成色
 *   (base + 残差) 与目标像素三通道差 ≤ threshold 才归并；
 *   校验不通过 → 保留原色，绝不强行归并产生超阈值误差。
 *
 * @param regionIdTex  区域 id 纹理（bbox 局部，就地修改）
 * @param deltaPacked  RGB565 打包残差（bbox 局部，就地修改）
 * @param baseColors   基础色（含 id，与 regionIdTex 的 id 语义一致：本地或全局）
 * @param bbox         区域矩形（纹理全局坐标）
 * @param bgImageData  背景图（用其真实宽度做采样步长）
 * @param sourceWidth  bgImageData 的宽度
 * @param blockFlags   块级 range 标志
 * @param minArea      连通区域面积小于此值视为可归并（默认 10 = 个位数）
 * @param threshold    达标阈值（默认 0.02，≥ 量化步长避免误判）
 */
export function mergeTinyRegions(
  regionIdTex: Uint16Array,
  deltaPacked: Uint16Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  bbox: { x: number; y: number; w: number; h: number },
  bgImageData: ImageData,
  sourceWidth: number,
  blockFlags: bigint,
  minArea: number = 10,
  threshold: number = 0.02,
): { mergedPixels: number; keptPixels: number; removedIds: number[] } {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const totalPixels = w * h;
  const removedIds: number[] = [];

  const colorMapById = new Map<number, { h: number; s: number; l: number }>();
  for (const c of baseColors) colorMapById.set(c.id, c);
  const hueRingDist = (a: number, b: number): number => {
    let d = Math.abs(a - b);
    if (d > 0.5) d = 1 - d;
    return d;
  };

  // ============ 2. 解包残差为浮点 ============
  const tempDeltas = new Float32Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    const packed = deltaPacked[i];
    const { s, h: qH, l: qL } = unpackRGB565(packed);
    const range = getRangeForBlock(blockFlags, getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h));
    tempDeltas[i * 3] = dequantizeH(qH, range);
    tempDeltas[i * 3 + 1] = dequantizeS(s, range);
    tempDeltas[i * 3 + 2] = dequantizeL(qL, range);
  }

  let mergedPixels = 0;
  let keptPixels = 0;
  const stillUsed = new Set<number>(); // 归并后仍被引用的 id

  // ============ 3. 迭代归并：标记小区域 → 归并，直到无小区域 ============
  // 迭代原因：归并后的像素若被 0/其他色隔开，可能形成新的小区域（candId 孤立块），
  // 需要重复扫描直到稳定；每次迭代最多 10 轮（防死循环）。
  const DIRS8: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let iter = 0; iter < 10; iter++) {
    // 3a. 按连通区域（8 邻域，斜向也算连通）统计，标记小区域
    // 8 邻域：避免斜线/对角像素在 4 邻域下被误拆成碎簇（墙线/砖缝是斜向的）
    const smallRegion = new Uint8Array(totalPixels); // 1 = 小区域像素（可归并）
    const visited = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      if (regionIdTex[i] === 0 || visited[i]) continue;
      const id = regionIdTex[i];
      const stack: number[] = [i];
      visited[i] = 1;
      const pixels: number[] = [];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        pixels.push(cur);
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy] of DIRS8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (!visited[ni] && regionIdTex[ni] === id) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (pixels.length < minArea) {
        for (const p of pixels) smallRegion[p] = 1;
      }
    }

    // 没有小区域 → 完成
    let hasSmall = false;
    for (let i = 0; i < totalPixels; i++) {
      if (smallRegion[i] === 1) { hasSmall = true; break; }
    }
    if (!hasSmall) break;

    // 稳定 id 集合：全纹理像素数 ≥ minArea 的 id（候选 2 只归并到稳定 id，
    // 避免归并到另一个小色 id 形成新碎簇）
    const idPixelCount = new Map<number, number>();
    for (let i = 0; i < totalPixels; i++) {
      const rid = regionIdTex[i];
      if (rid !== 0) idPixelCount.set(rid, (idPixelCount.get(rid) || 0) + 1);
    }
    const stableIds = new Set<number>();
    for (const [id, n] of idPixelCount) {
      if (n >= minArea) stableIds.add(id);
    }
    if (stableIds.size === 0) break; // 没有稳定色可归并 → 完成

    // 3b. 归并本轮小区域像素
    let iterMerged = 0;
    for (let idx = 0; idx < totalPixels; idx++) {
      const rid = regionIdTex[idx];
      if (rid === 0) continue;
      if (smallRegion[idx] === 0) {
        stillUsed.add(rid);
        continue;
      }
      const px = idx % w;
      const py = Math.floor(idx / w);

      // 候选 1：8 邻域中非本区域、非 0 的颜色（出现最多）
      const neighborCount = new Map<number, number>();
      for (let ny = Math.max(0, py - 1); ny <= Math.min(h - 1, py + 1); ny++) {
        for (let nx = Math.max(0, px - 1); nx <= Math.min(w - 1, px + 1); nx++) {
          const ni = ny * w + nx;
          const nid = regionIdTex[ni];
          if (nid !== 0 && nid !== rid && smallRegion[ni] === 0) {
            neighborCount.set(nid, (neighborCount.get(nid) || 0) + 1);
          }
        }
      }
      let candId = 0;
      if (neighborCount.size > 0) {
        let bestN = -1;
        for (const [nid, n] of neighborCount) {
          if (n > bestN || (n === bestN && nid < candId)) { bestN = n; candId = nid; }
        }
      } else {
        // 候选 2：色距最近的稳定色（只归并到 ≥ minArea 的 id，避免形成新碎簇）
        const pIdx = ((offsetY + py) * sourceWidth + (offsetX + px)) * 4;
        const target = rgbToHsl(
          bgImageData.data[pIdx],
          bgImageData.data[pIdx + 1],
          bgImageData.data[pIdx + 2],
        );
        let bestD = Infinity;
        for (const cid of stableIds) {
          const c = colorMapById.get(cid);
          if (!c || cid === rid) continue;
          const d = hueRingDist(c.h, target.h) + Math.abs(c.s - target.s) + Math.abs(c.l - target.l);
          if (d < bestD) { bestD = d; candId = cid; }
        }
        if (candId === 0) {
          // 没有任何稳定色 → 保留原像素
          stillUsed.add(rid);
          continue;
        }
      }
      if (candId === 0) {
        stillUsed.add(rid);
        continue;
      }
      const base = colorMapById.get(candId);
      if (!base) {
        stillUsed.add(rid);
        continue;
      }

      // 残差按新 base 重算
      const pIdx = ((offsetY + py) * sourceWidth + (offsetX + px)) * 4;
      const target = rgbToHsl(
        bgImageData.data[pIdx],
        bgImageData.data[pIdx + 1],
        bgImageData.data[pIdx + 2],
      );
      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);
      let dH = target.h - base.h;
      if (dH > 0.5) dH -= 1.0;
      if (dH < -0.5) dH += 1.0;
      const dS = target.s - base.s;
      const dL = target.l - base.l;

      // ★ 达标校验：量化往返后合成色 vs 目标 ≤ threshold
      let finalH = base.h + dequantizeH(quantizeH(dH, range), range);
      if (finalH < 0) finalH += 1.0;
      else if (finalH >= 1.0) finalH -= 1.0;
      const finalS = Math.max(0, Math.min(1, base.s + dequantizeS(quantizeS(dS, range), range)));
      const finalL = Math.max(0, Math.min(1, base.l + dequantizeL(quantizeL(dL, range), range)));
      const ok =
        hueRingDist(finalH, target.h) <= threshold &&
        Math.abs(finalS - target.s) <= threshold &&
        Math.abs(finalL - target.l) <= threshold;

      if (ok) {
        regionIdTex[idx] = candId;
        tempDeltas[idx * 3] = dH;
        tempDeltas[idx * 3 + 1] = dS;
        tempDeltas[idx * 3 + 2] = dL;
        mergedPixels++;
        iterMerged++;
        stillUsed.add(candId);
      } else {
        // 校验不通过 → 保留原色（绝不强行归并产生超阈值误差）
        keptPixels++;
        stillUsed.add(rid);
      }
    }
    if (iterMerged === 0) break; // 本轮无归并（剩余全是校验失败）→ 完成
  }

  // ============ 4. 重新打包残差 ============
  for (let idx = 0; idx < totalPixels; idx++) {
    const rid = regionIdTex[idx];
    if (rid === 0) continue;
    const blockIdx = getAdaptiveBlockIndex(idx % w, Math.floor(idx / w), w, h);
    const range = getRangeForBlock(blockFlags, blockIdx);
    deltaPacked[idx] = packRGB565(
      quantizeS(tempDeltas[idx * 3 + 1], range),
      quantizeH(tempDeltas[idx * 3], range),
      quantizeL(tempDeltas[idx * 3 + 2], range),
    );
  }

  // 归并后不再被引用的 id → 报告（供调用方清理调色板）
  const allIds = new Set<number>();
  for (let i = 0; i < totalPixels; i++) {
    if (regionIdTex[i] !== 0) allIds.add(regionIdTex[i]);
  }
  for (const [id] of colorMapById) {
    if (!stillUsed.has(id) && !allIds.has(id)) removedIds.push(id);
  }

  return { mergedPixels, keptPixels, removedIds };
}