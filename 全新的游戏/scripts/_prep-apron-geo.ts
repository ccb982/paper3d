// 生成真实墙裙几何数据（edges + 手算 quad 顶点），供浏览器渲染回读
import { RasterMap } from '../src/services/map/RasterMap';
import { planPlatformAprons } from '../src/services/map/decor/PlatformApron';
import { tileById } from '../src/services/map/Tiles';
import { BLOCKS_PER_SIDE } from '../src/services/map/ChunkGenerator';
import fs from 'node:fs';

const seed = 12345;
const raster = new RasterMap(seed);
// 用户指定位置：x=67.5, z=156 → chunk(1,2)
const cx = 1, cz = 2;
for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) raster.ensureChunk(cx + dx, cz + dz);
if (!raster.getChunkData(cx, cz)) { console.log('no chunk'); process.exit(1); }
const blockKeyAt = (wx: number, wz: number): string | null => {
  const ccx = Math.floor(wx / BLOCKS_PER_SIDE), ccz = Math.floor(wz / BLOCKS_PER_SIDE);
  const d = raster.getChunkData(ccx, ccz);
  if (!d) return null;
  return tileById(d.blockTypes[(wz - ccz * BLOCKS_PER_SIDE) * BLOCKS_PER_SIDE + (wx - ccx * BLOCKS_PER_SIDE)]).key;
};
const H = (lx: number, lz: number) => raster.baseSurfaceHeightAt(cx * 60 + lx, cz * 60 + lz);
const edges = planPlatformAprons(cx, cz, seed, raster.getChunkData(cx, cz)!.blockTypes, blockKeyAt, H);
if (!edges) { console.log('no edges'); process.exit(1); }

// 复刻 buildPlatformAprons 几何（不含材质、不含外裙细采样——只有顶面+内Step，与回读目标一致）
const CURB_H = 0.35, BAND_W = 0.36, OVERHANG = 0.04;
const STEP = 0.5;
interface Pt { ix: number; iz: number; ty: number; ox: number; oz: number; ib: number }
const quads: number[][][] = [];
for (const e of edges) {
  const n = Math.max(2, Math.ceil((e.ti1 - e.ti0) / STEP) + 1);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const ti = e.ti0 + (e.ti1 - e.ti0) * f;
    const to = e.to0 + (e.to1 - e.to0) * f;
    const ix = e.ox + e.dx * ti - e.nx * BAND_W;
    const iz = e.oz + e.dz * ti - e.nz * BAND_W;
    const oxx = e.ox + e.dx * to + e.nx * OVERHANG;
    const ozz = e.oz + e.dz * to + e.nz * OVERHANG;
    const ty = H(ix, iz) + CURB_H;
    const ib = H(ix, iz) - 0.02;
    pts.push({ ix, iz, ty, ox: oxx, oz: ozz, ib });
  }
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    quads.push([
      [a.ix, a.ty, a.iz], [b.ix, b.ty, b.iz], [b.ox, b.ty, b.oz], [a.ox, a.ty, a.oz],
      [0, 1, 0],
    ]);
    quads.push([
      [a.ix, a.ty, a.iz], [b.ix, b.ty, b.iz], [b.ix, b.ib, b.iz], [a.ix, a.ib, a.iz],
      [-e.nx, 0, -e.nz],
    ]);
  }
}
const out = {
  cx, cz,
  quads,
  edgeInfo: edges.map(e => ({
    ox: e.ox, oz: e.oz, dx: e.dx, dz: e.dz, nx: e.nx, nz: e.nz,
    ti0: e.ti0, ti1: e.ti1, to0: e.to0, to1: e.to1,
  })),
};
fs.mkdirSync('./.tmp-readback', { recursive: true });
fs.writeFileSync('./.tmp-readback/apron-geo.json', JSON.stringify(out));
console.log(`chunk(${cx},${cz}) quads=${quads.length}(顶面+内Step) edges=${edges.length}`);
console.log(`edges:`);
for (const e of edges) console.log(`  o=(${e.ox.toFixed(1)},${e.oz.toFixed(1)}) d=(${e.dx},${e.dz}) n=(${e.nx},${e.nz})`);