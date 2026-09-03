/* 顶面边缘剖面：单弧边高台块(0,5) -x 边（x=0 线），逐点 yAt vs 顶面网格实际值 */
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource } from "../src/services/map/Refinements";
import { buildPostChunkTopSurface, postSurfaceHeightAt } from "../src/services/map/PostProcess";
import { tileById } from "../src/services/map/Tiles";

const cache = new Map<string, ChunkData>();
const seed = 11;
const src = makeChunkSource((a, b) => {
  const k = `${seed}:${a}:${b}`;
  let x = cache.get(k);
  if (!x) { x = generateChunk(seed, a, b); cache.set(k, x); }
  return x;
});
const raster = { worldSeed: seed, chunkSource: () => src, getChunkData: () => undefined } as any;

const h = src.blockAt(0, 5)!.h; // 2.242
const arcB = h - 0.3;
console.log(`块(0,5) h=${h.toFixed(4)} 理论弧底=${arcB.toFixed(4)}`);

const top = buildPostChunkTopSurface(raster, 0, 0);
const TV = top.vertices;
// 顶面网格中 (x=0, z∈[19.75,24.25]) 的所有顶点（view=(0,5) 的 cell：lx∈[0,1), lz∈[20,24)）
const pts: { z: number; y: number; lx: number }[] = [];
for (let i = 0; i < TV.length / 3; i++) {
  const wx = TV[i * 3] + 30, wz = TV[i * 3 + 2] + 30;
  if (Math.abs(wx - 0) > 1e-5) continue;
  if (wz < 19.75 || wz > 24.25) continue;
  pts.push({ z: wz, y: TV[i * 3 + 1], lx: wx });
}
pts.sort((a, b) => a.z - b.z);
console.log(`顶面 x=0 线上的顶点（z, y）:`);
for (const p of pts) {
  const flag = Math.abs(p.y - arcB) > 0.01 ? "  ←偏离弧底!" : "";
  console.log(`  z=${p.z.toFixed(3)}  y=${p.y.toFixed(4)}${flag}`);
}
// 细查：yAt 理论值沿边
console.log(`\n贴地查询 postSurfaceHeightAt(x=0.01, z) 剖面:`);
for (let z = 19.75; z <= 24.25; z += 0.125) {
  const y = postSurfaceHeightAt(raster as any, 0.01, z);
  const flag = Math.abs(y - arcB) > 0.01 ? "  ←偏离弧底!" : "";
  console.log(`  z=${z.toFixed(3)}  y=${y.toFixed(4)}${flag}`);
}
