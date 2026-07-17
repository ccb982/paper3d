export const MAGIC = 0x46545832;
export const VERSION = 3;
export const ADAPTIVE_BLOCK_COLS = 4;
export const ADAPTIVE_BLOCK_ROWS = 4;
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

export function getRangeForBlock(blockFlags: number, blockIdx: number): number {
  return (blockFlags & (1 << blockIdx)) ? 0.25 : 0.5;
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
  blockFlags: number;
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

  let totalSize = 17;

  for (const region of regions) {
    const colorCount = region.baseColors.length;
    const regionHeaderSize = 2 + 8 + 2 + 2 + colorCount * 12;
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
  view.setFloat32(offset, hueThreshold, true);
  offset += 4;

  for (const region of regions) {
    const { id, bbox, baseColors, regionIdTexture, deltaTexture, blockFlags } = region;
    const { x, y, w, h } = bbox;
    const colorCount = baseColors.length;

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
    view.setUint16(offset, blockFlags ?? 0, true);
    offset += 2;

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
      view.setUint32(offset, regionIdBytes.length, true);
      offset += 4;
      const regionIdView = new Uint8Array(buffer, offset, regionIdBytes.length);
      regionIdView.set(regionIdBytes);
      offset += regionIdBytes.length;
    } else {
      view.setUint32(offset, 0, true);
      offset += 4;
    }

    const deltaBytes = base64ToUint8(deltaTexture);
    view.setUint32(offset, deltaBytes.length, true);
    offset += 4;
    const deltaView = new Uint8Array(buffer, offset, deltaBytes.length);
    deltaView.set(deltaBytes);
    offset += deltaBytes.length;
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
  if (version !== 2 && version !== 3) throw new Error(`Unsupported version: ${version}`);

  const regionCount = dataView.getUint16(offset, true);
  offset += 2;
  const resolution = dataView.getUint32(offset, true);
  offset += 4;
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

    const blockFlags = version === 3 ? dataView.getUint16(offset, true) : 0;
    offset += version === 3 ? 2 : 0;

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
      const encoded = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      const totalPixels = bbox.w * bbox.h;
      const decoded = rleDecode8(encoded, totalPixels);
      regionIdTex = uint8ToBase64(decoded);
    }

    const deltaTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let deltaTex = '';
    if (deltaTexLen > 0) {
      const encoded = new Uint8Array(buffer, offset, deltaTexLen);
      offset += deltaTexLen;
      const totalPixels = bbox.w * bbox.h;
      const decoded16 = rleDecode16(encoded, totalPixels);

      const decoded8 = new Uint8Array(totalPixels * 3);
      for (let j = 0; j < totalPixels; j++) {
        const rgb565 = decoded16[j];
        const { s: encodedS, h: encodedH, l: encodedL } = unpackRGB565(rgb565);
        decoded8[j * 3] = encodedH;
        decoded8[j * 3 + 1] = encodedS;
        decoded8[j * 3 + 2] = encodedL;
      }
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
    resolution: [resolution, resolution],
    regionCount,
    regions,
    hueThreshold
  };
}