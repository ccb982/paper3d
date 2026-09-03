/* 检查弧带端头闭合：块(0,5) dir=1(-x)弧边，从南/北端头方向射弧带高度水平射线 */
import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource, finalRuling } from "../src/services/map/Refinements";
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
const topMesh = new THREE.Mesh(top.geometry);
topMesh.position.set(HALF, 0, HALF);
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
walls.mesh!.position.set(HALF, 0, HALF);
topMesh.updateMatrixWorld(true);
walls.mesh!.updateMatrixWorld(true);
const rc = new THREE.Raycaster();

// 块(0,5) dir=1 弧边：x=0 线，z∈[20,24]，h=2.242，弧底=1.942
const bx = 0, bz = 5, h = src.blockAt(bx, bz)!.h, arcB = h - 0.3;
console.log(`块(${bx},${bz}) h=${h.toFixed(3)} 弧底=${arcB.toFixed(3)}`);
console.log(`检查弧带端头：从南(z=19侧→北射)、北(z=25侧→南射)，y∈[弧底+0.02, h-0.02]`);
// 弧带区域 x∈[-0.3, 0] (dir1 弧边在 x=0，内缩+x? dir1=-x 边，内缩方向=+x，弧带 x∈[0,0.3])
for (const dirn of ["南→北", "北→南"]) {
  const fromZ = dirn === "南→北" ? 19 : 25;
  const dZ = dirn === "南→北" ? 1 : -1;
  let hit = 0, miss = 0;
  const missList: string[] = [];
  for (let y = arcB + 0.02; y < h - 0.01; y += 0.025) {
    for (const ox of [-0.1, 0.05, 0.2]) { // 弧带水平位置采样
      const o = new THREE.Vector3(ox, y, fromZ);
      rc.set(o, new THREE.Vector3(0, 0, dZ));
      const hT = rc.intersectObject(topMesh, false);
      const hW = rc.intersectObject(walls.mesh!, false);
      const both = (hT.length ? 1 : 0) + (hW.length ? 1 : 0);
      if (both > 0) hit++; else { miss++; if (missList.length < 15) missList.push(`y=${y.toFixed(3)} x=${ox}`); }
    }
  }
  console.log(`${dirn}: 命中=${hit} 穿透=${miss}`);
  for (const m of missList) console.log(`  MISS ${m}`);
}
