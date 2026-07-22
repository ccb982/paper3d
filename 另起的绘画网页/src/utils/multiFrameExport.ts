import { rleEncode8, rleEncode16, applyDelta8, unpackRGB565 } from '../core/ftxCore';
import type { SharedBaseColor } from '../stores/useAppStore';

export interface FrameExportData {
  name: string;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
  regionIdTex: Uint8Array;
  deltaPacked: Uint16Array;
  blockFlags: number;
}

export function packMultiFrameToBinary(
  palette: SharedBaseColor[],
  frames: FrameExportData[]
): Uint8Array {
  let totalSize = 4 + 1 + 2 + 2;
  totalSize += palette.length * 12;

  const frameChunks: Uint8Array[] = [];
  for (const frame of frames) {
    const nameBytes = new TextEncoder().encode(frame.name);
    
    // regionIdTex: 差分替代 RLE
    const regionDiff = applyDelta8(frame.regionIdTex, frame.bbox.w);

    // deltaPacked: 解包 RGB565 为 HSL，分别差分
    const totalPixels = frame.bbox.w * frame.bbox.h;
    const hChannel = new Uint8Array(totalPixels);
    const sChannel = new Uint8Array(totalPixels);
    const lChannel = new Uint8Array(totalPixels);
    
    for (let i = 0; i < totalPixels; i++) {
      const packed = frame.deltaPacked[i];
      const { s, h, l } = unpackRGB565(packed);
      hChannel[i] = h;
      sChannel[i] = s;
      lChannel[i] = l;
    }
    
    const hDiff = applyDelta8(hChannel, frame.bbox.w);
    const sDiff = applyDelta8(sChannel, frame.bbox.w);
    const lDiff = applyDelta8(lChannel, frame.bbox.w);
    
    const deltaDiffBytes = new Uint8Array(hDiff.length + sDiff.length + lDiff.length);
    deltaDiffBytes.set(hDiff, 0);
    deltaDiffBytes.set(sDiff, hDiff.length);
    deltaDiffBytes.set(lDiff, hDiff.length + sDiff.length);

    let frameSize = 1 + nameBytes.length;
    frameSize += 2 + 2 + 2 + 2 + 2 + 2;
    frameSize += 2;
    frameSize += 4 + regionDiff.length;
    frameSize += 4 + deltaDiffBytes.length;

    const frameBuf = new ArrayBuffer(frameSize);
    const view = new DataView(frameBuf);
    let offset = 0;
    view.setUint8(offset, nameBytes.length); offset += 1;
    new Uint8Array(frameBuf, offset, nameBytes.length).set(nameBytes); offset += nameBytes.length;
    view.setUint16(offset, frame.width, true); offset += 2;
    view.setUint16(offset, frame.height, true); offset += 2;
    view.setUint16(offset, frame.bbox.x, true); offset += 2;
    view.setUint16(offset, frame.bbox.y, true); offset += 2;
    view.setUint16(offset, frame.bbox.w, true); offset += 2;
    view.setUint16(offset, frame.bbox.h, true); offset += 2;
    view.setUint16(offset, frame.blockFlags, true); offset += 2;
    view.setUint32(offset, regionDiff.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, regionDiff.length).set(regionDiff); offset += regionDiff.length;
    view.setUint32(offset, deltaDiffBytes.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, deltaDiffBytes.length).set(deltaDiffBytes); offset += deltaDiffBytes.length;

    frameChunks.push(new Uint8Array(frameBuf));
    totalSize += frameSize;
  }

  const finalBuffer = new Uint8Array(totalSize);
  let offset = 0;

  new DataView(finalBuffer.buffer).setUint32(offset, 0x46545833, false); offset += 4;
  finalBuffer[offset++] = 0x02;
  new DataView(finalBuffer.buffer).setUint16(offset, frames.length, true); offset += 2;
  new DataView(finalBuffer.buffer).setUint16(offset, palette.length, true); offset += 2;

  for (const color of palette) {
    new DataView(finalBuffer.buffer).setFloat32(offset, color.h, true); offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.s, true); offset += 4;
    new DataView(finalBuffer.buffer).setFloat32(offset, color.l, true); offset += 4;
  }

  for (const chunk of frameChunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return finalBuffer;
}
