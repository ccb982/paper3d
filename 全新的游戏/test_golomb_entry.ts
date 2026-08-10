// 用维维美包实测：现状(差分+gzip) vs Golomb-Rice vs GR+2D预测
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { decodeMultiFrame } = require('./src/vendor/player/core/ftx');
const { encodeResiduals, estimateRiceBits, pickBestK, BitWriter, BitReader, zigzagEncode, zigzagDecode } = require('./src/vendor/player/core/golomb');

const file = process.argv[2] || 'src/assets/characters/protagonist/维维美.ftx3.gz';
const full = path.join(process.cwd(), file);
const raw = fs.readFileSync(full);
let bin = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
const decoded = decodeMultiFrame(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

console.log(`文件: ${path.basename(full)} | gzip后 ${(raw.length/1024).toFixed(1)}KB | 解压 ${(bin.length/1024).toFixed(1)}KB | ${decoded.frames.length} 帧`);

// 工具：拆三通道量化级别
function unpackChannels(frame) {
  const { bbox, deltaPacked } = frame;
  const total = bbox.w * bbox.h;
  const h = new Int32Array(total), s = new Int32Array(total), l = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const p = deltaPacked[i];
    h[i] = (p >> 5) & 0x3F;
    s[i] = (p >> 11) & 0x1F;
    l[i] = p & 0x1F;
  }
  return { h, s, l, total };
}

// 行差分（带符号）
function rowDiff(arr, w) {
  const out = new Int32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = i % w === 0 ? arr[i] : arr[i] - arr[i - 1];
  }
  return out;
}

// 2D 中位数预测残差（参考左/上/左上）
function median2D(arr, w, h) {
  const out = new Int32Array(arr.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const left = x > 0 ? arr[i - 1] : 0;
      const up = y > 0 ? arr[i - w] : 0;
      const diag = (x > 0 && y > 0) ? arr[i - w - 1] : 0;
      // 中位数
      let pred;
      const a = left, b = up, c = diag;
      pred = a + b - c; // 先 Paeth 式候选
      // 简单中位数
      pred = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
      out[i] = arr[i] - pred;
    }
  }
  return out;
}

// gzip 现状（残差区字节）：行差分后按 Uint8 回绕存储（和现在一样）
function gzipSize(ch) {
  const bytes = Buffer.from(ch.map(v => v & 0xFF));
  return zlib.gzipSync(bytes).length;
}

let totalOldGz = 0, totalGR = 0, totalGR2D = 0, totalRaw = 0;
const perFrame = [];

for (let f = 0; f < decoded.frames.length; f++) {
  const frame = decoded.frames[f];
  const { h, s, l, total } = unpackChannels(frame);
  const w = frame.bbox.w, hh = frame.bbox.h;

  const hd = rowDiff(h, w), sd = rowDiff(s, w), ld = rowDiff(l, w);
  const oldGz = gzipSize(hd) + gzipSize(sd) + gzipSize(ld);
  totalOldGz += oldGz;

  // GR（行差分）
  const kH = pickBestK(hd), kS = pickBestK(sd), kL = pickBestK(ld);
  const gr = encodeResiduals(hd, kH).length + encodeResiduals(sd, kS).length + encodeResiduals(ld, kL).length;
  totalGR += gr;

  // GR + 2D 预测
  const h2 = median2D(h, w, hh), s2 = median2D(s, w, hh), l2 = median2D(l, w, hh);
  const kH2 = pickBestK(h2), kS2 = pickBestK(s2), kL2 = pickBestK(l2);
  const gr2 = encodeResiduals(h2, kH2).length + encodeResiduals(s2, kS2).length + encodeResiduals(l2, kL2).length;
  totalGR2D += gr2;

  totalRaw += total * 3;

  perFrame.push({ f: frame.name, oldGz, gr, gr2, kH, kS, kL, kH2, kS2, kL2 });
}

console.log('\n===== 残差区压缩对比（仅残差三通道） =====');
console.log('帧名       | 原始    | 现状差分+gzip | GR(行差分) | GR+2D预测');
for (const p of perFrame) {
  console.log(`${p.f.padEnd(8)} | ${(p.f*0+64*3).toFixed(0)}px*3 | ${(p.oldGz/1024).toFixed(1)}KB | ${(p.gr/1024).toFixed(1)}KB | ${(p.gr2/1024).toFixed(1)}KB`);
}
console.log('------------------------------------------------------------------------');
console.log(`合计       | ${(totalRaw/1024).toFixed(1)}KB | ${(totalOldGz/1024).toFixed(1)}KB | ${(totalGR/1024).toFixed(1)}KB | ${(totalGR2D/1024).toFixed(1)}KB`);
console.log(`GR vs gzip: ${((totalOldGz-totalGR)/totalOldGz*100).toFixed(1)}% 节省`);
console.log(`GR+2D vs gzip: ${((totalOldGz-totalGR2D)/totalOldGz*100).toFixed(1)}% 节省`);
console.log(`GR+2D vs GR: ${((totalGR-totalGR2D)/totalGR*100).toFixed(1)}% 额外节省`);

