/* 幕帘验证：只对墙 mesh 发射弧带高度水平射线（修复前这里全穿透） */
import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource } from "../src/services/map/Refinements";
import { buildPostSideWalls } from "../src/services/map/PostProcess";
import { tileById } from "../src/services/map/Tiles";

const cache = new Map<string, ChunkData>();
const seed = 11;
const src = makeChunkSource((a, b) => {
  const k = `${seed}:${a}:${b}`;
  let x = cache.get(k);
  if (!x) { x = generateChunk(seed, a, b); cache.set(k, x); }
  return x;
});
const raster = {
  worldSeed: seed, chunkSource: () => src, getChunkData: () => undefined,
  heightAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return B ? B.h : 0; },
  tileDefAt: (x: number, z: number) => { const B = src.blockAt(Math.floor(x / 4), Math.floor(z / 4)); return tileById(B ? B.id : 0); },
} as any;

const HALF = 30;
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
walls.mesh!.position.set(HALF, 0, HALF);
walls.mesh!.updateMatrixWorld(true);
const rc = new THREE.Raycaster();

// 测试两条弧边：块(0,0) +x 边（x=4, h=3.327）和块(0,5) -x 边（x=0, h=2.242）
const cases = [
  { name: "块(0,0)+x边", edge: 4, h: src.blockAt(0, 0)!.h, along: "z" as const, from: 30 },
  { name: "块(0,5)-x边", edge: 0, h: src.blockAt(0, 5)!.h, along: "z" as const, from: -30 },
];
for (const c of cases) {
  const arcB = c.h - 0.3;
  let hit = 0, miss = 0, total = 0;
  for (let y = arcB + 0.02; y < c.h - 0.005; y += 0.02) {
    for (let a = 0.25; a < 4; a += 0.5) {
      total++;
      const o = c.along === "z"
        ? new THREE.Vector3(c.from, y, a > -1 && c.edge === 0 ? 20 + a : a)
        : new THREE.Vector3(a, y, c.from);
      // 修正：-x 边从 x=-30 射向 +x；测试点 z 取块内 (0,5)→z∈[20,24]
      if (c.edge === 0) o.z = 20 + a * 0.9;
      const d = c.edge === 4 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
      rc.set(o, d);
      const hW = rc.intersectObject(walls.mesh!, false);
      if (hW.length) hit++; else miss++;
    }
  }
  console.log(`${c.name} h=${c.h.toFixed(3)} 弧带[${(arcB).toFixed(2)},${c.h.toFixed(2)}]: 射线=${total} 命中墙=${hit} 穿透=${miss} ${miss === 0 ? "✓幕帘封死" : "←仍有穿透!"}`);
}
