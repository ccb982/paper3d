export const MAGIC = 0x46545832;
/** ★ v4：分辨率存 w/h 两 uint32（不再假设正方形）；blockFlags 升 64 位 BigUint64 */
export const VERSION = 4;
export const ADAPTIVE_BLOCK_COLS = 8;
export const ADAPTIVE_BLOCK_ROWS = 8;
export const ADAPTIVE_TOTAL_BLOCKS = ADAPTIVE_BLOCK_COLS * ADAPTIVE_BLOCK_ROWS;

export function quantizeH(dH: number, range: number = 0.5): number {
  const clamped = Math.max(-range, Math.min(range, dH));
  return Math.round(((clamped + range) / (2 * range)) * 63);
}

export function quantizeS(dS: number, range: number = 0.5): number {
  const clamped = Math.max(-range, Math.min(range, dS));
  return Math.round(((clamped + range) / (2 * range)) * 31);
}

export function quantizeL(dL: number, range: number = 0.5): number {
  const clamped = Math.max(-range, Math.min(range, dL));
  return Math.round(((clamped + range) / (2 * range)) * 31);
}

export function dequantizeH(encoded: number, range: number = 0.5): number {
  return ((encoded / 63) * 2 * range) - range;
}

export function dequantizeS(encoded: number, range: number = 0.5): number {
  return ((encoded / 31) * 2 * range) - range;
}

export function dequantizeL(encoded: number, range: number = 0.5): number {
  return ((encoded / 31) * 2 * range) - range;
}

export function packRGB565(s: number, h: number, l: number): number {
  return ((s & 0x1F) << 11) | ((h & 0x3F) << 5) | (l & 0x1F);
}

export function unpackRGB565(packed: number): { s: number; h: number; l: number } {
  return {
    s: (packed >> 11) & 0x1F,
    h: (packed >> 5) & 0x3F,
    l: packed & 0x1F
  };
}

export function getAdaptiveBlockIndex(x: number, y: number, w: number, h: number): number {
  const col = Math.min(Math.floor((x / w) * ADAPTIVE_BLOCK_COLS), ADAPTIVE_BLOCK_COLS - 1);
  const row = Math.min(Math.floor((y / h) * ADAPTIVE_BLOCK_ROWS), ADAPTIVE_BLOCK_ROWS - 1);
  return row * ADAPTIVE_BLOCK_COLS + col;
}

export function getRangeForBlock(blockFlags: bigint, blockIdx: number): number {
  return (blockFlags & (1n << BigInt(blockIdx))) ? 0.25 : 0.5;
}

export function rleEncode16(data: Uint16Array): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let i = 0;
  const len = data.length;

  while (i < len) {
    const pixel = data[i];
    i++;

    let count = 1;
    while (i < len && count < 65535) {
      if (data[i] !== pixel) break;
      count++;
      i++;
    }

    const chunk = new Uint8Array(4);
    const view = new DataView(chunk.buffer);
    view.setUint16(0, count, true);
    view.setUint16(2, pixel, true);
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function rleDecode16(encodedData: Uint8Array, expectedPixelCount: number): Uint16Array {
  if (encodedData.length === 0) return new Uint16Array(0);

  const result = new Uint16Array(expectedPixelCount);
  let readOffset = 0;
  let writeOffset = 0;
  const dataView = new DataView(encodedData.buffer, encodedData.byteOffset, encodedData.byteLength);

  while (readOffset + 4 <= encodedData.length && writeOffset < expectedPixelCount) {
    const count = dataView.getUint16(readOffset, true);
    readOffset += 2;
    const pixel = dataView.getUint16(readOffset, true);
    readOffset += 2;

    const actualCount = Math.min(count, expectedPixelCount - writeOffset);
    for (let i = 0; i < actualCount; i++) {
      result[writeOffset++] = pixel;
    }
  }
  return result;
}

export function rleEncode8(data: Uint8Array): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let i = 0;
  const len = data.length;

  while (i < len) {
    const pixel = data[i];
    i++;

    let count = 1;
    while (i < len && count < 65535) {
      if (data[i] !== pixel) break;
      count++;
      i++;
    }

    const chunk = new Uint8Array(3);
    const view = new DataView(chunk.buffer);
    view.setUint16(0, count, true);
    chunk[2] = pixel;
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function rleDecode8(encodedData: Uint8Array, expectedPixelCount: number): Uint8Array {
  if (encodedData.length === 0) return new Uint8Array(0);

  const result = new Uint8Array(expectedPixelCount);
  let readOffset = 0;
  let writeOffset = 0;
  const dataView = new DataView(encodedData.buffer, encodedData.byteOffset, encodedData.byteLength);

  while (readOffset + 3 <= encodedData.length && writeOffset < expectedPixelCount) {
    const count = dataView.getUint16(readOffset, true);
    readOffset += 2;
    const pixel = encodedData[readOffset++];

    const actualCount = Math.min(count, expectedPixelCount - writeOffset);
    for (let i = 0; i < actualCount; i++) {
      result[writeOffset++] = pixel;
    }
  }
  return result;
}

// ==================== 差分滤波（替代 RLE，为 Gzip 优化）====================
// 对 Uint8Array 做行差分（每行第一个像素保留原值）
export function applyDelta8(data: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (i % stride === 0) out[i] = data[i];
    else out[i] = data[i] - data[i - 1];
  }
  return out;
}

export function invertDelta8(filtered: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    if (i % stride === 0) out[i] = filtered[i];
    else out[i] = filtered[i] + out[i - 1];
  }
  return out;
}

