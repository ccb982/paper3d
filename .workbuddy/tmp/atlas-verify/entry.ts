// 离线往返验证：真实模块打包 → 游戏端解码器还原 → 按 shader 公式重建 RGB → 比 PSNR
// 用法: node --experimental-strip-types entry.ts   （实际走 esbuild 打包后 node 跑）
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packAtlas, type AtlasSourceFrame } from '../../../另起的绘画网页/src/utils/atlasPacker';
// ★ 游戏端权威解码器（原样 import，不是我复刻的）
import { decodeMultiFrame, buildBaseHslData, buildResidualData } from '../../../全新的游戏/src/vendor/player/core/ftx.ts';

const ROOT = process.argv[2];
const OUT_GZ = process.argv[3];
const TARGET_H = Number(process.argv[4] ?? 256);
const PALETTE = Number(process.argv[5] ?? 128);

// packMultiFrameToBinary 会打一堆 blockFlags 日志，验证时静音
const realLog = console.log;
console.log = () => {};
console.error = () => {};

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const sources: AtlasSourceFrame[] = manifest.map((m: any) => {
  const buf = readFileSync(join(ROOT, 'raw', m.file));
  return {
    name: m.name,
    image: { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), width: m.width, height: m.height },
  };
});

const t0 = Date.now();
const packed = packAtlas(sources, {
  targetHeight: TARGET_H,
  paletteSize: PALETTE,
  tightCrop: true,
  enablePrediction: false,
});
const tPack = Date.now() - t0;

console.log = realLog;
console.error = (...a: any[]) => process.stderr.write(a.join(' ') + '\n');

// ---- gzip ----
const gzBlob = await new Blob([packed.binary]).stream().pipeThrough(new CompressionStream('gzip'));
const gzBytes = new Uint8Array(await new Response(gzBlob).arrayBuffer());
writeFileSync(OUT_GZ, gzBytes);

