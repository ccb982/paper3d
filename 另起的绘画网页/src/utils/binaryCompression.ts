import type { CompressionResultV2, CompressedRegionV2 } from './colorCompressor';

// ---------- 常量定义 ----------
const MAGIC = 0x46545832; // "FTX2"
const VERSION = 3;

// ---------- 辅助：Base64 转 Uint8Array ----------
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------- Uint8Array 转 Base64 ----------
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------- FTX 2.0 量化函数 ----------
// H: -0.5 ~ +0.5 → 0 ~ 63 (6位)
// S: -1.0 ~ +1.0 → 0 ~ 31 (5位)
// L: -1.0 ~ +1.0 → 0 ~ 31 (5位)
export function quantizeH(dH: number): number {
  return Math.round((dH + 0.5) * 63);
}

export function quantizeS(dS: number): number {
  return Math.round((dS + 1.0) * 15.5);
}

export function quantizeL(dL: number): number {
  return Math.round((dL + 1.0) * 15.5);
}

// ---------- FTX 2.0 反量化函数 ----------
export function dequantizeH(encoded: number): number {
  return (encoded / 63) - 0.5;
}

export function dequantizeS(encoded: number): number {
  return (encoded / 15.5) - 1.0;
}

export function dequantizeL(encoded: number): number {
  return (encoded / 15.5) - 1.0;
}

// ---------- RGB565 打包/解包 ----------
// 打包：(S << 11) | (H << 5) | L
function packRGB565(s: number, h: number, l: number): number {
  return ((s & 0x1F) << 11) | ((h & 0x3F) << 5) | (l & 0x1F);
}

function unpackRGB565(packed: number): { s: number; h: number; l: number } {
  return {
    s: (packed >> 11) & 0x1F,
    h: (packed >> 5) & 0x3F,
    l: packed & 0x1F
  };
}

