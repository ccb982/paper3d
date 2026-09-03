import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource } from "../src/services/map/Refinements";
import { buildPostSideWalls } from "../src/services/map/PostProcess";
import { tileById } from "../src/services/map/Tiles";
const cache = new Map<string, ChunkData>();
const seed = 11;
const src = makeChunkSource((a, b) => {
  const k = `${seed}:${a}:${b}`;
  let x = cache.get(k); if (!x) { x = generateChunk(seed, a, b); cache.set(k, x); }
  return x;
});
const raster = { worldSeed: seed, chunkSource: () => src, getChunkData: () => undefined,
  heightAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return B ? B.h : 0; },
  tileDefAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return tileById(B ? B.id : 0); },
} as any;
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
const W = walls.buffers.vertices, WN = walls.buffers.normals;
// 弧带区域顶点统计：x∈[3.5,4.05], y∈[3.0,3.35], z∈[-0.1,4.1]（块(0,0)+x边幕帘应在 3.7~4）
let n = 0;
for (let i = 0; i < W.length / 3; i++) {
  const x = W[i*3]+30, y = W[i*3+1], z = W[i*3+2]+30;
  if (x > 3.4 && x < 4.05 && y > 2.9 && y < 3.4 && z > -0.1 && z < 4.1) n++;
}
console.log(`块(0,0)+x边 弧带区域顶点数=${n}`);
// 幕帘顶点位置采样（前 10 个 x<3.95 的）
let c = 0;
for (let i = 0; i < W.length / 3 && c < 10; i++) {
  const x = W[i*3]+30, y = W[i*3+1], z = W[i*3+2]+30;
  if (x > 3.5 && x < 3.95 && y > 2.9 && y < 3.4 && z > -0.1 && z < 4.1) {
    console.log(`  顶点 x=${x.toFixed(3)} y=${y.toFixed(3)} z=${z.toFixed(3)} n=(${WN[i*3]},${WN[i*3+2]})`);
    c++;
  }
}
if (c === 0) console.log("  （无 x<3.95 的幕帘顶点 → 幕帘未生成！）");