// ---- 游戏解码器还原 ----
const raw = gzBytes[0] === 0x1f && gzBytes[1] === 0x8b
  ? new Uint8Array(await new Response(new Blob([gzBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  : gzBytes;
const decoded = decodeMultiFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

// shader (renderer.ts) 的 hsl2rgb
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

console.log(`帧数=${decoded.frames.length}  调色板=${decoded.palette.length}  目标高=${TARGET_H}  打包耗时=${tPack}ms`);
console.log(`未压缩=${packed.binary.length}B  gzip=${gzBytes.length}B  压缩率=${(gzBytes.length / packed.binary.length * 100).toFixed(1)}%`);
console.log('');
console.log('帧名          源尺寸 → 输出尺寸   不透明   窄块%   PSNR(dB)  最大通道误差');
let totalErr = 0, totalPx = 0;
for (let i = 0; i < decoded.frames.length; i++) {
  const f = decoded.frames[i];
  const base = buildBaseHslData(f, decoded.palette)!;
  const res = buildResidualData(f)!;
  const info = packed.info[i];
  const w = base.width, h = base.height;
  const srcFrame = sources[i];
  // 源图（同一缩放流程）重建紧凑 bbox 用于比对
  const srcData = srcFrame.image.data as Uint8ClampedArray;
  const sw = srcFrame.image.width, sh = srcFrame.image.height;

  // 从原始源图裁到与预览一致的紧 bbox（与 encoder 的 tightCrop 对齐）
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (srcData[(y * sw + x) * 4 + 3] >= 128) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // 最近邻/面积法都行：这里用面积法（与 encoder 的 areaResample 一致）
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const xr = box.w / w, yr = box.h / h;
  let se = 0, n = 0, maxErr = 0;
  for (let dy = 0; dy < h; dy++) {
    const sy0 = box.y + dy * yr, sy1 = sy0 + yr;
    for (let dx = 0; dx < w; dx++) {
      const di = (dy * w + dx) * 4;
      if (base.data[di + 3] < 0.5) continue;
      const sx0 = box.x + dx * xr, sx1 = sx0 + xr;
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(sh, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy1, sy + 1) - Math.max(sy0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.min(sw, Math.ceil(sx1)); sx++) {
          const wx = Math.min(sx1, sx + 1) - Math.max(sx0, sx);
          if (wx <= 0) continue;
          const p = (sy * sw + sx) * 4;
          const al = srcData[p + 3] / 255;
          r += srcData[p] * al * wx * wy; g += srcData[p + 1] * al * wx * wy; b += srcData[p + 2] * al * wx * wy;
          a += al * wx * wy; ws += wx * wy;
        }
      }
      if (a < 1e-6) continue;
      const sr = r / a, sg = g / a, sb = b / a;
      // 残差还原（统一 0.5 范围）
      // renderer.ts: dH = (res.r * 2 - 1) * 0.5，res.r = qH/255
      const qH = res.data[di], qS = res.data[di + 1], qL = res.data[di + 2];
      const ddH = qH / 255 - 0.5;
      const ddS = qS / 255 - 0.5;
      const ddL = qL / 255 - 0.5;
      const finalH = ((base.data[di] + ddH) % 1 + 1) % 1;
      const finalS = Math.max(0, Math.min(1, base.data[di + 1] + ddS));
      const finalL = Math.max(0, Math.min(1, base.data[di + 2] + ddL));
      const [rr, gg, bb] = hsl2rgb(finalH, finalS, finalL);
      const e = [Math.abs(rr * 255 - sr), Math.abs(gg * 255 - sg), Math.abs(bb * 255 - sb)];
      const m = Math.max(...e);
      if (m > maxErr) maxErr = m;
      se += (rr * 255 - sr) ** 2 + (gg * 255 - sg) ** 2 + (bb * 255 - sb) ** 2;
      n += 3;
    }
  }
  const mse = se / n;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
  totalErr += se; totalPx += n;
  console.log(
    `${f.name.padEnd(12, ' ')} ${info.sourceWidth}x${info.sourceHeight} → ${w}x${h}`.padEnd(48, ' ')
    + `${(info.opaqueRatio * 100).toFixed(1)}%`.padStart(8)
    + `${(info.narrowBlockRatio * 100).toFixed(0)}%`.padStart(7)
    + `${psnr.toFixed(2)}`.padStart(11)
    + `${maxErr.toFixed(0)}`.padStart(14)
  );
}
const gMse = totalErr / totalPx;
console.log('');
console.log(`总计 PSNR = ${(10 * Math.log10(255 * 255 / gMse)).toFixed(2)} dB   残差截断比例 = ${(packed.clippedRatio * 100).toFixed(3)}%`);

// ---- 导出解码后的裸 RGBA，供 Python 拼对比图 ----
import { mkdirSync, existsSync } from 'node:fs';
const decDir = join(ROOT, 'decoded');
if (!existsSync(decDir)) mkdirSync(decDir, { recursive: true });
const decManifest: any[] = [];
for (let i = 0; i < decoded.frames.length; i++) {
  const f = decoded.frames[i];
  const base = buildBaseHslData(f, decoded.palette)!;
  const res = buildResidualData(f)!;
  const w = base.width, h = base.height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    if (base.data[k * 4 + 3] < 0.5) continue;
    const qH = res.data[k * 4], qS = res.data[k * 4 + 1], qL = res.data[k * 4 + 2];
    const fh = ((base.data[k * 4] + (qH / 255 - 0.5)) % 1 + 1) % 1;
    const fs = Math.max(0, Math.min(1, base.data[k * 4 + 1] + (qS / 255 - 0.5)));
    const fl = Math.max(0, Math.min(1, base.data[k * 4 + 2] + (qL / 255 - 0.5)));
    const [r, g, b] = hsl2rgb(fh, fs, fl);
    out[k * 4] = r * 255; out[k * 4 + 1] = g * 255; out[k * 4 + 2] = b * 255; out[k * 4 + 3] = 255;
  }
  const nm = `d_${i}.bin`;
  writeFileSync(join(decDir, nm), Buffer.from(out.buffer));
  decManifest.push({ index: i, name: f.name, file: nm, width: w, height: h });
}
writeFileSync(join(decDir, 'manifest.json'), JSON.stringify({ targetHeight: TARGET_H, palette: PALETTE, frames: decManifest }, null, 1));

