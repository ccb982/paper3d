import { uint8ToBase64, base64ToUint8, rleEncode8, rleEncode16, packRGB565 } from '../core/ftxCore';
import type { SharedBaseColor } from '../stores/useAppStore';

export interface FrameExportData {
  name: string;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
  regionIdTex: Uint8Array;
  deltaTex: Uint8Array;
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
    const totalPixels = frame.bbox.w * frame.bbox.h;
    const rgb565Data = new Uint16Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const h = frame.deltaTex[i * 3];
      const s = frame.deltaTex[i * 3 + 1];
      const l = frame.deltaTex[i * 3 + 2];
      rgb565Data[i] = packRGB565(s, h, l);
    }
    const deltaEncoded = rleEncode16(rgb565Data);
    const regionEncoded = rleEncode8(frame.regionIdTex);

    let frameSize = 1 + nameBytes.length;
    frameSize += 2 + 2 + 2 + 2 + 2 + 2;
    frameSize += 2;
    frameSize += 4 + regionEncoded.length;
    frameSize += 4 + deltaEncoded.length;

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
    view.setUint32(offset, regionEncoded.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, regionEncoded.length).set(regionEncoded); offset += regionEncoded.length;
    view.setUint32(offset, deltaEncoded.length, true); offset += 4;
    new Uint8Array(frameBuf, offset, deltaEncoded.length).set(deltaEncoded); offset += deltaEncoded.length;

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