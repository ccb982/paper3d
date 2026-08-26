// 烘焙侧装饰链路验证（贴图印章/阴影体积/快照携带）
import { generateChunk } from '../src/services/map/ChunkGenerator';
import { planChunkDecals, applyDecalStamps } from '../src/services/map/TileDecals';
import { planChunkProps, computePropVolumes } from '../src/services/map/TileProps';
import { buildSnapshotFromChunks } from '../src/services/map/bakeCompute';

const c = generateChunk(1, 0, 0);
const ctx = { seed: 1, cx: 0, cz: 0, groupKey: c.groupKey, blockTypes: c.blockTypes };
const decals = planChunkDecals(ctx);
const props = planChunkProps({ ...ctx, surfaceHeightAt: () => 0 });

const S = 256;
const buf = new Uint8ClampedArray(S * S * 4).fill(255);
applyDecalStamps(buf, S, 0, 0, decals, 1);
let dark = 0;
for (let i = 0; i < buf.length; i += 4) if (buf[i] < 255) dark++;
console.log(`贴图印章：${decals.length} 张贴图，变暗像素 ${dark}（应 >0）`);

const vols = computePropVolumes(props, 0, 0);
console.log(`阴影体积：${vols.length} 个，首例 ${vols[0] ? JSON.stringify(vols[0]) : '无'}（x/z 应在 0~60）`);

const snap = buildSnapshotFromChunks(
  1, 0, 0,
  (cx, cz) => { const d = generateChunk(1, cx, cz); return { heights: d.heights, blockTypes: d.blockTypes }; },
  { propVolumes: Float32Array.from(vols.flatMap(v => [v.x, v.z, v.y, v.r, v.h])), decals },
);
console.log(`快照携带：propVolumes ${snap.propVolumes.length / 5} 个，decals ${snap.decals.length} 个`);