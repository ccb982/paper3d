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

export function buildHslTextureData(
  frame: FrameTextureData,
  palette: PaletteColor[],
): { data: Float32Array; width: number; height: number } | null {
  const { bbox, regionIdTex, deltaPacked } = frame;
  const w = bbox.w;
  const h = bbox.h;
  if (w === 0 || h === 0) return null;

  const totalPixels = w * h;
  const data = new Float32Array(totalPixels * 4);

  for (let i = 0; i < totalPixels; i++) {
    const idx4 = i * 4;
    const colorId = regionIdTex.length > 0 ? regionIdTex[i] : 0;

    if (colorId === 0) {
      data[idx4] = 0;
      data[idx4 + 1] = 0;
      data[idx4 + 2] = 0;
      data[idx4 + 3] = 0;
    } else {
      const paletteIdx = colorId - 1;
      const base = paletteIdx < palette.length ? palette[paletteIdx] : { h: 0, s: 0, l: 0 };

      let dh = 0, ds = 0, dl = 0;
      if (deltaPacked.length > 0) {
        const { s, h, l } = unpackRGB565(deltaPacked[i]);
        const blockIdx = getAdaptiveBlockIndex(i % w, Math.floor(i / w), w, h);
        const range = getRangeForBlock(frame.blockFlags, blockIdx);
        dh = dequantizeH(h, range);
        ds = dequantizeS(s, range);
        dl = dequantizeL(l, range);
      }

      let H = base.h + dh;
      H = ((H % 1) + 1) % 1;
      const S = Math.max(0, Math.min(1, base.s + ds));
      const L = Math.max(0, Math.min(1, base.l + dl));

      data[idx4] = H;
      data[idx4 + 1] = S;
      data[idx4 + 2] = L;
      data[idx4 + 3] = 1.0;
    }
  }

  return { data, width: w, height: h };
}

export function buildFrameTexture(
  frame: FrameTextureData,
  palette: PaletteColor[],
): THREE.DataTexture {
  const hslData = buildHslTextureData(frame, palette);
  if (!hslData) throw new Error('无法构建 HSL 数据');

  const tex = new THREE.DataTexture(
    hslData.data,
    hslData.width,
    hslData.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
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
