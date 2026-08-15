import * as THREE from 'three';
import type { FrameTextureData, PaletteColor } from './types';

function invertDelta8(filtered: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    if (i % stride === 0) out[i] = filtered[i];
    else out[i] = filtered[i] + out[i - 1];
  }
  return out;
}

function unpackRGB565(packed: number): { s: number; h: number; l: number } {
  return { s: (packed >> 11) & 0x1F, h: (packed >> 5) & 0x3F, l: packed & 0x1F };
}

export interface DecodedMultiFrame {
  palette: PaletteColor[];
  frames: FrameTextureData[];
}

export function decodeMultiFrame(buffer: ArrayBuffer): DecodedMultiFrame {
  const view = new DataView(buffer);
  let offset = 0;

  const magic = view.getUint32(offset, false);
  offset += 4;
  if (magic !== 0x46545833) throw new Error('无效的 FTX3 格式 (Magic 不匹配)');

  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 3) throw new Error(`不支持的 FTX 版本: ${version}`);

  const predictionFlag = view.getUint8(offset);
  offset += 1;
  const enablePrediction = predictionFlag === 1;

  const frameCount = view.getUint16(offset, true);
  offset += 2;
  const paletteCount = view.getUint16(offset, true);
  offset += 2;

  const palette: PaletteColor[] = [];
  for (let i = 0; i < paletteCount; i++) {
    palette.push({
      h: view.getFloat32(offset, true),
      s: view.getFloat32(offset + 4, true),
      l: view.getFloat32(offset + 8, true),
    });
    offset += 12;
  }

  const frames: FrameTextureData[] = [];
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

    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    let regionIdTex: Uint8Array;
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
    let deltaPacked: Uint16Array;
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
        deltaPacked[i] = ((sChannel[i] & 0x1F) << 11) | ((hChannel[i] & 0x3F) << 5) | (lChannel[i] & 0x1F);
      }
    } else {
      deltaPacked = new Uint16Array(0);
    }

    frames.push({ name, width, height, bbox, regionIdTex, deltaPacked, blockFlags });
  }

  return { palette, frames };
}

export function buildBaseHslData(
  frame: FrameTextureData,
  palette: PaletteColor[],
): { data: Float32Array; width: number; height: number } | null {
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
      data[idx4 + 3] = 1.0;
    }
  }

  return { data, width: w, height: h };
}

/**
 * 生成残差纹理（Uint8，每通道 1 字节，统一 0.5 范围）。
 * 0.25 范围的块转换为 0.5 等价值（与编辑器 adjustResidualForUniformRange 一致）：
 *   8bit 空间: val' = val * 0.5 + 64
 * 这样 GPU shader 统一按 range=0.5 反量化，残差可参与通道平流。
 */
export function buildResidualData(
  frame: FrameTextureData,
): { data: Uint8Array; width: number; height: number } | null {
  const { bbox, deltaPacked, blockFlags } = frame;
  const w = bbox.w;
  const h = bbox.h;
  if (w === 0 || h === 0) return null;

  const totalPixels = w * h;
  const data = new Uint8Array(totalPixels * 4);

  if (deltaPacked.length === 0) {
    // 无残差：值填中间（0.5 表示 delta=0）
    for (let i = 3; i < data.length; i += 4) data[i] = 128;
    return { data, width: w, height: h };
  }

  for (let i = 0; i < totalPixels; i++) {
    const idx4 = i * 4;
    const packed = deltaPacked[i];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);

    // 每块实际 range
    const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
    const isSmall = (blockFlags & (1n << BigInt(blockIdx))) !== 0n;

    // 8bit 归一化：qH(0-63)→0-255, qS/qL(0-31)→0-255
    let r8 = Math.round((qH / 63) * 255);
    let g8 = Math.round((qS / 31) * 255);
    let b8 = Math.round((qL / 31) * 255);

    if (isSmall) {
      // 0.25 范围块 → 统一 0.5 范围等价转换（8bit: val' = val*0.5 + 64）
      r8 = Math.round(r8 * 0.5 + 64);
      g8 = Math.round(g8 * 0.5 + 64);
      b8 = Math.round(b8 * 0.5 + 64);
    }

    data[idx4] = r8;
    data[idx4 + 1] = g8;
    data[idx4 + 2] = b8;
    // ★ alpha 通道必须为中性 128（delta=0）——255 → dA=+0.5，
    //   流体合成区域外 finalA=0.5 不触发丢弃 → 半透明黑边（编辑器不用 dA 所以正常）
    data[idx4 + 3] = 128;
  }

  return { data, width: w, height: h };
}

export function buildFrameTexture(
  frame: FrameTextureData,
  palette: PaletteColor[],
): { base: THREE.DataTexture; residual: THREE.DataTexture } {
  const baseHsl = buildBaseHslData(frame, palette);
  const residual = buildResidualData(frame);
  if (!baseHsl || !residual) throw new Error('无法构建 HSL/残差数据');

  const baseTex = new THREE.DataTexture(
    baseHsl.data, baseHsl.width, baseHsl.height,
    THREE.RGBAFormat, THREE.FloatType,
  );
  baseTex.flipY = false;
  baseTex.needsUpdate = true;
  baseTex.minFilter = THREE.NearestFilter;
  baseTex.magFilter = THREE.NearestFilter;
  baseTex.wrapS = THREE.ClampToEdgeWrapping;
  baseTex.wrapT = THREE.ClampToEdgeWrapping;

  const resTex = new THREE.DataTexture(
    residual.data, residual.width, residual.height,
    THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  resTex.flipY = false;
  resTex.needsUpdate = true;
  resTex.minFilter = THREE.NearestFilter;
  resTex.magFilter = THREE.NearestFilter;
  resTex.wrapS = THREE.ClampToEdgeWrapping;
  resTex.wrapT = THREE.ClampToEdgeWrapping;

  return { base: baseTex, residual: resTex };
}

const ADAPTIVE_BLOCK_COLS = 8;
const ADAPTIVE_BLOCK_ROWS = 8;

function getAdaptiveBlockIndex(x: number, y: number, w: number, h: number): number {
  const col = Math.min(Math.floor((x / w) * ADAPTIVE_BLOCK_COLS), ADAPTIVE_BLOCK_COLS - 1);
  const row = Math.min(Math.floor((y / h) * ADAPTIVE_BLOCK_ROWS), ADAPTIVE_BLOCK_ROWS - 1);
  return row * ADAPTIVE_BLOCK_COLS + col;
}

function getRangeForBlock(blockFlags: bigint, blockIdx: number): number {
  return (blockFlags & (1n << BigInt(blockIdx))) ? 0.25 : 0.5;
}

function dequantizeH(encoded: number, range: number): number {
  return ((encoded / 63) * 2 * range) - range;
}

function dequantizeS(encoded: number, range: number): number {
  return ((encoded / 31) * 2 * range) - range;
}

function dequantizeL(encoded: number, range: number): number {
  return ((encoded / 31) * 2 * range) - range;
}
