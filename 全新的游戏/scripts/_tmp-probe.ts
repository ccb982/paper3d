import { RasterMap } from '../src/services/map/RasterMap';
import { tileById } from '../src/services/map/Tiles';
import { planPlatformAprons } from '../src/services/map/decor/PlatformApron';
import { BLOCKS_PER_SIDE } from '../src/services/map/ChunkGenerator';

const seed = 12345;
const raster = new RasterMap(seed);
const cx = 0, cz = 2;
for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) raster.ensureChunk(cx + dx, cz + dz);
const d = raster.getChunkData(cx, cz)!;

const hist: Record<string, number> = {};
for (let i = 0; i < 225; i++) {
  const k = tileById(d.blockTypes[i]).key;
  hist[k] = (hist[k] || 0) + 1;
}
console.log('chunk(0,2) keys:', JSON.stringify(hist));
console.log('grid:');
for (let bz = 0; bz < 15; bz++) {
  let row = '';
  for (let bx = 0; bx < 15; bx++) {
    const k = tileById(d.blockTypes[bz * 15 + bx]).key;
    let c = k[0];
    if (k === 'flat_sand') c = '.';
    else if (k === 'rock_platform') c = 'r';
    else if (k === 'platform_sand') c = 'P';
    else if (k === 'cement_platform') c = 'C';
    else if (k === 'brick') c = 'b';
    else if (k === 'ash_field') c = 'a';
    else if (k === 'mud') c = 'm';
    else if (k === 'pit') c = 'p';
    else if (k === 'water') c = 'w';
    row += c;
  }
  console.log(bz + ': ' + row);
}

// user position x=58.1, z=146.2 → chunk(0,2) block: bx=(58.1-0)/4=14.525→14, bz=(146.2-120)/4=6.55→6
console.log('user block bx=14 bz=6 key=', tileById(d.blockTypes[6 * 15 + 14]).key);

const H = (lx: number, lz: number) => raster.baseSurfaceHeightAt(cx * 60 + lx, cz * 60 + lz);
const bk = (wx: number, wz: number) => {
  const ccx = Math.floor(wx / BLOCKS_PER_SIDE), ccz = Math.floor(wz / BLOCKS_PER_SIDE);
  const dd = raster.getChunkData(ccx, ccz);
  if (!dd) return null;
  return tileById(dd.blockTypes[(wz - ccz * BLOCKS_PER_SIDE) * BLOCKS_PER_SIDE + (wx - ccx * BLOCKS_PER_SIDE)]).key;
};
const edges = planPlatformAprons(cx, cz, seed, d.blockTypes, bk, H);
console.log('edges:', edges ? edges.length : 'null');
if (edges) for (const e of edges) console.log(`  o=(${e.ox.toFixed(1)},${e.oz.toFixed(1)}) d=(${e.dx},${e.dz}) n=(${e.nx},${e.nz}) ti=[${e.ti0.toFixed(1)},${e.ti1.toFixed(1)}] to=[${e.to0.toFixed(1)},${e.to1.toFixed(1)}]`);
