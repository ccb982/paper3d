// ============================================================
// 纯 JS PNG 解码（只用 node:zlib 的 inflateSync，零第三方依赖）
// 目的：让命令行脚本在没有 canvas / 没有 PIL 的 node 里也能直接读 PNG 素材。
// 支持：非隔行；位深 1/2/4/8/16；颜色类型 0/2/3/4/6（含 tRNS）。
// 输出：RGBA8（Uint8ClampedArray），可直接喂给 atlasPacker。
// ============================================================

import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buf: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('不是 PNG（签名不匹配）');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (off + 8 <= buf.length) {
    const len = view.getUint32(off, false);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    const dataStart = off + 8;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === 'IHDR') {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
      if (interlace !== 0) throw new Error('不支持隔行（interlaced）PNG，请另存为非隔行');
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4;
  }

  if (width === 0 || height === 0) throw new Error('PNG 头损坏（宽高为 0）');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`不支持的 PNG 颜色类型 ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('索引色 PNG 缺少 PLTE');

  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = Math.max(1, (channels * bitDepth) >> 3); // 过滤用的字节/像素
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))));
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new Error(`PNG 数据不完整（需要 ${expected} 字节，实际 ${raw.length}）`);

  // ---- 反过滤 ----
  const planes = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const src = raw.subarray(p, p + stride);
    p += stride;
    const cur = planes.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? planes.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`未知 PNG 过滤类型 ${filter}`);
      cur[x] = v & 0xff;
    }
  }

  // ---- 取样本（按位读，支持 1/2/4/8/16 位深）----
  const samples = new Uint16Array(width * height * channels);
  const readSample = (base: number, index: number) => {
    if (bitDepth === 8) return planes[base + index];
    if (bitDepth === 16) return (planes[base + index * 2] << 8) | planes[base + index * 2 + 1];
    const perByte = 8 / bitDepth;
    const byte = planes[base + Math.floor(index / perByte)];
    const shift = 8 - bitDepth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const rowBase = y * stride;
    for (let x = 0; x < width * channels; x++) {
      samples[y * width * channels + x] = readSample(rowBase, x);
    }
  }

  const maxVal = (1 << bitDepth) - 1;
  const scale8 = (v: number) => Math.round((v / maxVal) * 255);
  const to8 = (v: number) => (bitDepth === 8 ? v : scale8(v));
  const out = new Uint8ClampedArray(width * height * 4);
  const N = width * height;

  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const s = i * channels;
    if (colorType === 6) {
      out[o] = to8(samples[s]);
      out[o + 1] = to8(samples[s + 1]);
      out[o + 2] = to8(samples[s + 2]);
      out[o + 3] = to8(samples[s + 3]);
    } else if (colorType === 2) {
      out[o] = to8(samples[s]);
      out[o + 1] = to8(samples[s + 1]);
      out[o + 2] = to8(samples[s + 2]);
      out[o + 3] = 255;
      if (trns && trns.length >= 6
        && samples[s] === ((trns[0] << 8) | trns[1]) && samples[s + 1] === ((trns[2] << 8) | trns[3]) && samples[s + 2] === ((trns[4] << 8) | trns[5])) {
        out[o + 3] = 0;
      }
    } else if (colorType === 4) {
      const g = to8(samples[s]);
      out[o] = g; out[o + 1] = g; out[o + 2] = g;
      out[o + 3] = to8(samples[s + 1]);
    } else if (colorType === 0) {
      const g = to8(samples[s]);
      out[o] = g; out[o + 1] = g; out[o + 2] = g;
      out[o + 3] = 255;
      if (trns && trns.length >= 2 && samples[s] === ((trns[0] << 8) | trns[1])) out[o + 3] = 0;
    } else {
      const idx = samples[s];
      out[o] = palette![idx * 3];
      out[o + 1] = palette![idx * 3 + 1];
      out[o + 2] = palette![idx * 3 + 2];
      out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }

  return { data: out, width, height };
}
