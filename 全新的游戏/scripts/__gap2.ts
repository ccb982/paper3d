import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource } from "../src/services/map/Refinements";
import { buildPostChunkTopSurface, buildPostSideWalls } from "../src/services/map/PostProcess";
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
const HALF = 30;
const top = buildPostChunkTopSurface(raster, 0, 0);
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
const TV = top.vertices, W = walls.buffers.vertices;

const h = src.blockAt(0, 5)!.h; // 2.242
console.log(`块(0,5) h=${h.toFixed(3)} 弧底=${(h-0.3).toFixed(3)}; 南端 z=20, 北端 z=24`);
for (const zl of [20, 24]) {
  console.log(`\n=== z=${zl} 线 ===`);
  for (const x of [0, 0.03125, 0.09375, 0.15625, 0.21875, 0.28125, 0.34375]) {
    // 顶面网格实际顶点（位置最接近）
    let bestT: number | null = null, bd = 1e9;
    for (let i = 0; i < TV.length / 3; i++) {
      const wx = TV[i*3]+HALF, wz = TV[i*3+2]+HALF;
      const dd = (wx-x)*(wx-x) + (wz-zl)*(wz-zl);
      if (dd < bd) { bd = dd; bestT = TV[i*3+1]; }
    }
    // 墙/封片顶点（位置最接近）
    let bestW: number | null = null; let bw = 1e9;
    for (let i = 0; i < W.length / 3; i++) {
      const wx = W[i*3]+HALF, wz = W[i*3+2]+HALF;
      const dd = (wx-x)*(wx-x) + (wz-zl)*(wz-zl);
      if (dd < bw) { bw = dd; bestW = W[i*3+1]; }
    }
    const nearestStr = (v: number | null, d: number) => v === null ? "∅" : `${v.toFixed(3)}@${d.toFixed(3)}`;
    console.log(`  x=${x.toFixed(3)} 顶面=${nearestStr(bestT, Math.sqrt(bd))} 墙=${nearestStr(bestW, Math.sqrt(bw))}`);
  }
}
