import { RasterMap } from '../../src/services/map/RasterMap';
import { computeTableGeometry } from '../../src/services/map/PatchCompute';

const seed = 4242;
const raster = new RasterMap(seed);
const readChunk = (cx: number, cz: number) => { raster.ensureData(cx, cz); return raster.getChunkData(cx, cz); };

function sizeOf(o: unknown): number {
  let n = 0;
  if (ArrayBuffer.isView(o)) return (o as ArrayBufferView).byteLength;
  if (Array.isArray(o)) { for (const v of o) n += sizeOf(v); return n; }
  if (o && typeof o === 'object') { for (const v of Object.values(o)) n += sizeOf(v); return n; }
  return 0;
}

const cx = 3, cz = 5;
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) readChunk(cx + a, cz + b);
const levels = raster.levelsOf(cx, cz);
const rc = (a: number, b: number) => readChunk(a, b);

// 冷：首次（refined src + FaceTable 都要建）
let t0 = performance.now();
computeTableGeometry(rc, seed, cx, cz, new Uint8Array(levels), null, null, undefined, false, undefined, 8);
console.log(`冷（首算，含建表）      ${(performance.now() - t0).toFixed(0)}ms`);

// 热：同 chunk 再算（refined src + FaceTable 命中缓存）
t0 = performance.now();
computeTableGeometry(rc, seed, cx, cz, new Uint8Array(levels), null, null, undefined, false, undefined, 8);
console.log(`热（同 chunk 重算）      ${(performance.now() - t0).toFixed(0)}ms`);

// 热 + 换邻块（邻块 FaceTable 也要建，但本块命中）
const cx2 = 4, cz2 = 5;
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) readChunk(cx2 + a, cz2 + b);
const levels2 = raster.levelsOf(cx2, cz2);
t0 = performance.now();
computeTableGeometry(rc, seed, cx2, cz2, new Uint8Array(levels2), null, null, undefined, false, undefined, 8);
console.log(`热（换块，邻表新建）    ${(performance.now() - t0).toFixed(0)}ms`);

const g = computeTableGeometry(rc, seed, cx, cz, new Uint8Array(levels), null, null, undefined, false, undefined, 8);
console.log(`字节：顶面 ${(sizeOf(g.top)/1048576).toFixed(2)}MB 侧壁 ${(sizeOf(g.wall)/1048576).toFixed(2)}MB 分区 ${(sizeOf(g.cells)/1048576).toFixed(2)}MB 水 ${(sizeOf(g.water)/1024).toFixed(0)}KB`);
