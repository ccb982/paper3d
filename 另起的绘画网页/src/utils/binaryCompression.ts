import type { CompressionResultV2, CompressedRegionV2 } from './colorCompressor';
import type { SharedBaseColor } from '../stores/useAppStore';
import type { FrameExportData } from './multiFrameExport';
import {
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
  applyDelta8,
  invertDelta8,
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

    rView.setUint16(rOffset, Number(region.blockFlags ?? 0n) & 0xFFFF, true);
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
      // 差分替代 RLE
      const regionDiff = applyDelta8(regionIdTex, bbox.w);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, regionDiff.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(regionDiff);
    } else {
      buffers.push(new Uint8Array(4));
    }

    if (deltaTex && deltaTex.length > 0) {
      const totalPixels = bbox.w * bbox.h;
      
      // deltaTex 为连接格式：H...H S...S L...L（每个通道 totalPixels 字节）
      const hChannel = deltaTex.slice(0, totalPixels);
      const sChannel = deltaTex.slice(totalPixels, totalPixels * 2);
      const lChannel = deltaTex.slice(totalPixels * 2, totalPixels * 3);

      // 分别做行差分
      const hDiff = applyDelta8(hChannel, bbox.w);
      const sDiff = applyDelta8(sChannel, bbox.w);
      const lDiff = applyDelta8(lChannel, bbox.w);

      // 合并写入
      const deltaDiffBytes = new Uint8Array(hDiff.length + sDiff.length + lDiff.length);
      deltaDiffBytes.set(hDiff, 0);
      deltaDiffBytes.set(sDiff, hDiff.length);
      deltaDiffBytes.set(lDiff, hDiff.length + sDiff.length);

      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, deltaDiffBytes.length, true);
      buffers.push(new Uint8Array(lenBuf));
      buffers.push(deltaDiffBytes);
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

    const blockFlags = version === 3 ? BigInt(dataView.getUint16(offset, true)) : 0n;
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
 * 格式：Magic(4) + Version(1) + PredictionFlag(1) + FrameCount(2) + PaletteCount(2) + Palette + Frames
 */
export function unpackMultiFrameFromBinary(buffer: ArrayBuffer): MultiFrameData {
  const view = new DataView(buffer);
  let offset = 0;

  console.log('========================================');
  console.log('[多帧解包] 开始解析，总长度:', buffer.byteLength, '字节');
  console.log('========================================');
  
  const magic = view.getUint32(offset, false);
  offset += 4;
  console.log('[多帧解包] 魔数:', magic.toString(16).toUpperCase(), '(预期: 46545833)');
  if (magic !== 0x46545833) {
    throw new Error('无效的多帧文件格式 (Magic 不匹配)');
  }

  const version = view.getUint8(offset);
  offset += 1;
  console.log('[多帧解包] 版本:', version, '(预期: 3)');
  if (version !== 3) {
    throw new Error(`不支持的多帧版本: ${version}，当前仅支持版本3`);
  }

  // PredictionFlag
  const predictionFlag = view.getUint8(offset);
  offset += 1;
  const enablePrediction = predictionFlag === 1;
  console.log('[多帧解包] 预测标志:', predictionFlag, '(启用:', enablePrediction, ')');

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
  let prevDecodedRegion: Uint8Array | null = null;

  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset);
    offset += 1;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const name = new TextDecoder().decode(nameBytes);
    offset += nameLen;

    const width = view.getUint16(offset, true); offset += 2;
    const height = view.getUint16(offset, true); offset += 2;
    const bboxX = view.getUint16(offset, true); offset += 2;
    const bboxY = view.getUint16(offset, true); offset += 2;
    const bboxW = view.getUint16(offset, true); offset += 2;
    const bboxH = view.getUint16(offset, true); offset += 2;
    const bbox = { x: bboxX, y: bboxY, w: bboxW, h: bboxH };

    const blockFlags = view.getBigUint64(offset, true);
    offset += 8;

    // ===== blockFlags 详细日志 =====
    console.log(`[多帧解包] 帧 ${f} "${name}" blockFlags = 0x${blockFlags.toString(16).padStart(16, '0')}`);
    logBlockFlagsDetail(blockFlags, bbox);

    // 读取 regionIdTex
    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    let regionIdTex: Uint8Array;
    if (regionIdTexLen > 0) {
      const regionDiff = new Uint8Array(buffer, offset, regionIdTexLen);
      offset += regionIdTexLen;
      // 逆差分还原得到 processedRegion
      const processedRegion = invertDelta8(regionDiff, bbox.w);
      
      // 根据预测标志和帧序号还原真实 ID
      if (!enablePrediction) {
        // 未启用预测：直接反向偏移 (val-1)
        regionIdTex = new Uint8Array(processedRegion.length);
        for (let i = 0; i < processedRegion.length; i++) {
          const val = processedRegion[i];
          regionIdTex[i] = val === 0 ? 0 : val - 1;
        }
      } else {
        // 启用预测：需要帧间还原
        if (prevDecodedRegion === null) {
          // 第一帧：仅反向偏移
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
              // 与上一帧相同
              regionIdTex[i] = prevDecodedRegion[i];
            } else {
              regionIdTex[i] = val === 0 ? 0 : val - 1;
            }
          }
        }
        prevDecodedRegion = regionIdTex; // 保存当前还原后的帧
      }
    } else {
      regionIdTex = new Uint8Array(0);
    }

    // 读取 deltaPacked
    const deltaPackedLen = view.getUint32(offset, true);
    offset += 4;
    let deltaPacked: Uint16Array;
    if (deltaPackedLen > 0) {
      const deltaBytes = new Uint8Array(buffer, offset, deltaPackedLen);
      offset += deltaPackedLen;
      const totalPixels = bbox.w * bbox.h;
      // 拆分三个通道的差分数据并逆差分还原
      const hDiff = deltaBytes.slice(0, totalPixels);
      const sDiff = deltaBytes.slice(totalPixels, totalPixels * 2);
      const lDiff = deltaBytes.slice(totalPixels * 2, totalPixels * 3);
      const hChannel = invertDelta8(hDiff, bbox.w);
      const sChannel = invertDelta8(sDiff, bbox.w);
      const lChannel = invertDelta8(lDiff, bbox.w);
      // 重新打包成 RGB565
      deltaPacked = new Uint16Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        deltaPacked[i] = packRGB565(sChannel[i], hChannel[i], lChannel[i]);
      }
    } else {
      deltaPacked = new Uint16Array(0);
    }

    frames.push({ name, width, height, bbox, regionIdTex, deltaPacked, blockFlags });
  }

  console.log('========================================');
  console.log('[多帧解包] 解析完成，共', frames.length, '帧');
  console.log('========================================');

  return { palette, frames };
}

