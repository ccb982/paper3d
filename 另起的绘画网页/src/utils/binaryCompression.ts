import type { CompressionResultV2, CompressedRegionV2 } from './colorCompressor';
import type { SharedBaseColor } from '../stores/useAppStore';
import type { FrameExportData } from './multiFrameExport';
import {
  compressToBinary as coreCompress,
  decompressFromBinary as coreDecompress,
  uint8ToBase64,
  base64ToUint8,
  rleEncode8,
  rleDecode8,
  rleEncode16,
  rleDecode16,
  packRGB565,
  unpackRGB565,
  quantizeH,
  quantizeS,
  quantizeL,
  dequantizeH,
  dequantizeS,
  dequantizeL,
  getAdaptiveBlockIndex,
  getRangeForBlock,
} from '../core/ftxCore';

function bakeBaseColor(base: { h: number; s: number; l: number }): { h: number; s: number; l: number } {
  return {
    h: base.h - 0.5,
    s: base.s - 1.0,
    l: base.l - 1.0
  };
}

export function compressToBinary(result: CompressionResultV2): Uint8Array {
  const { resolution, regions, hueThreshold } = result;

  const headerSize = 15;
  const buffers: Uint8Array[] = [];

  const headerBuf = new ArrayBuffer(headerSize);
  const headerView = new DataView(headerBuf);
  let offset = 0;
  headerView.setUint32(offset, 0x46545832, false);
  offset += 4;
  headerView.setUint8(offset, 3);
  offset += 1;
  headerView.setUint16(offset, regions.length, true);
  offset += 2;
  headerView.setUint32(offset, resolution[0], true);
  offset += 4;
  headerView.setFloat32(offset, hueThreshold, true);
  offset += 4;
  buffers.push(new Uint8Array(headerBuf));

  for (const region of regions) {
    const bbox = region.bbox;
    const baseColors = region.baseColors.map(bakeBaseColor);
    const regionIdTex = region.regionIdTexture ? base64ToUint8(region.regionIdTexture) : null;
    const deltaTex = base64ToUint8(region.deltaTexture);

    const colorCount = baseColors.length;
    const regionHeaderSize = 2 + 8 + 2 + 2 + colorCount * 12;
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

    rView.setUint16(rOffset, region.blockFlags ?? 0, true);
    rOffset += 2;

    for (const c of baseColors) {
      rView.setFloat32(rOffset, c.h, true);
      rOffset += 4;
      rView.setFloat32(rOffset, c.s, true);
      rOffset += 4;
      rView.setFloat32(rOffset, c.l, true);
      rOffset += 4;
    }
    buffers.push(new Uint8Array(regionHeader));

    if (regionIdTex && regionIdTex.length > 0) {
      const encoded = rleEncode8(regionIdTex);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, encoded.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(encoded);
    } else {
      buffers.push(new Uint8Array(4));
    }

    if (deltaTex && deltaTex.length > 0) {
      const totalPixels = bbox.w * bbox.h;
      const rgb565Data = new Uint16Array(totalPixels);

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 3;
        const encodedH = deltaTex[idx];
        const encodedS = deltaTex[idx + 1];
        const encodedL = deltaTex[idx + 2];

        rgb565Data[i] = packRGB565(encodedS, encodedH, encodedL);
      }

      const encoded = rleEncode16(rgb565Data);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, encoded.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(encoded);
    } else {
      buffers.push(new Uint8Array(4));
    }
  }

  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
  const finalBuffer = new Uint8Array(totalLength);
  let currentOffset = 0;
  for (const buf of buffers) {
    finalBuffer.set(buf, currentOffset);
    currentOffset += buf.length;
  }
  return finalBuffer;
}

export function decompressFromBinary(buffer: ArrayBuffer): CompressionResultV2 {
  const dataView = new DataView(buffer);
  let offset = 0;

  const magic = dataView.getUint32(offset, false);
  offset += 4;
  if (magic !== 0x46545832) throw new Error('无效的文件格式 (Magic 不匹配)');

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
      baseColors.push({ h: ((h % 1) + 1) % 1, s: Math.max(0, Math.min(1, s)), l: Math.max(0, Math.min(1, l)) });
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
    quantization: 'rgb565',
    hueThreshold,
  };
}

