/* 射线检测：从高台外侧向 +x 圆角边发射水平射线，找洞 */
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

const bx = 0, bz = 0, edgeX = 4;
const h = src.blockAt(bx, bz)!.h;          // 3.327
const arcBottom = h - 0.3;                  // 3.027

const top = buildPostChunkTopSurface(raster, 0, 0);
const topMesh = new THREE.Mesh(top.geometry);
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
walls.mesh!.position.set(HALF, 0, HALF);
topMesh.position.set(HALF, 0, HALF);
topMesh.updateMatrixWorld(true);
walls.mesh!.updateMatrixWorld(true);

const rc = new THREE.Raycaster();
const origin = new THREE.Vector3(30, 0, 0);
const dir = new THREE.Vector3(-1, 0, 0).normalize();

let holes = 0, ok = 0;
const holeList: string[] = [];
const zs = [0.125, 0.375, 0.625, 0.875, 1.125, 1.375, 1.625, 1.875, 2.125, 2.375, 2.625, 2.875, 3.125, 3.375, 3.625, 3.875];
// y 从弧底下方到台面上方细扫
for (let y = arcBottom - 0.10; y <= h + 0.10; y += 0.02) {
  for (const z of zs) {
    origin.set(30, y, z);
    rc.set(origin, dir);
    const hT = rc.intersectObject(topMesh, false);
    const hW = rc.intersectObject(walls.mesh!, false);
    // 合并取最近命中
    let first: THREE.Intersection | null = null;
    let kind = "";
    if (hT.length && hW.length) {
      if (hT[0].distance <= hW[0].distance) { first = hT[0]; kind = "TOP"; }
      else { first = hW[0]; kind = "WALL"; }
    } else if (hT.length) { first = hT[0]; kind = "TOP"; }
    else if (hW.length) { first = hW[0]; kind = "WALL"; }

    const inArcBand = y > arcBottom && y <= h; // 弧带高度区间
    if (!first) {
      // 射线啥也没打中：若高度在台面以下 → 一定是洞（侧面本该封闭）
      if (y < h) {
        holes++;
        holeList.push(`MISS y=${y.toFixed(3)} z=${z} ← 完全穿透(高度低于台面)`);
      }
      continue;
    }
    const hx = first.point.x, hy = first.point.y;
    if (inArcBand) {
      // 弧带高度：第一命中必须是顶面弧面且位置在弧带内 (3.69,4.0]
      if (kind !== "TOP" || hx < 3.5) {
        holes++;
        holeList.push(`ARC-FAIL y=${y.toFixed(3)} z=${z} 首命中=${kind}@x=${hx.toFixed(3)} ← 弧带高度打到的是${kind === "WALL" ? "墙(应为弧面)" : "远处的面"}`);
      } else ok++;
    } else {
      // 弧底以下：首命中应是墙 x=4
      if (kind === "WALL" && Math.abs(hx - edgeX) < 0.01) ok++;
      else if (kind === "TOP" && hx > 3.5) ok++; // 命中弧面下缘也正常
      else {
        holes++;
        holeList.push(`WALL-FAIL y=${y.toFixed(3)} z=${z} 首命中=${kind}@x=${hx.toFixed(3)} ← 弧底以下没打到墙`);
      }
    }
  }
}
console.log(`=== 射线检测（+x 圆角边，y∈[${(arcBottom-0.1).toFixed(2)},${(h+0.1).toFixed(2)}]×${zs.length}条z）===`);
console.log(`正常=${ok}  洞/异常=${holes}`);
for (const s of holeList.slice(0, 40)) console.log("  " + s);
