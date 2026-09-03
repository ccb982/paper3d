/* 直接回读：圆角边侧壁的形状（顶边轮廓）vs 顶面边缘 */
import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource } from "../src/services/map/Refinements";
import { buildPostChunkTopSurface, buildPostSideWalls } from "../src/services/map/PostProcess";
import { tileById } from "../src/services/map/Tiles";

const cache = new Map<string, ChunkData>();
function getChunk(s: number, cx: number, cz: number) {
  const k = `${s}:${cx}:${cz}`;
  let x = cache.get(k);
  if (!x) { x = generateChunk(s, cx, cz); cache.set(k, x); }
  return x;
}
const seed = 11, N = 60, HALF = N / 2;
const src = makeChunkSource((a, b) => getChunk(seed, a, b) as ChunkData | undefined);
const raster = {
  worldSeed: seed, chunkSource: () => src, getChunkData: () => undefined,
  heightAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return B ? B.h : 0; },
  tileDefAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return tileById(B ? B.id : 0); },
} as any;

// 块 (0,0) 的 +x 圆角边：x=4 线，z∈[0,4]
const bx = 0, bz = 0, edgeX = 4;
const h = src.blockAt(bx, bz)!.h;

const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
const W = walls.buffers.vertices, WI = walls.buffers.indices;

// 收集该边被索引引用的墙顶点：x==4, z∈[0,4]，法线 +x
const used = new Set<number>();
for (let i = 0; i < WI.length; i++) used.add(WI[i]);
const wallTop: { z: number; y: number; t: number }[] = [];
for (const vi of used) {
  const wx = W[vi * 3] + HALF, wz = W[vi * 3 + 2] + HALF;
  if (Math.abs(wx - edgeX) > 1e-5) continue;
  if (wz < -1e-5 || wz > 4 + 1e-5) continue;
  wallTop.push({ z: wz, y: W[vi * 3 + 1], t: vi % 4 });
}
wallTop.sort((a, b) => a.z - b.z || a.t - b.t);

console.log(`=== 圆角边侧壁回读（块(0,0) +x 边，x=4 线，platformH=${h.toFixed(3)}，理论弧底=${(h - 0.3).toFixed(3)}）===`);
console.log(`墙顶边顶点（z, y, 顶点角色 0/1=顶A/B 2/3=底A/B）:`);
for (const p of wallTop) console.log(`  z=${p.z.toFixed(3)}  y=${p.y.toFixed(4)}  [t${p.t}]`);

// 顶面 x=4 线 platform 侧（view=(0,0)）边缘高度
const top = buildPostChunkTopSurface(raster, 0, 0);
const TV = top.vertices;
const topEdge: { z: number; y: number }[] = [];
for (let i = 0; i < TV.length / 3; i++) {
  const wx = TV[i * 3] + HALF, wz = TV[i * 3 + 2] + HALF;
  if (Math.abs(wx - edgeX) > 1e-5) continue;
  if (Math.floor(wx / 4) !== bx || Math.floor(wz / 4) !== bz) continue;
  topEdge.push({ z: wz, y: TV[i * 3 + 1] });
}
topEdge.sort((a, b) => a.z - b.z);
console.log(`\n顶面边缘（同线，view=块(0,0)）:`);
for (const p of topEdge) console.log(`  z=${p.z.toFixed(3)}  y=${p.y.toFixed(4)}`);
