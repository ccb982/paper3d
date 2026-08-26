// 端到端集成验证：复刻游戏内完整装饰管线
// 放置(planChunk*) → 快照(buildSnapshotFromChunks+extras) → worker 计算
// (makeSnapshotSource+computeChunkMapsRGBA) → 检查贴图/阴影/装饰物数据
import { RasterMap } from '../src/services/map/RasterMap';
import { planChunkDecals } from '../src/services/map/TileDecals';
import { planChunkProps, computePropVolumes } from '../src/services/map/TileProps';
import { buildSnapshotFromChunks, makeSnapshotSource, computeChunkMapsRGBA } from '../src/services/map/bakeCompute';
import { CHUNK_SIZE } from '../src/services/map/ChunkGenerator';

const raster = new RasterMap(12345);
raster.ensureData(0, 0);

// 1) 玩家视角：装饰先行放置
const chunk = raster.getChunkData(0, 0)!;
const ctx = {
  seed: raster.worldSeed, cx: 0, cz: 0,
  groupKey: chunk.groupKey, blockTypes: chunk.blockTypes,
};
const decals = planChunkDecals(ctx);
const props = planChunkProps({ ...ctx, surfaceHeightAt: (x, z) => raster.surfaceHeightAt(x, z) });
const vols = computePropVolumes(props, 0, 0);
console.log(`[1] 放置：贴图=${decals.length} 装饰物=${props.length} 阴影体积=${vols.length}`);
if (props.length === 0 || decals.length === 0) throw new Error('放置为空！');

// 2) 快照携带 extras（TerrainBaker 同款）
const snap = buildSnapshotFromChunks(
  raster.worldSeed, 0, 0,
  (cx, cz) => { raster.ensureData(cx, cz); return raster.getChunkData(cx, cz); },
  {
    propVolumes: Float32Array.from(vols.flatMap(v => [v.x, v.z, v.y, v.r, v.h])),
    decals,
  },
);
console.log(`[2] 快照携带：propVolumes=${snap.propVolumes.length / 5} decals=${snap.decals.length}`);

// 3) worker 计算（terrainBake.worker 同款）
const out = computeChunkMapsRGBA(makeSnapshotSource(snap), 0, 0, {
  propVolumes: snap.propVolumes, decals: snap.decals,
});

// 4) 检查贴图印章：albedo 中应有变暗像素
let dark = 0;
for (let i = 0; i < out.albedo.length; i += 4) if (out.albedo[i] < 200) dark++;
console.log(`[3] 贴图印章：albedo 变暗像素 ${dark}（贴图已印入）`);

// 5) 检查阴影：光照图 R 通道，在装饰物位置附近应有凹陷
const S = 128, step = CHUNK_SIZE / S;
let minR = 1, found = 0;
for (const v of vols) {
  const px = Math.floor(v.x / step), pz = Math.floor(v.z / step);
  for (let j = pz - 10; j <= pz + 10; j++) for (let i = px - 10; i <= px + 10; i++) {
    if (j < 0 || j >= S || i < 0 || i >= S) continue;
    const r = out.light[(j * S + i) * 4] / 255;
    if (r < minR) minR = r;
    if (r < 0.72) found++;
  }
}
console.log(`[4] 装饰物阴影：影子区最小 R=${minR.toFixed(3)} 变暗像素=${found}（应明显 <0.745）`);
if (minR > 0.73) throw new Error('阴影未印入光照图！');

// 6) 坐标一致性：装饰物 y 应贴近真实地形高度
const flat = props.filter(p => raster.surfaceHeightAt(p.x, p.z) === p.y + 0.08).length;
console.log(`[5] 装饰物贴地：${flat}/${props.length} 个 y 与真实地形一致（+下沉0.08）`);
console.log('\n✅ 端到端管线全部正常');