// ============================================================
// 墙体掩码位图工具（1 bit / 像素，LSB-first，与 FluidEditor.getObstacleBitmap 对称）
// ============================================================

/**
 * 将墙体像素数组打包为 1 bit/像素 位图（LSB-first，与 getObstacleBitmap 同约定）。
 * pixels: Uint8Array(width*height)，0=空，非0=墙体。
 */
export function packPixelsToBitmask(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const byteLength = Math.ceil((width * height) / 8);
  const bitmap = new Uint8Array(byteLength);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]) {
        const pixelIndex = y * width + x;
        const byteIndex = Math.floor(pixelIndex / 8);
        const bitIndex = pixelIndex % 8;
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }
  }
  return bitmap;
}

/**
 * 将 1 bit/像素 位图解包为像素数组（Uint8Array(width*height)，0=空，255=墙体）。
 * 与 getObstacleBitmap / packPixelsToBitmask 的打包顺序严格对称。
 */
export function unpackBitmaskToPixels(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const byte = bitmap[Math.floor(i / 8)];
    if (byte & (1 << (i % 8))) pixels[i] = 255;
  }
  return pixels;
}

/**
 * 墙体掩码最近邻缩放到目标分辨率（与 config.resolution 对齐时避免 UV 采样错位）。
 */
export function rescaleBitmaskPixels(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return pixels;
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(Math.floor((y * srcH) / dstH), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor((x * srcW) / dstW), srcW - 1);
      out[y * dstW + x] = pixels[sy * srcW + sx];
    }
  }
  return out;
}

/**
 * 详细打印 blockFlags 的每一位含义
 * blockFlags 是一个 64 位 bigint，每一位代表一个 8x8 分块的量化范围
 * 1 = 0.25 范围, 0 = 0.5 范围
 */
function logBlockFlagsDetail(blockFlags: bigint, bbox: { x: number; y: number; w: number; h: number }) {
  const ADAPTIVE_BLOCK_COLS = 8;
  const ADAPTIVE_BLOCK_ROWS = 8;
  const ADAPTIVE_TOTAL_BLOCKS = ADAPTIVE_BLOCK_COLS * ADAPTIVE_BLOCK_ROWS;

  let detailStr = '[blockFlags 详细信息]\n';
  detailStr += `  BBox: x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}\n`;
  detailStr += `  分块网格: ${ADAPTIVE_BLOCK_COLS}x${ADAPTIVE_BLOCK_ROWS} = ${ADAPTIVE_TOTAL_BLOCKS} 块\n`;
  detailStr += '  每块量化范围:\n';
  
  let smallRangeCount = 0;
  let largeRangeCount = 0;
  
  for (let row = 0; row < ADAPTIVE_BLOCK_ROWS; row++) {
    let line = '    ';
    for (let col = 0; col < ADAPTIVE_BLOCK_COLS; col++) {
      const blockIdx = row * ADAPTIVE_BLOCK_COLS + col;
      const hasSmallRange = (blockFlags & (1n << BigInt(blockIdx))) !== 0n;
      if (hasSmallRange) {
        line += '●'; // 0.25 范围
        smallRangeCount++;
      } else {
        line += '○'; // 0.5 范围
        largeRangeCount++;
      }
    }
    detailStr += line + '\n';
  }
  
  detailStr += `  统计: 小范围(0.25) = ${smallRangeCount} 块, 大范围(0.5) = ${largeRangeCount} 块\n`;
  detailStr += `  二进制: 0b${blockFlags.toString(2).padStart(64, '0').slice(-64)}`;
  
  console.log(detailStr);
}