import type { CompressionResultV2, CompressedRegionV2 } from './colorCompressor';

// ---------- 常量定义 ----------
const MAGIC = 0x46545832; // "FTX2"
const VERSION = 2;

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
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------- RLE 编码器 ----------
function rleEncode(data: Uint8Array, bytesPerPixel: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];

  let i = 0;
  const len = data.length;
  const step = bytesPerPixel;

  while (i < len) {
    let runStart = i;
    const pixel = data.slice(i, i + step);
    i += step;

    // 计算连续相同的像素数量（最大 65535）
    let count = 1;
    while (i < len && count < 65535) {
      let match = true;
      for (let j = 0; j < step; j++) {
        if (data[i + j] !== pixel[j]) {
          match = false;
          break;
        }
      }
      if (!match) break;
      count++;
      i += step;
    }

    // 写入 [count (Uint32)] + [pixel bytes]
    const countBuf = new Uint8Array(4);
    new DataView(countBuf.buffer).setUint32(0, count, true); // 小端序
    const chunk = new Uint8Array(4 + pixel.length);
    chunk.set(countBuf, 0);
    chunk.set(pixel, 4);

    chunks.push(chunk);
  }

  // 拼接所有 chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ---------- RLE 解码器 ----------
function rleDecode(encodedData: Uint8Array, bytesPerPixel: number, expectedPixelCount: number): Uint8Array {
  if (encodedData.length === 0) return new Uint8Array(0);

  const result = new Uint8Array(expectedPixelCount * bytesPerPixel);
  let readOffset = 0;
  let writeOffset = 0;
  const dataView = new DataView(encodedData.buffer, encodedData.byteOffset, encodedData.byteLength);

  while (readOffset < encodedData.length) {
    // 读取长度 (Uint32, Little Endian)
    const count = dataView.getUint32(readOffset, true);
    readOffset += 4;

    // 读取像素值
    const pixel = encodedData.slice(readOffset, readOffset + bytesPerPixel);
    readOffset += bytesPerPixel;

    // 填充到目标数组
    for (let i = 0; i < count; i++) {
      result.set(pixel, writeOffset);
      writeOffset += bytesPerPixel;
    }
  }
  return result;
}

// ---------- 核心：压缩 V2 结果为二进制 ----------
export function compressToBinary(result: CompressionResultV2): Uint8Array {
  const { resolution, regions, hueThreshold } = result;
  const res = resolution[0]; // 假设是正方形

  // Header 大小：Magic(4) + Ver(1) + Count(2) + Res(4) + Threshold(4)
  const headerSize = 15;
  const buffers: Uint8Array[] = [];

  // 写入 Header（魔数用大端序保证 "FTX2"，其余字段用小端序）
    const headerBuf = new ArrayBuffer(headerSize);
    const headerView = new DataView(headerBuf);
    let offset = 0;
    headerView.setUint32(offset, MAGIC, false); // 大端序：0x46 0x54 0x58 0x32 = "FTX2"
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
    const baseColors = region.baseColors;
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

    // 写入 BaseColors (Float32 * 3)
    for (const c of baseColors) {
      rView.setFloat32(rOffset, c.h, true);
      rOffset += 4;
      rView.setFloat32(rOffset, c.s, true);
      rOffset += 4;
      rView.setFloat32(rOffset, c.l, true);
      rOffset += 4;
    }
    buffers.push(new Uint8Array(regionHeader));

    // ---- 编码 RegionIdTex (RLE) ----
    if (regionIdTex && regionIdTex.length > 0) {
      const encoded = rleEncode(regionIdTex, 1);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, encoded.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(encoded);
    } else {
      buffers.push(new Uint8Array(4)); // 长度 0
    }

    // ---- 编码 DeltaTex (RLE) ----
    if (deltaTex && deltaTex.length > 0) {
      const encoded = rleEncode(deltaTex, 3);
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

// ---------- 核心：从二进制解压回 CompressionResultV2 ----------
export function decompressFromBinary(buffer: ArrayBuffer): CompressionResultV2 {
  const dataView = new DataView(buffer);
  let offset = 0;

  // 校验 Magic（大端序）
  const magic = dataView.getUint32(offset, false);
  offset += 4;
  if (magic !== MAGIC) throw new Error('无效的文件格式 (Magic 不匹配)');

  const version = dataView.getUint8(offset);
  offset += 1;
  if (version !== VERSION) throw new Error(`不支持的版本: ${version}`);

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

    const baseColors: Array<{ h: number; s: number; l: number }> = [];
    for (let j = 0; j < colorCount; j++) {
      const h = dataView.getFloat32(offset, true);
      offset += 4;
      const s = dataView.getFloat32(offset, true);
      offset += 4;
      const l = dataView.getFloat32(offset, true);
      offset += 4;
      baseColors.push({ h, s, l });
    }

    // 读取 RLE RegionIdTex
    const regionIdTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let regionIdTex: string | undefined = undefined;
    if (regionIdTexLen > 0) {
      const encoded = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      const totalPixels = bbox.w * bbox.h;
      const decoded = rleDecode(encoded, 1, totalPixels);
      regionIdTex = uint8ToBase64(decoded);
    }

    // 读取 RLE DeltaTex
    const deltaTexLen = dataView.getUint32(offset, true);
    offset += 4;
    let deltaTex = '';
    if (deltaTexLen > 0) {
      const encoded = new Uint8Array(buffer, offset, deltaTexLen);
      offset += deltaTexLen;
      const totalPixels = bbox.w * bbox.h;
      const decoded = rleDecode(encoded, 3, totalPixels);
      deltaTex = uint8ToBase64(decoded);
    }

    regions.push({
      id,
      bbox,
      baseColors,
      regionIdTexture: regionIdTex,
      deltaTexture: deltaTex,
    });
  }

  return {
    version: 2,
    resolution: [resolution, resolution],
    regionCount,
    regions,
    quantization: 'uint8',
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