// ---------- RLE 编码器 (针对 RGB565 格式，2字节/像素) ----------
function rleEncode16(data: Uint16Array): Uint8Array {
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

    // 写入 [count (Uint16)] + [pixel (Uint16)] → 4字节/块
    const chunk = new Uint8Array(4);
    const view = new DataView(chunk.buffer);
    view.setUint16(0, count, true);   // 小端序
    view.setUint16(2, pixel, true);   // 小端序
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

// ---------- RLE 解码器 (针对 RGB565 格式) ----------
function rleDecode16(encodedData: Uint8Array, expectedPixelCount: number): Uint16Array {
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

// ---------- RLE 编码器 (针对 regionId，1字节/像素) ----------
function rleEncode8(data: Uint8Array): Uint8Array {
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

    // 写入 [count (Uint16)] + [pixel (Uint8)] → 3字节/块
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

// ---------- RLE 解码器 (针对 regionId，1字节/像素) ----------
function rleDecode8(encodedData: Uint8Array, expectedPixelCount: number): Uint8Array {
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

// ---------- 基础色偏置烘焙 (FTX 2.0 核心优化) ----------
// Base_Shifted = (Base_H - 0.5, Base_S - 1.0, Base_L - 1.0)
function bakeBaseColor(base: { h: number; s: number; l: number }): { h: number; s: number; l: number } {
  return {
    h: base.h - 0.5,
    s: base.s - 1.0,
    l: base.l - 1.0
  };
}

// ---------- 核心：压缩 V2 结果为 FTX 2.0 二进制 ----------
export function compressToBinary(result: CompressionResultV2): Uint8Array {
  const { resolution, regions, hueThreshold } = result;
  const res = resolution[0];

  // Header 大小：Magic(4) + Ver(1) + Count(2) + Res(4) + Threshold(4) = 15
  const headerSize = 15;
  const buffers: Uint8Array[] = [];

  // 写入 Header（魔数用大端序保证 "FTX2"，其余字段用小端序）
  const headerBuf = new ArrayBuffer(headerSize);
  const headerView = new DataView(headerBuf);
  let offset = 0;
  headerView.setUint32(offset, MAGIC, false); // 大端序
  offset += 4;
  headerView.setUint8(offset, VERSION);
  offset += 1;
  headerView.setUint16(offset, regions.length, true);
  offset += 2;
  headerView.setUint32(offset, res, true);
  offset += 4;
  headerView.setFloat32(offset, hueThreshold, true);
  offset += 4;
  buffers.push(new Uint8Array(headerBuf));

  // 循环写入 Region
  for (const region of regions) {
    const bbox = region.bbox;
    const baseColors = region.baseColors.map(bakeBaseColor); // 偏置烘焙
    const regionIdTex = region.regionIdTexture ? base64ToUint8(region.regionIdTexture) : null;
    const deltaTex = base64ToUint8(region.deltaTexture);

    // Region Header: ID(2) + BBox(8) + ColorCount(2) + Colors(N * 12)
    const colorCount = baseColors.length;
    const regionHeaderSize = 2 + 8 + 2 + colorCount * 12;
    const regionHeader = new ArrayBuffer(regionHeaderSize);
    const rView = new DataView(regionHeader);
    let rOffset = 0;

    rView.setUint16(rOffset, region.id, true);
    rOffset += 2;
    rView.setUint16(rOffset, bbox.x, true);
    rOffset += 2;
    rView.setUint16(rOffset, bbox.y, true);
    rOffset += 2;
    rView.setUint16(rOffset, bbox.w, true);
    rOffset += 2;
    rView.setUint16(rOffset, bbox.h, true);
    rOffset += 2;
    rView.setUint16(rOffset, colorCount, true);
    rOffset += 2;

    // 写入 blockFlags (2字节，仅 V3+)
    rView.setUint16(rOffset, region.blockFlags ?? 0, true);
    rOffset += 2;

    // 写入偏置后的 BaseColors (Float32 * 3)
    for (const c of baseColors) {
      rView.setFloat32(rOffset, c.h, true);  // Base_H - 0.5
      rOffset += 4;
      rView.setFloat32(rOffset, c.s, true);  // Base_S - 1.0
      rOffset += 4;
      rView.setFloat32(rOffset, c.l, true);  // Base_L - 1.0
      rOffset += 4;
    }
    buffers.push(new Uint8Array(regionHeader));

    // ---- 编码 RegionIdTex (RLE，1字节/像素) ----
    if (regionIdTex && regionIdTex.length > 0) {
      const encoded = rleEncode8(regionIdTex);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, encoded.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(encoded);
    } else {
      buffers.push(new Uint8Array(4)); // 长度 0
    }

    // ---- 编码 DeltaTex (先转换为 RGB565，再 RLE) ----
    if (deltaTex && deltaTex.length > 0) {
      // deltaTex 已经是 FTX 2.0 量化格式：dH(0~63), dS(0~31), dL(0~31)
      // 直接打包为 RGB565 格式：(S << 11) | (H << 5) | L
      const totalPixels = bbox.w * bbox.h;
      const rgb565Data = new Uint16Array(totalPixels);
      
      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 3;
        // 直接读取 FTX 2.0 量化值
        const encodedH = deltaTex[idx];     // 0~63
        const encodedS = deltaTex[idx + 1]; // 0~31
        const encodedL = deltaTex[idx + 2]; // 0~31
        
        // 打包为 RGB565
        rgb565Data[i] = packRGB565(encodedS, encodedH, encodedL);
      }
      
      const encoded = rleEncode16(rgb565Data);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, encoded.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(encoded);
    } else {
      buffers.push(new Uint8Array(4)); // 长度 0
    }
  }

  // 拼接所有 Uint8Array
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
  const finalBuffer = new Uint8Array(totalLength);
  let currentOffset = 0;
  for (const buf of buffers) {
    finalBuffer.set(buf, currentOffset);
    currentOffset += buf.length;
  }
  return finalBuffer;
}

// ---------- 核心：从 FTX 2.0 二进制解压回 CompressionResultV2 ----------
export function decompressFromBinary(buffer: ArrayBuffer): CompressionResultV2 {
  const dataView = new DataView(buffer);
  let offset = 0;

  // 校验 Magic（大端序）
  const magic = dataView.getUint32(offset, false);
  offset += 4;
  if (magic !== MAGIC) throw new Error('无效的文件格式 (Magic 不匹配)');

  const version = dataView.getUint8(offset);
  offset += 1;
  if (version !== 2 && version !== 3) throw new Error(`不支持的版本: ${version}`);

  const regionCount = dataView.getUint16(offset, true);
  offset += 2;
  const resolution = dataView.getUint32(offset, true);
  offset += 4;
  const hueThreshold = dataView.getFloat32(offset, true);
  offset += 4;

  const regions: CompressedRegionV2[] = [];

  for (let i = 0; i < regionCount; i++) {
    // 读取 Region Header
    const id = dataView.getUint16(offset, true);
    offset += 2;
    const bbox = {
      x: dataView.getUint16(offset, true),
      y: dataView.getUint16(offset, true),
      w: dataView.getUint16(offset, true),
      h: dataView.getUint16(offset, true),
    };
    offset += 8;
    const colorCount = dataView.getUint16(offset, true);
    offset += 2;

    // 读取 blockFlags (2字节，仅 V3+)
    const blockFlags = version === 3 ? dataView.getUint16(offset, true) : 0;
    offset += version === 3 ? 2 : 0;

    // 读取偏置后的基础色，然后还原
    const baseColors: Array<{ h: number; s: number; l: number }> = [];
    for (let j = 0; j < colorCount; j++) {
      const h = dataView.getFloat32(offset, true) + 0.5; // Base_Shifted.h + 0.5 = Base_H
      offset += 4;
      const s = dataView.getFloat32(offset, true) + 1.0; // Base_Shifted.s + 1.0 = Base_S
      offset += 4;
      const l = dataView.getFloat32(offset, true) + 1.0; // Base_Shifted.l + 1.0 = Base_L
      offset += 4;
      baseColors.push({ h: (h + 1) % 1, s: Math.max(0, Math.min(1, s)), l: Math.max(0, Math.min(1, l)) });
    }

    // 读取 RLE RegionIdTex (1字节/像素)
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

    // 读取 RLE DeltaTex (RGB565，2字节/像素)
    const deltaTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let deltaTex = '';
    if (deltaTexLen > 0) {
      const encoded = new Uint8Array(buffer, offset, deltaTexLen);
      offset += deltaTexLen;
      const totalPixels = bbox.w * bbox.h;
      const decoded16 = rleDecode16(encoded, totalPixels);
      
      // RGB565 转换回 FTX 2.0 量化格式的 uint8 (dH:0~63, dS:0~31, dL:0~31)
      const decoded8 = new Uint8Array(totalPixels * 3);
      for (let j = 0; j < totalPixels; j++) {
        const rgb565 = decoded16[j];
        const { s: encodedS, h: encodedH, l: encodedL } = unpackRGB565(rgb565);
        
        // 直接使用 FTX 2.0 量化值（0~63/0~31），无需反量化
        decoded8[j * 3] = encodedH;     // 0~63
        decoded8[j * 3 + 1] = encodedS; // 0~31
        decoded8[j * 3 + 2] = encodedL; // 0~31
      }
      deltaTex = uint8ToBase64(decoded8);
    }

    regions.push({
      id,
      bbox,
      baseColors,
      regionIdTexture: regionIdTex,
      deltaTexture: deltaTex,
      blockFlags,
    });
  }

  return {
    version: version as 3,
    resolution: [resolution, resolution],
    regionCount,
    regions,
    quantization: 'rgb565', // 标记为 RGB565 格式
    hueThreshold,
  };
}

// ---------- 导出 Gzip 压缩 ----------
export async function compressToGzip(binaryData: Uint8Array): Promise<Blob> {
  const blob = new Blob([binaryData], { type: 'application/octet-stream' });
  const compressedStream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(compressedStream).blob();
}

// ---------- 导入 Gzip 解压 ----------
export async function decompressFromGzip(file: File): Promise<ArrayBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 检查是否为 Gzip (Magic: 0x1F 0x8B)
  const isGzipped = uint8Array.length >= 2 && uint8Array[0] === 0x1f && uint8Array[1] === 0x8b;

  if (isGzipped) {
    const blob = new Blob([uint8Array]);
    const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressedBlob = await new Response(decompressedStream).blob();
    return await decompressedBlob.arrayBuffer();
  }

  return arrayBuffer;
}