// 最优 k 分布
console.log('\n各帧最优 k（行差分 H/S/L）:', perFrame.map(p => `${p.kH}/${p.kS}/${p.kL}`).join('  '));

// 验证 GR 编解码往返正确性
console.log('\n===== 编解码往返验证 =====');
let roundtripOk = true;
for (let f = 0; f < Math.min(decoded.frames.length, 2); f++) {
  const frame = decoded.frames[f];
  const { h, s, l, total } = unpackChannels(frame);
  const w = frame.bbox.w, hh = frame.bbox.h;
  const hd = rowDiff(h, w);
  const bytes = encodeResiduals(hd, pickBestK(hd));
  const { decodeResiduals } = require('./src/vendor/player/core/golomb');
  const back = decodeResiduals(bytes, total, pickBestK(hd));
  // 反行差分
  const rebuilt = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    rebuilt[i] = i % w === 0 ? back[i] : back[i] + rebuilt[i - 1];
  }
  for (let i = 0; i < total; i++) {
    if (rebuilt[i] !== h[i]) { roundtripOk = false; console.log(`  帧${f} 像素${i}: ${rebuilt[i]} != ${h[i]}`); break; }
  }
}
console.log(`GR 编解码往返: ${roundtripOk ? '✅ 无损' : '❌ 有损'}`);

// ============ RLE 对比（0 游程更适合稀疏数据） ============
function rleVarint(diff: Int32Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i] === 0) {
      let n = 0;
      while (i < diff.length && diff[i] === 0) { n++; i++; }
      out.push(0);
      const v: number[] = [];
      let t = n;
      do { v.push(t & 0x7F); t >>>= 7; } while (t > 0);
      v[v.length - 1] |= 0x80;
      out.push(...v);
    } else {
      out.push(diff[i] & 0xFF);
      i++;
    }
  }
  return out;
}
let totalRLE = 0, totalRLEGz = 0;
for (let f = 0; f < decoded.frames.length; f++) {
  const frame = decoded.frames[f];
  const { h, s, l } = unpackChannels(frame);
  const w = frame.bbox.w;
  for (const ch of [h, s, l]) {
    const d = rowDiff(ch, w);
    const rv = rleVarint(d);
    totalRLE += rv.length;
    totalRLEGz += zlib.gzipSync(Buffer.from(rv)).length;
  }
}
console.log('\n===== RLE 游程编码对比（稀疏 0 数据） =====');
console.log(`RLE(varint, 无gzip): ${(totalRLE/1024).toFixed(1)}KB`);
console.log(`RLE(varint)+gzip:   ${(totalRLEGz/1024).toFixed(1)}KB`);
console.log(`现状(差分+gzip):     ${(totalOldGz/1024).toFixed(1)}KB`);
console.log(`RLE vs 现状: ${((totalOldGz-totalRLE)/totalOldGz*100).toFixed(1)}%`);
console.log(`RLE+gzip vs 现状: ${((totalOldGz-totalRLEGz)/totalOldGz*100).toFixed(1)}%`);

// ============ 基础色索引图（regionIdTex）压缩对比 ============
console.log('\n===== 基础色索引图（regionIdTex）压缩对比 =====');
// 注意：decode 返回的是帧间预测还原后的 regionIdTex（0 = 空像素）
let idxRowGz = 0, idx2D = 0, idx2DGz = 0, idxRaw = 0, idxRle = 0;
for (let f = 0; f < decoded.frames.length; f++) {
  const frame = decoded.frames[f];
  const w = frame.bbox.w, hh = frame.bbox.h;
  const total = w * hh;
  idxRaw += total;
  const tex = new Int32Array(frame.regionIdTex);

  // 行差分
  const d1 = rowDiff(tex, w);
  idxRowGz += zlib.gzipSync(Buffer.from(d1.map(v => v & 0xFF))).length;

  // 2D 中位数预测
  const d2 = median2D(tex, w, hh);
  idx2D += d2.length; // 裸（每像素 1 字节回绕）
  idx2DGz += zlib.gzipSync(Buffer.from(d2.map(v => v & 0xFF))).length;

  // RLE（索引相同 → 游程，直接对原始值）
  const rle: number[] = [];
  let i = 0;
  while (i < total) {
    const v = tex[i];
    let n = 0;
    while (i < total && tex[i] === v && n < 65535) { n++; i++; }
    rle.push(v & 0xFF, n & 0xFF, (n >> 8) & 0xFF);
  }
  idxRle += rle.length;
}
console.log(`原始(1B/px):       ${(idxRaw/1024).toFixed(1)}KB`);
console.log(`现状(行差分+gzip):   ${(idxRowGz/1024).toFixed(1)}KB`);
console.log(`2D预测裸压:         ${(idx2D/1024).toFixed(1)}KB`);
console.log(`2D预测+gzip:        ${(idx2DGz/1024).toFixed(1)}KB`);
console.log(`RLE(2B/游程):       ${(idxRle/1024).toFixed(1)}KB`);
console.log(`2D+gzip vs 现状: ${((idxRowGz-idx2DGz)/idxRowGz*100).toFixed(1)}%`);
console.log(`RLE vs 现状: ${((idxRowGz-idxRle)/idxRowGz*100).toFixed(1)}%`);


