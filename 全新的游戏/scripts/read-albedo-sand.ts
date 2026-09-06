// 直接读取地形生成输出的 albedo 纹理数据：
// 聚焦沙土地块(flat_sand)：检查其 albedo 是否被贴图印章/装饰物写过非白像素
// （材质地块理论上应全白，若被改写 → 生成机制污染颜色 → 乘进材质色）
import { RasterMap } from '../src/services/map/RasterMap';
import { planChunkDecals } from '../src/services/map/decor/TileDecalBase';
import { planChunkProps, computePropVolumes } from '../src/services/map/decor/MapEntityDecorBase';
import { buildSnapshotFromChunks, makeSnapshotSource, computeChunkMapsRGBA } from '../src/services/map/bakeCompute';
import { CHUNK_SIZE } from '../src/services/map/ChunkGenerator';
import { tileById, TILE_FLAT_SAND } from '../src/services/map/Tiles';

const raster = new RasterMap(12345);
raster.ensureData(0, 0);

const chunk = raster.getChunkData(0, 0)!;
const ctx = {
  seed: raster.worldSeed, cx: 0, cz: 0,
  groupKey: chunk.groupKey, blockTypes: chunk.blockTypes,
};
const decals = planChunkDecals(ctx);
const props = planChunkProps({ ...ctx, surfaceHeightAt: (x, z) => raster.surfaceHeightAt(x, z) });
const vols = computePropVolumes(props, 0, 0);
const snap = buildSnapshotFromChunks(
  raster.worldSeed, 0, 0,
  (cx, cz) => { raster.ensureData(cx, cz); return raster.getChunkData(cx, cz); },
  { propVolumes: Float32Array.from(vols.flatMap(v => [v.x, v.z, v.y, v.r, v.h])), decals },
);
const out = computeChunkMapsRGBA(makeSnapshotSource(snap), 0, 0, {
  propVolumes: snap.propVolumes, decals: snap.decals,
});

const S = 256, step = CHUNK_SIZE / S;
console.log(`贴图=${decals.length} 装饰物=${props.length} albedo分辨率=${S}²`);

// 统计沙土地块像素：是否为纯白
let sandPx = 0, sandNonWhite = 0;
const sandCol = new Map<string, number>();
for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
  const wx = (px + 0.5) * step, wz = (py + 0.5) * step;
  const td = raster.tileDefAt(wx, wz);
  if (!td || td.id !== TILE_FLAT_SAND.id) continue;
  sandPx++;
  const i = (py * S + px) * 4;
  const key = `${out.albedo[i]},${out.albedo[i+1]},${out.albedo[i+2]}`;
  if (out.albedo[i] !== 255 || out.albedo[i+1] !== 255 || out.albedo[i+2] !== 255) {
    sandNonWhite++;
    sandCol.set(key, (sandCol.get(key) ?? 0) + 1);
  }
}
console.log(`沙土地块像素 ${sandPx}，其中非白 ${sandNonWhite}`);
console.log(`沙土地块非白颜色分布:`);
for (const [k, n] of [...sandCol].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  rgb(${k}) x ${n}`);

// 打印几个纯沙地块的 albedo 采样（应 255,255,255）
let shown = 0;
for (let py = 0; py < S && shown < 5; py++) for (let px = 0; px < S && shown < 5; px++) {
  const wx = (px + 0.5) * step, wz = (py + 0.5) * step;
  const td = raster.tileDefAt(wx, wz);
  if (!td || td.id !== TILE_FLAT_SAND.id) continue;
  const i = (py * S + px) * 4;
  if (out.albedo[i] === 255 && out.albedo[i+1] === 255 && out.albedo[i+2] === 255) {
    console.log(`  平沙 (${wx.toFixed(1)},${wz.toFixed(1)}) albedo=${out.albedo[i]},${out.albedo[i+1]},${out.albedo[i+2]}`);
    shown++;
  }
}
if (sandNonWhite > 0) {
  console.log('\n⚠ 沙土地块存在非白 albedo 像素 —— 说明贴图印章/装饰物覆盖了沙土，颜色会被材质乘用');
  console.log('先从贴图印章里查这些像素属于哪些贴图：');
  const touched = new Set<number>();
  for (const d of decals) {
    if (d.key && /sand|flat/i.test(String(d.key))) touched.add(decals.indexOf(d));
  }
  console.log(`  与 sand 相关的贴图印章：${[...touched].length}`);
}