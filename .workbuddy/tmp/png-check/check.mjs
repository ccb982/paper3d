// check.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ../../../另起的绘画网页/scripts/lib/png.ts
import { inflateSync } from "node:zlib";
var SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
var CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function decodePng(buf) {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error("\u4E0D\u662F PNG\uFF08\u7B7E\u540D\u4E0D\u5339\u914D\uFF09");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off, false);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    const dataStart = off + 8;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === "IHDR") {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
      if (interlace !== 0) throw new Error("\u4E0D\u652F\u6301\u9694\u884C\uFF08interlaced\uFF09PNG\uFF0C\u8BF7\u53E6\u5B58\u4E3A\u975E\u9694\u884C");
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off = dataStart + len + 4;
  }
  if (width === 0 || height === 0) throw new Error("PNG \u5934\u635F\u574F\uFF08\u5BBD\u9AD8\u4E3A 0\uFF09");
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`\u4E0D\u652F\u6301\u7684 PNG \u989C\u8272\u7C7B\u578B ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("\u7D22\u5F15\u8272 PNG \u7F3A\u5C11 PLTE");
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = Math.max(1, channels * bitDepth >> 3);
  const stride = Math.ceil(width * channels * bitDepth / 8);
  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))));
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new Error(`PNG \u6570\u636E\u4E0D\u5B8C\u6574\uFF08\u9700\u8981 ${expected} \u5B57\u8282\uFF0C\u5B9E\u9645 ${raw.length}\uFF09`);
  const planes = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const src2 = raw.subarray(p, p + stride);
    p += stride;
    const cur = planes.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? planes.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src2[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += a + b >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`\u672A\u77E5 PNG \u8FC7\u6EE4\u7C7B\u578B ${filter}`);
      cur[x] = v & 255;
    }
  }
  const samples = new Uint16Array(width * height * channels);
  const readSample = (base, index) => {
    if (bitDepth === 8) return planes[base + index];
    if (bitDepth === 16) return planes[base + index * 2] << 8 | planes[base + index * 2 + 1];
    const perByte = 8 / bitDepth;
    const byte = planes[base + Math.floor(index / perByte)];
    const shift = 8 - bitDepth * (index % perByte + 1);
    return byte >> shift & (1 << bitDepth) - 1;
  };
  for (let y = 0; y < height; y++) {
    const rowBase = y * stride;
    for (let x = 0; x < width * channels; x++) {
      samples[y * width * channels + x] = readSample(rowBase, x);
    }
  }
  const maxVal = (1 << bitDepth) - 1;
  const scale8 = (v) => Math.round(v / maxVal * 255);
  const to8 = (v) => bitDepth === 8 ? v : scale8(v);
  const out2 = new Uint8ClampedArray(width * height * 4);
  const N = width * height;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const s = i * channels;
    if (colorType === 6) {
      out2[o] = to8(samples[s]);
      out2[o + 1] = to8(samples[s + 1]);
      out2[o + 2] = to8(samples[s + 2]);
      out2[o + 3] = to8(samples[s + 3]);
    } else if (colorType === 2) {
      out2[o] = to8(samples[s]);
      out2[o + 1] = to8(samples[s + 1]);
      out2[o + 2] = to8(samples[s + 2]);
      out2[o + 3] = 255;
      if (trns && trns.length >= 6 && samples[s] === (trns[0] << 8 | trns[1]) && samples[s + 1] === (trns[2] << 8 | trns[3]) && samples[s + 2] === (trns[4] << 8 | trns[5])) {
        out2[o + 3] = 0;
      }
    } else if (colorType === 4) {
      const g = to8(samples[s]);
      out2[o] = g;
      out2[o + 1] = g;
      out2[o + 2] = g;
      out2[o + 3] = to8(samples[s + 1]);
    } else if (colorType === 0) {
      const g = to8(samples[s]);
      out2[o] = g;
      out2[o + 1] = g;
      out2[o + 2] = g;
      out2[o + 3] = 255;
      if (trns && trns.length >= 2 && samples[s] === (trns[0] << 8 | trns[1])) out2[o + 3] = 0;
    } else {
      const idx = samples[s];
      out2[o] = palette[idx * 3];
      out2[o + 1] = palette[idx * 3 + 1];
      out2[o + 2] = palette[idx * 3 + 2];
      out2[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { data: out2, width, height };
}

// check.ts
var D = process.argv[2];
var src = join(D, "src");
var out = {};
for (const n of readdirSync(src).sort()) {
  try {
    const img = decodePng(readFileSync(join(src, n)));
    const buf = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    out[n] = { w: img.width, h: img.height, sha: createHash("sha256").update(buf).digest("hex") };
  } catch (e) {
    out[n] = { error: e.message };
  }
}
writeFileSync(join(D, "mine.json"), JSON.stringify(out, null, 1));
console.log("\u89E3\u7801", Object.keys(out).length, "\u4E2A");
