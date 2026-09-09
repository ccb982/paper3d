import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeMultiFrame } from "../src/vendor/player/core/ftx";

const raw = readFileSync("public/ui/加工模块.ftx3.gz");
const buf = gunzipSync(raw);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const dec = decodeMultiFrame(ab);
const pal = dec.palette as unknown as { h: number; s: number; l: number }[];
console.log("frames:", dec.frames.length, "palette:", pal.length);
for (const fr of dec.frames) {
  console.log("frame:", JSON.stringify(fr.name), "bbox", fr.bbox, "frameWH", fr.width + "x" + fr.height);
  const W = fr.bbox.w, H = fr.bbox.h;
  const idTex = fr.regionIdTex;
  const hsl2rgb = (h: number, s: number, l: number): [number, number, number] => {
    const c = (x: number) => Math.max(0, Math.min(1, Math.abs(((h * 6 + x) % 6) - 3) - 1));
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
  const raw = zlib.deflateSync(png);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf2: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf2) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const out = `Temp/加工模块_view.png`;
  writeFileSync(out, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", raw), chunk("IEND", Buffer.alloc(0)),
  ]));
  console.log("wrote", out, `${W}x${H}`);
}