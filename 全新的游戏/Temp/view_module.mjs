// Temp/view_module.ts
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// src/vendor/player/core/ftx.ts
function invertDelta8(filtered, stride) {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    if (i % stride === 0) out[i] = filtered[i];
    else out[i] = filtered[i] + out[i - 1];
  }
  return out;
}
function decodeMultiFrame(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const magic = view.getUint32(offset, false);
  offset += 4;
  if (magic !== 1179932723) throw new Error("\u65E0\u6548\u7684 FTX3 \u683C\u5F0F (Magic \u4E0D\u5339\u914D)");
  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 3) throw new Error(`\u4E0D\u652F\u6301\u7684 FTX \u7248\u672C: ${version}`);
  const predictionFlag = view.getUint8(offset);
  offset += 1;
  const enablePrediction = predictionFlag === 1;
  const frameCount = view.getUint16(offset, true);
  offset += 2;
  const paletteCount = view.getUint16(offset, true);
  offset += 2;
  const palette = [];
  for (let i = 0; i < paletteCount; i++) {
    palette.push({
      h: view.getFloat32(offset, true),
      s: view.getFloat32(offset + 4, true),
      l: view.getFloat32(offset + 8, true)
    });
    offset += 12;
  }
  const frames = [];
  let prevDecodedRegion = null;
  for (let f = 0; f < frameCount; f++) {
    const nameLen = view.getUint8(offset);
    offset += 1;
    const nameBytes = new Uint8Array(buffer, offset, nameLen);
    const name = new TextDecoder().decode(nameBytes);
    offset += nameLen;
    const width = view.getUint16(offset, true);
    offset += 2;
    const height = view.getUint16(offset, true);
    offset += 2;
    const bboxX = view.getUint16(offset, true);
    offset += 2;
    const bboxY = view.getUint16(offset, true);
    offset += 2;
    const bboxW = view.getUint16(offset, true);
    offset += 2;
    const bboxH = view.getUint16(offset, true);
    offset += 2;
    const bbox = { x: bboxX, y: bboxY, w: bboxW, h: bboxH };
    const blockFlags = view.getBigUint64(offset, true);
    offset += 8;
    const regionIdTexLen = view.getUint32(offset, true);
    offset += 4;
    let regionIdTex;
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
    let deltaPacked;
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
        deltaPacked[i] = (sChannel[i] & 31) << 11 | (hChannel[i] & 63) << 5 | lChannel[i] & 31;
      }
    } else {
      deltaPacked = new Uint16Array(0);
    }
    frames.push({ name, width, height, bbox, regionIdTex, deltaPacked, blockFlags });
  }
  return { palette, frames };
}

// Temp/view_module.ts
var raw = readFileSync("public/ui/\u52A0\u5DE5\u6A21\u5757.ftx3.gz");
var buf = gunzipSync(raw);
var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
var dec = decodeMultiFrame(ab);
var pal = dec.palette;
console.log("frames:", dec.frames.length, "palette:", pal.length);
for (const fr of dec.frames) {
  console.log("frame:", JSON.stringify(fr.name), "bbox", fr.bbox, "frameWH", fr.width + "x" + fr.height);
  const W = fr.bbox.w, H = fr.bbox.h;
  const idTex = fr.regionIdTex;
  const hsl2rgb = (h, s, l) => {
    const c = (x) => Math.max(0, Math.min(1, Math.abs((h * 6 + x) % 6 - 3) - 1));
    const k = s * (1 - Math.abs(2 * l - 1));
    return [l + k * (c(0) - 0.5), l + k * (c(4) - 0.5), l + k * (c(2) - 0.5)];
  };
  const rowBytes = W * 4;
  const pad = 0;
  const png = Buffer.alloc(rowBytes * H + H);
  const zlib = await import("node:zlib");
  for (let y = 0; y < H; y++) {
    png[y * (rowBytes + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const id = idTex[y * W + x];
      const [r, g, b] = id === 0 ? [0.12, 0.12, 0.18] : hsl2rgb(pal[id - 1].h, pal[id - 1].s, pal[id - 1].l);
      const p = y * (rowBytes + 1) + 1 + x * 4;
      png[p] = Math.round(r * 255);
      png[p + 1] = Math.round(g * 255);
      png[p + 2] = Math.round(b * 255);
      png[p + 3] = 255;
    }
  }
  const raw2 = zlib.deflateSync(png);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf2) => {
    let c = 4294967295;
    for (const b of buf2) c = crcTable[(c ^ b) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const out = `Temp/\u52A0\u5DE5\u6A21\u5757_view.png`;
  writeFileSync(out, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", raw2),
    chunk("IEND", Buffer.alloc(0))
  ]));
  console.log("wrote", out, `${W}x${H}`);
}