// 对 Uint16Array 做行差分（原理相同）
export function applyDelta16(data: Uint16Array, stride: number): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (i % stride === 0) out[i] = data[i];
    else out[i] = data[i] - data[i - 1];
  }
  return out;
}

export function invertDelta16(filtered: Uint16Array, stride: number): Uint16Array {
  const out = new Uint16Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    if (i % stride === 0) out[i] = filtered[i];
    else out[i] = filtered[i] + out[i - 1];
  }
  return out;
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bakeBaseColor(base: { h: number; s: number; l: number }): { h: number; s: number; l: number } {
  return {
    h: base.h - 0.5,
    s: base.s - 1.0,
    l: base.l - 1.0
  };
}

export interface FtxCompressedRegion {
  id: number;
  bbox: { x: number; y: number; w: number; h: number };
  baseColors: Array<{ h: number; s: number; l: number }>;
  /** 64 位分块量化标志（每 bit 对应一个 8×8 块；历史 number 值会自动 BigInt 化） */
  blockFlags: bigint;
  regionIdTexture?: string;
  deltaTexture: string;
}

export interface FtxCompressedData {
  version: number;
  resolution: [number, number];
  regionCount: number;
  regions: FtxCompressedRegion[];
  hueThreshold: number;
}

export function compressToBinary(result: {
  resolution: [number, number];
  regions: FtxCompressedRegion[];
  hueThreshold: number;
}): Uint8Array {
  const { resolution, regions, hueThreshold } = result;

  // v4 头部：Magic(4) + Version(1) + RegionCount(2) + Width(4) + Height(4) + HueThreshold(4) = 19
  let totalSize = 19;

  for (const region of regions) {
    const colorCount = region.baseColors.length;
    // ★ v4：blockFlags 2 字节 → 8 字节（64 位）
    const regionHeaderSize = 2 + 8 + 2 + 8 + colorCount * 12;
    totalSize += regionHeaderSize;

    if (region.regionIdTexture) {
      totalSize += 4 + region.regionIdTexture.length;
    } else {
      totalSize += 4;
    }

    totalSize += 4 + region.deltaTexture.length;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, MAGIC, false);
  offset += 4;
  view.setUint8(offset, VERSION);
  offset += 1;
  view.setUint16(offset, regions.length, true);
  offset += 2;
  view.setUint32(offset, resolution[0], true);
  offset += 4;
  view.setUint32(offset, resolution[1] ?? resolution[0], true);
  offset += 4;
  view.setFloat32(offset, hueThreshold, true);
  offset += 4;

  for (const region of regions) {
    const { id, bbox, baseColors, regionIdTexture, deltaTexture } = region;
    const { x, y, w, h } = bbox;
    const colorCount = baseColors.length;
    const blockFlags = BigInt(region.blockFlags ?? 0n);

    view.setUint16(offset, id, true);
    offset += 2;
    view.setUint16(offset, x, true);
    offset += 2;
    view.setUint16(offset, y, true);
    offset += 2;
    view.setUint16(offset, w, true);
    offset += 2;
    view.setUint16(offset, h, true);
    offset += 2;
    view.setUint16(offset, colorCount, true);
    offset += 2;
    view.setBigUint64(offset, blockFlags, true);
    offset += 8;

    for (const base of baseColors) {
      const baked = bakeBaseColor(base);
      view.setFloat32(offset, baked.h, true);
      offset += 4;
      view.setFloat32(offset, baked.s, true);
      offset += 4;
      view.setFloat32(offset, baked.l, true);
      offset += 4;
    }

    if (regionIdTexture) {
      const regionIdBytes = base64ToUint8(regionIdTexture);
      // 差分替代 RLE
      const regionDiff = applyDelta8(regionIdBytes, bbox.w);
      view.setUint32(offset, regionDiff.length, true);
      offset += 4;
      const regionIdView = new Uint8Array(buffer, offset, regionDiff.length);
      regionIdView.set(regionDiff);
      offset += regionDiff.length;
    } else {
      view.setUint32(offset, 0, true);
      offset += 4;
    }

    const deltaBytes = base64ToUint8(deltaTexture);
    if (deltaBytes.length > 0 && bbox.w > 0 && bbox.h > 0) {
      const totalPixels = bbox.w * bbox.h;
      // deltaBytes 为连接格式：H...H S...S L...L
      const hChannel = deltaBytes.slice(0, totalPixels);
      const sChannel = deltaBytes.slice(totalPixels, totalPixels * 2);
      const lChannel = deltaBytes.slice(totalPixels * 2, totalPixels * 3);

      // 分别做行差分
      const hDiff = applyDelta8(hChannel, bbox.w);
      const sDiff = applyDelta8(sChannel, bbox.w);
      const lDiff = applyDelta8(lChannel, bbox.w);

      // 合并写入
      const deltaDiffBytes = new Uint8Array(hDiff.length + sDiff.length + lDiff.length);
      deltaDiffBytes.set(hDiff, 0);
      deltaDiffBytes.set(sDiff, hDiff.length);
      deltaDiffBytes.set(lDiff, hDiff.length + sDiff.length);

      view.setUint32(offset, deltaDiffBytes.length, true);
      offset += 4;
      const deltaView = new Uint8Array(buffer, offset, deltaDiffBytes.length);
      deltaView.set(deltaDiffBytes);
      offset += deltaDiffBytes.length;
    } else {
      view.setUint32(offset, 0, true);
      offset += 4;
    }
  }

  return new Uint8Array(buffer);
}

