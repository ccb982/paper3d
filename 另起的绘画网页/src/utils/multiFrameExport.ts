import { applyDelta8, unpackRGB565 } from '../core/ftxCore';
import type { SharedBaseColor } from '../stores/useAppStore';

export interface FrameExportData {
  name: string;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
  regionIdTex: Uint16Array;
  deltaPacked: Uint16Array;
  blockFlags: bigint; // 64 位，每一位表示一个块的量化范围（1=窄，0=宽）
}

export function packMultiFrameToBinary(
  palette: SharedBaseColor[],
  frames: FrameExportData[],
  enablePrediction: boolean = true
): Uint8Array {
  // ★ 导出限制：多帧格式 regionIdTex 为 8bit（0 保留，id+1 编码 → 上限 254）。
  //   编辑器内允许 >255 颜色，但导出时若超出则明确报错，绝不静默截断
  //   （截断会导致 id 溢出 → 纹理变灰/花）。
  const exportMaxId = 254;
  let maxPaletteId = 0;
  for (const c of palette) {
    if (c.id > maxPaletteId) maxPaletteId = c.id;
  }
  if (palette.length > exportMaxId || maxPaletteId > exportMaxId) {
    throw new Error(
      `[多帧导出] 调色板 ${palette.length} 种颜色 / 最大 id ${maxPaletteId}，超过 8bit 格式上限 ${exportMaxId}。` +
      `请先使用"重新聚类/合并黑色"清理颜色后再导出（导出格式仅支持 254 色）。`
    );
  }

  // 头部：Magic(4) + Version(1) + PredictionFlag(1) + FrameCount(2) + PaletteCount(2)
  const headerSize = 4 + 1 + 1 + 2 + 2;
  let totalSize = headerSize;
  totalSize += palette.length * 12;

  // ===== 导出前 blockFlags 调试日志 =====
  console.log('========================================');
  console.log('[多帧导出] 开始打包，共', frames.length, '帧，预测:', enablePrediction ? '启用' : '禁用');
  console.log('========================================');
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    console.log(`[多帧导出] 帧 ${i} "${frame.name}" blockFlags = 0x${frame.blockFlags.toString(16).padStart(16, '0')}`);
    logBlockFlagsDetail(frame.blockFlags, frame.bbox);
  }

  const frameChunks: Uint8Array[] = [];
  let prevRegionIdTex: Uint16Array | null = null;
  let prevBboxW = 0, prevBboxH = 0;

  for (const frame of frames) {
    const { bbox, regionIdTex, deltaPacked, blockFlags, name, width, height } = frame;
    const nameBytes = new TextEncoder().encode(name);
    const totalPixels = bbox.w * bbox.h;

    // ----- 1. 帧间预测处理 -----
    const processedRegion = new Uint8Array(totalPixels);
    const canPredict = enablePrediction && prevRegionIdTex !== null &&
                        prevBboxW === bbox.w && prevBboxH === bbox.h;

    if (canPredict) {
      for (let i = 0; i < totalPixels; i++) {
        const id = regionIdTex[i];
        const prevId = prevRegionIdTex![i]; // 非空断言：canPredict 已保证不为 null
        if (id === prevId) {
          processedRegion[i] = 1;   // 标记相同
        } else {
          processedRegion[i] = id === 0 ? 0 : id + 1;
        }
      }
    } else {
      // 第一帧 或 不启用预测：直接偏移
      for (let i = 0; i < totalPixels; i++) {
        const id = regionIdTex[i];
        processedRegion[i] = id === 0 ? 0 : id + 1;
      }
    }

    // ----- 2. 行差分 -----
    const regionDiff = applyDelta8(processedRegion, bbox.w);

    // ----- 3. deltaPacked 处理（原有逻辑，不变）-----
    const hChannel = new Uint8Array(totalPixels);
    const sChannel = new Uint8Array(totalPixels);
    const lChannel = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const packed = deltaPacked[i];
      const { s, h, l } = unpackRGB565(packed);
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

    // ----- 4. 构建帧二进制块 -----
    let frameSize = 1 + nameBytes.length;          // 名称长度 + 名称
    frameSize += 2 + 2 + 2 + 2 + 2 + 2;           // width, height, bbox(4个)
    frameSize += 8;                               // blockFlags (64-bit)
    frameSize += 4 + regionDiff.length;           // regionIdTex 长度 + 数据
    frameSize += 4 + deltaDiffBytes.length;       // delta 长度 + 数据

    const frameBuf = new ArrayBuffer(frameSize);
    const view = new DataView(frameBuf);
    let offset = 0;
    view.setUint8(offset, nameBytes.length); offset += 1;
    new Uint8Array(frameBuf, offset, nameBytes.length).set(nameBytes); offset += nameBytes.length;
    view.setUint16(offset, width, true); offset += 2;
    view.setUint16(offset, height, true); offset += 2;
    view.setUint16(offset, bbox.x, true); offset += 2;
    view.setUint16(offset, bbox.y, true); offset += 2;
    view.setUint16(offset, bbox.w, true); offset += 2;
    view.setUint16(offset, bbox.h, true); offset += 2;
    view.setBigUint64(offset, blockFlags, true); offset += 8;
    view.setUint32(offset, regionDiff.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, regionDiff.length).set(regionDiff); offset += regionDiff.length;
    view.setUint32(offset, deltaDiffBytes.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, deltaDiffBytes.length).set(deltaDiffBytes); offset += deltaDiffBytes.length;

    frameChunks.push(new Uint8Array(frameBuf));
    totalSize += frameSize;

    // 保存当前原始 regionIdTex 供下一帧使用（未偏移、未预测）
    prevRegionIdTex = regionIdTex;
    prevBboxW = bbox.w;
    prevBboxH = bbox.h;
  }

  // ----- 5. 构建最终二进制 -----
  const finalBuffer = new Uint8Array(totalSize);
  let offset = 0;
  // Magic
  new DataView(finalBuffer.buffer).setUint32(offset, 0x46545833, false); offset += 4;
  // Version
  finalBuffer[offset++] = 0x03;
  // PredictionFlag
  finalBuffer[offset++] = enablePrediction ? 1 : 0;
  // FrameCount
  new DataView(finalBuffer.buffer).setUint16(offset, frames.length, true); offset += 2;
  // PaletteCount
  new DataView(finalBuffer.buffer).setUint16(offset, palette.length, true); offset += 2;

  // 写入调色板 (每个颜色 3 个 float32)
  for (const color of palette) {
    new DataView(finalBuffer.buffer).setFloat32(offset, color.h, true); offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.s, true); offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.l, true); offset += 4;
  }

  // 写入各帧
  for (const chunk of frameChunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  // ===== 导出后验证日志 =====
  console.log('========================================');
  console.log('[多帧导出] 打包完成，开始验证导出数据');
  console.log('========================================');
  
  // 解析刚刚打包的数据，验证 blockFlags 是否一致
  verifyPackedBlockFlags(finalBuffer, frames);

  return finalBuffer;
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

/**
 * 验证打包后的二进制数据中的 blockFlags 是否与原始数据一致
 */
function verifyPackedBlockFlags(buffer: Uint8Array, originalFrames: FrameExportData[]) {
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // 跳过头部（版本3：Magic(4) + Version(1) + PredictionFlag(1) + FrameCount(2) + PaletteCount(2)）
  view.getUint32(offset, false); offset += 4; // magic
  view.getUint8(offset); offset += 1; // version
  view.getUint8(offset); offset += 1; // predictionFlag
  const frameCount = view.getUint16(offset, true); offset += 2;
  const paletteCount = view.getUint16(offset, true); offset += 2;

  // 跳过调色板
  offset += paletteCount * 12;

  let allMatch = true;
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset); offset += 1;
    offset += nameLen; // 跳过名称

    offset += 2; // width
    offset += 2; // height
    offset += 2; // bbox.x
    offset += 2; // bbox.y
    offset += 2; // bbox.w
    offset += 2; // bbox.h

    // 读取打包后的 blockFlags（64 位，8 字节）
    const packedBlockFlags = view.getBigUint64(offset, true); offset += 8;

    // 跳过 regionIdTex
    const regionIdTexLen = view.getUint32(offset, true); offset += 4;
    offset += regionIdTexLen;

    // 跳过 deltaPacked
    const deltaPackedLen = view.getUint32(offset, true); offset += 4;
    offset += deltaPackedLen;

    // 对比
    const original = originalFrames[f];
    const match = packedBlockFlags === original.blockFlags;
    
    console.log(`[验证] 帧 ${f} "${original.name}":`);
    console.log(`       原始 blockFlags = 0x${original.blockFlags.toString(16).padStart(16, '0')}`);
    console.log(`       打包后 blockFlags = 0x${packedBlockFlags.toString(16).padStart(16, '0')}`);
    console.log(`       匹配: ${match ? '✅ 一致' : '❌ 不一致'}`);
    
    if (!match) {
      allMatch = false;
      console.error(`[错误] 帧 ${f} 的 blockFlags 不一致！`);
    }
  }

  console.log('========================================');
  console.log(allMatch ? '[验证结果] ✅ 所有帧的 blockFlags 验证通过！' : '[验证结果] ❌ 存在 blockFlags 不一致的帧！');
  console.log('========================================');
}