export async function compressToGzip(binaryData: Uint8Array): Promise<Blob> {
  const blob = new Blob([binaryData], { type: 'application/octet-stream' });
  const compressedStream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(compressedStream).blob();
}

export async function decompressFromGzip(file: File): Promise<ArrayBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const isGzipped = uint8Array.length >= 2 && uint8Array[0] === 0x1f && uint8Array[1] === 0x8b;

  if (isGzipped) {
    const blob = new Blob([uint8Array]);
    const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressedBlob = await new Response(decompressedStream).blob();
    return await decompressedBlob.arrayBuffer();
  }

  return arrayBuffer;
}

export {
  uint8ToBase64,
  base64ToUint8,
  rleEncode8,
  rleDecode8,
  rleEncode16,
  rleDecode16,
  packRGB565,
  unpackRGB565,
  quantizeH,
  quantizeS,
  quantizeL,
  dequantizeH,
  dequantizeS,
  dequantizeL,
  getAdaptiveBlockIndex,
  getRangeForBlock,
};

// ==================== 多帧 FTX 解包 ====================
export interface MultiFrameData {
  palette: SharedBaseColor[];
  frames: FrameExportData[];
}

/**
 * 解析 packMultiFrameToBinary 生成的二进制数据
 * 格式：Magic(4) + Version(1) + FrameCount(2) + PaletteCount(2) + Palette + Frames
 */
export function unpackMultiFrameFromBinary(buffer: ArrayBuffer): MultiFrameData {
  const view = new DataView(buffer);
  let offset = 0;

  console.log('[多帧解包] 开始解析，总长度:', buffer.byteLength, '字节');
  
  const magic = view.getUint32(offset, false);
  offset += 4;
  console.log('[多帧解包] 魔数:', magic.toString(16).toUpperCase(), '(预期: 46545833)');
  if (magic !== 0x46545833) {
    throw new Error('无效的多帧文件格式 (Magic 不匹配)');
  }

  const version = view.getUint8(offset);
  offset += 1;
  console.log('[多帧解包] 版本:', version, '(预期: 2)');
  if (version !== 2) {
    throw new Error(`不支持的多帧版本: ${version}`);
  }

  const frameCount = view.getUint16(offset, true);
  offset += 2;
  const paletteCount = view.getUint16(offset, true);
  offset += 2;
  console.log('[多帧解包] 帧数:', frameCount, '调色板数:', paletteCount);

  const palette: SharedBaseColor[] = [];
  for (let i = 0; i < paletteCount; i++) {
    palette.push({
      id: i + 1,
      h: view.getFloat32(offset, true),
      s: view.getFloat32(offset + 4, true),
      l: view.getFloat32(offset + 8, true),
      frameIds: [],
      area: 0,
    });
    offset += 12;
  }

  const frames: FrameExportData[] = [];
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset);
    offset += 1;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const name = new TextDecoder().decode(nameBytes);
    offset += nameLen;

    const width = view.getUint16(offset, true); offset += 2;
    const height = view.getUint16(offset, true); offset += 2;
    const bbox = {
      x: view.getUint16(offset, true),
      y: view.getUint16(offset, true),
      w: view.getUint16(offset, true),
      h: view.getUint16(offset, true),
    };
    offset += 8;

    const blockFlags = view.getUint16(offset, true);
    offset += 2;

    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    let regionIdTex: Uint8Array;
    if (regionIdTexLen > 0) {
      const encoded = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      regionIdTex = rleDecode8(encoded, bbox.w * bbox.h);
    } else {
      regionIdTex = new Uint8Array(0);
    }

    const deltaPackedLen = view.getUint32(offset, true);
    offset += 4;
    let deltaPacked: Uint16Array;
    if (deltaPackedLen > 0) {
      const encoded = new Uint8Array(buffer, offset, deltaPackedLen);
      offset += deltaPackedLen;
      deltaPacked = rleDecode16(encoded, bbox.w * bbox.h);
    } else {
      deltaPacked = new Uint16Array(0);
    }

    frames.push({ name, width, height, bbox, regionIdTex, deltaPacked, blockFlags });
  }

  return { palette, frames };
}