export function decompressFromBinary(buffer: ArrayBuffer): FtxCompressedData {
  const dataView = new DataView(buffer);
  let offset = 0;

  const magic = dataView.getUint32(offset, false);
  offset += 4;
  if (magic !== MAGIC) throw new Error('Invalid FTX file format');

  const version = dataView.getUint8(offset);
  offset += 1;
  if (version !== 2 && version !== 3 && version !== 4) throw new Error(`Unsupported version: ${version}`);

  const regionCount = dataView.getUint16(offset, true);
  offset += 2;
  // ★ v4 存 w/h 两个 uint32；v2/v3 为单 uint32（正方形假设，历史格式）
  let resW: number;
  let resH: number;
  if (version === 4) {
    resW = dataView.getUint32(offset, true);
    offset += 4;
    resH = dataView.getUint32(offset, true);
    offset += 4;
  } else {
    resW = dataView.getUint32(offset, true);
    offset += 4;
    resH = resW;
  }
  const hueThreshold = dataView.getFloat32(offset, true);
  offset += 4;

  const regions: FtxCompressedRegion[] = [];

  for (let i = 0; i < regionCount; i++) {
    const id = dataView.getUint16(offset, true);
    offset += 2;

    const x = dataView.getUint16(offset, true);
    offset += 2;
    const y = dataView.getUint16(offset, true);
    offset += 2;
    const w = dataView.getUint16(offset, true);
    offset += 2;
    const h = dataView.getUint16(offset, true);
    offset += 2;

    const bbox = { x, y, w, h };
    const colorCount = dataView.getUint16(offset, true);
    offset += 2;

    // ★ v4：64 位 BigUint64 全量；v3：历史 uint16（高 48 位本就丢失）；v2：无
    let blockFlags = 0n;
    if (version === 4) {
      blockFlags = dataView.getBigUint64(offset, true);
      offset += 8;
    } else if (version === 3) {
      blockFlags = BigInt(dataView.getUint16(offset, true));
      offset += 2;
    }

    const baseColors: Array<{ h: number; s: number; l: number }> = [];
    for (let j = 0; j < colorCount; j++) {
      const h = dataView.getFloat32(offset, true) + 0.5;
      offset += 4;
      const s = dataView.getFloat32(offset, true) + 1.0;
      offset += 4;
      const l = dataView.getFloat32(offset, true) + 1.0;
      offset += 4;
      baseColors.push({
        h: ((h % 1) + 1) % 1,
        s: Math.max(0, Math.min(1, s)),
        l: Math.max(0, Math.min(1, l))
      });
    }

    const regionIdTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let regionIdTex: string | undefined = undefined;
    if (regionIdTexLen > 0) {
      const regionDiff = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      // 逆差分还原
      const decoded = invertDelta8(regionDiff, bbox.w);
      regionIdTex = uint8ToBase64(decoded);
    }

    const deltaTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let deltaTex = '';
    if (deltaTexLen > 0) {
      const deltaBytes = new Uint8Array(buffer, offset, deltaTexLen);
      offset += deltaTexLen;
      const totalPixels = bbox.w * bbox.h;

      // 拆分三个通道的差分数据
      const hDiff = deltaBytes.slice(0, totalPixels);
      const sDiff = deltaBytes.slice(totalPixels, totalPixels * 2);
      const lDiff = deltaBytes.slice(totalPixels * 2, totalPixels * 3);

      // 逆差分还原每个通道
      const hChannel = invertDelta8(hDiff, bbox.w);
      const sChannel = invertDelta8(sDiff, bbox.w);
      const lChannel = invertDelta8(lDiff, bbox.w);

      // 合并成连接格式：H...H S...S L...L
      const decoded8 = new Uint8Array(totalPixels * 3);
      decoded8.set(hChannel, 0);
      decoded8.set(sChannel, totalPixels);
      decoded8.set(lChannel, totalPixels * 2);
      deltaTex = uint8ToBase64(decoded8);
    }

    regions.push({
      id,
      bbox,
      baseColors,
      regionIdTexture: regionIdTex ?? undefined,
      deltaTexture: deltaTex,
      blockFlags
    });
  }

  return {
    version,
    resolution: [resW, resH],
    regionCount,
    regions,
    hueThreshold
  };
}