// 读取用户实际站位 chunk(0,1) 的生成输出纹理：
// 1) albedo（材质地块应为纯白，检查是否被贴图/装饰物污染）
// 2) lightmap（R=直射 N·L, G=AO）
// 3) 生成的 uMatParams（hazard slot14）与 uMatBaseLCH
import { RasterMap } from '../src/services/map/RasterMap';
import { planChunkDecals } from '../src/services/map/decor/TileDecalBase';
import { planChunkProps, computePropVolumes } from '../src/services/map/decor/MapEntityDecorBase';
import { buildSnapshotFromChunks, makeSnapshotSource, computeChunkMapsRGBA } from '../src/services/map/bakeCompute';
import { CHUNK_SIZE } from '../src/services/map/ChunkGenerator';
import { TILE_FLAT_SAND, tileById } from '../src/services/map/Tiles';
import { tileMaterialByKey } from '../src/services/map/TileMaterials';
import { applyGroupTintHsl } from '../src/services/map/TileGroups';
import { srgbHslToOklch } from '../src/services/map/colorLab';
import { groupByKey } from '../src/services/map/TileGroups';

const CX = 0, CZ = 1;
const raster = new RasterMap(12345);
const ensure = (cx: number, cz: number) => { raster.ensureData(cx, cz); return raster.getChunkData(cx, cz)!; };
ensure(CX, CZ);

const chunk = ensure(CX, CZ);
const ctx = {
  seed: raster.worldSeed, cx: CX, cz: CZ,
  groupKey: chunk.groupKey, blockTypes: chunk.blockTypes,
};
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

const chunkGroup = groupByKey(chunk.groupKey);
const palette = chunkGroup?.palette;
// 复算 buildTileRenderConfig 的核心值（与 ChunkManager 同公式）
const td19 = tileById(TILE_FLAT_SAND.id);
const mat19 = td19.visual.material ? tileMaterialByKey(td19.visual.material.fnId) : undefined;
const tintHsl = applyGroupTintHsl(td19.visual.baseHsl, palette);
const lch = srgbHslToOklch(tintHsl.h, tintHsl.s, tintHsl.l);
const j = td19.visual.jitter ?? { h: 0, s: 0, l: 0 };
const merged = { ...mat19?.params, ...(td19.visual.material?.params ?? {}) };
console.log(`chunk(${CX},${CZ}) group=${chunk.groupKey} groupDef=${!!chunkGroup} palette=${palette ?? null}`);
console.log(`贴图=${decals.length} 装饰物=${props.length}`);

console.log(`\n[生成参数] TILE_FLAT_SAND(id=${TILE_FLAT_SAND.id}):`);
console.log(`  baseHsl=(${td19.visual.baseHsl.h.toFixed(3)},${td19.visual.baseHsl.s.toFixed(3)},${td19.visual.baseHsl.l.toFixed(3)}) tinted=(${tintHsl.h.toFixed(3)},${tintHsl.s.toFixed(3)},${tintHsl.l.toFixed(3)})`);
console.log(`  baseLCH=(${lch.L.toFixed(3)},${lch.C.toFixed(3)},${lch.H.toFixed(3)}) roughness=${mat19?.surface.roughness}`);
console.log(`  params slots14/15: hazard=${merged.hazard ?? 0} stripes=${merged.stripes ?? 0}`);
console.log(`  jitter=(${j.h},${j.s},${j.l}) fnId=${td19.visual.material?.fnId}`);

// 2) 用户站位 (40.9,89.9) 的 albedo + lightmap
const S = 256, L = 128;
const step = CHUNK_SIZE / S, lstep = CHUNK_SIZE / L;
const lx = ((40.9 - CX * CHUNK_SIZE) / step) | 0, lz = ((89.9 - CZ * CHUNK_SIZE) / step) | 0;
const ai = (lz * S + lx) * 4;
const li = (lz * L + lx) * 4;
const td = raster.tileDefAt(40.9, 89.9);
console.log(`\n[站位 (40.9,89.9)] tile=id${td.id} ${td.key ?? ''} ${td.visual?.material?.fnId ?? ''}`);
console.log(`  albedo=${out.albedo[ai]},${out.albedo[ai+1]},${out.albedo[ai+2]}  light=R${((out.light[li]/255)).toFixed(3)} G${((out.light[li+1]/255)).toFixed(3)}`);

// 3) 该 chunk 沙土地块 albedo 全扫描
let sand=0, nonWhite=0; const colors=new Map<string,number>();
for (let py=0; py<S; py++) for (let px=0; px<S; px++) {
  const wx=CX*CHUNK_SIZE+(px+0.5)*step, wz=CZ*CHUNK_SIZE+(py+0.5)*step;
  const t=raster.tileDefAt(wx,wz);
  if (!t || t.id!==TILE_FLAT_SAND.id) continue;
  sand++;
  const i=(py*S+px)*4;
  const k=`${out.albedo[i]},${out.albedo[i+1]},${out.albedo[i+2]}`;
  if (out.albedo[i]!==255||out.albedo[i+1]!==255||out.albedo[i+2]!==255){nonWhite++;colors.set(k,(colors.get(k)??0)+1);}
}
console.log(`\n[chunk(0,1) 沙土地块] 像素=${sand} 非白=${nonWhite}`);
for (const [k,n] of [...colors].sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`  rgb(${k}) x ${n}`);

// 4) 该 chunk 光照图 沙土区域 R/G 统计（夜间的"黑"与"偏色"
let rSum=0,rMin=1,rMax=0,gSum=0,gMin=1,gMax=0,cnt=0;
for (let py=0; py<L; py++) for (let px=0; px<L; px++) {
  const wx=CX*CHUNK_SIZE+(px+0.5)*lstep, wz=CZ*CHUNK_SIZE+(py+0.5)*lstep;
  const t=raster.tileDefAt(wx,wz);
  if (!t || t.id!==TILE_FLAT_SAND.id) continue;
  const i=(py*L+px)*4;
  const r=out.light[i]/255, g=out.light[i+1]/255;
  rSum+=r;rMin=Math.min(rMin,r);rMax=Math.max(rMax,r);
  gSum+=g;gMin=Math.min(gMin,g);gMax=Math.max(gMax,g);cnt++;
}
console.log(`\n[光照图 沙土区 R(direct)] min=${rMin.toFixed(3)} max=${rMax.toFixed(3)} avg=${(rSum/cnt).toFixed(3)}`);
console.log(`[光照图 沙土区 G(AO)] min=${gMin.toFixed(3)} max=${gMax.toFixed(3)} avg=${(gSum/cnt).toFixed(3)}`);