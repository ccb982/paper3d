import { RasterMap } from '../src/services/map/RasterMap';
import { planChunkDecals } from '../src/services/map/decor/TileDecalBase';
import { planChunkProps, computePropVolumes } from '../src/services/map/decor/MapEntityDecorBase';
import { buildSnapshotFromChunks, makeSnapshotSource, computeChunkMapsRGBA } from '../src/services/map/bakeCompute';
import { CHUNK_SIZE } from '../src/services/map/ChunkGenerator';

const CX = 0, CZ = 1;
const raster = new RasterMap(12345);
const ensure = (cx: number, cz: number) => {
  raster.ensureData(cx, cz);
  return raster.getChunkData(cx, cz)!;
};
ensure(CX - 1, CZ - 1); ensure(CX, CZ); ensure(CX + 1, CZ + 1);
ensure(CX - 1, CZ); ensure(CX + 1, CZ); ensure(CX, CZ - 1); ensure(CX, CZ + 1);
const chunk = ensure(CX, CZ);
const ctx = { seed: raster.worldSeed, cx: CX, cz: CZ, groupKey: chunk.groupKey, blockTypes: chunk.blockTypes };
const decals = planChunkDecals(ctx);
const props = planChunkProps({ ...ctx, surfaceHeightAt: (x, z) => raster.surfaceHeightAt(x, z) });
const vols = computePropVolumes(props, CX, CZ);
const snap = buildSnapshotFromChunks(raster.worldSeed, CX, CZ, ensure, {
  propVolumes: Float32Array.from(vols.flatMap(v => [v.x, v.z, v.y, v.r, v.h])),
  decals,
});
const out = computeChunkMapsRGBA(makeSnapshotSource(snap), CX, CZ, {
  propVolumes: snap.propVolumes, decals: snap.decals,
});
console.log('albedo is', out.albedo.constructor.name, 'light is', out.light.constructor.name);
const L = 128;
let nanR = 0, nanG = 0, nanB = 0, infCount = 0;
const nanPx: { x: number; z: number; ch: string }[] = [];
for (let py = 0; py < L; py++) for (let px = 0; px < L; px++) {
  const i = (py * L + px) * 4;
  if (Number.isNaN(out.light[i])) { nanR++; }
  if (Number.isNaN(out.light[i + 1])) { nanG++; }
  if (Number.isNaN(out.light[i + 2])) { nanB++; }
  if (!Number.isFinite(out.light[i]) || !Number.isFinite(out.light[i + 1]) || !Number.isFinite(out.light[i + 2])) {
    infCount++;
    if (nanPx.length < 10) nanPx.push({
      x: CX * CHUNK_SIZE + (px + 0.5) * (CHUNK_SIZE / L),
      z: CZ * CHUNK_SIZE + (py + 0.5) * (CHUNK_SIZE / L),
      ch: `R=${Number.isNaN(out.light[i]) ? 'NaN' : out.light[i]} G=${Number.isNaN(out.light[i + 1]) ? 'NaN' : out.light[i + 1]} B=${Number.isNaN(out.light[i + 2]) ? 'NaN' : out.light[i + 2]}`,
    });
  }
}
console.log(`light NaN: R=${nanR} G=${nanG} B=${nanB} 非有限像素=${infCount}`);
for (const p of nanPx) console.log(`  (${p.x.toFixed(1)},${p.z.toFixed(1)}) ${p.ch}`);

// 站位解析是否命中 NaN
const lx = Math.floor(((40.9 - CX * CHUNK_SIZE) / (CHUNK_SIZE / L)));
const lz = Math.floor(((89.9 - CZ * CHUNK_SIZE) / (CHUNK_SIZE / L)));
const i = (lz * L + lx) * 4;
console.log(`\n站位(40.9,89.9) light[${i}]: R=${out.light[i]} G=${out.light[i + 1]} B=${out.light[i + 2]}`);