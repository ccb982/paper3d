/* 射线检测 2：扫描 chunk 内所有凸角（两条圆角边交汇），对角向射线找洞 */
import * as THREE from "three";
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource, finalRuling } from "../src/services/map/Refinements";
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

// 圆角边判定（与 PostProcess.isBevelEdge 同式）
const D4 = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
function isBevel(bx: number, bz: number, dir: number): boolean {
  const cur = src.blockAt(bx, bz);
  if (!cur || tileById(cur.id).genRole !== "platform") return false;
  const d = D4[dir];
  const nb = src.blockAt(bx + d.dx, bz + d.dz);
  if (!nb || tileById(nb.id).genRole !== "ground") return false;
  if (finalRuling(src, bx, bz, dir as 0|1|2|3) !== "cliff") return false;
  return nb.h < cur.h - 0.05;
}

const top = buildPostChunkTopSurface(raster, 0, 0);
const topMesh = new THREE.Mesh(top.geometry);
topMesh.position.set(HALF, 0, HALF);
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
walls.mesh!.position.set(HALF, 0, HALF);
topMesh.updateMatrixWorld(true);
walls.mesh!.updateMatrixWorld(true);
const rc = new THREE.Raycaster();

// 找凸角：块 的 dir 边和 (dir+1)%4 边都是圆角边 → 角点在该方向
// dir0(+x)&dir2(+z)→角(bx*4+4,bz*4+4)；dir1&dir2→(bx*4,bz*4+4)；dir1&dir3→(bx*4,bz*4)；dir0&dir3→(bx*4+4,bz*4)
const corners: { x: number; z: number; h: number; bx: number; bz: number; d1: number; d2: number }[] = [];
const BPS = 15;
for (let bz2 = 0; bz2 < BPS; bz2++) for (let bx2 = 0; bx2 < BPS; bx2++) {
  const b = src.blockAt(bx2, bz2);
  if (!b || tileById(b.id).genRole !== "platform") continue;
  const combos = [[0,2,4,4],[1,2,0,4],[1,3,0,0],[0,3,4,0]] as const;
  for (const [d1, d2, ox, oz] of combos) {
    if (isBevel(bx2, bz2, d1) && isBevel(bx2, bz2, d2)) {
      corners.push({ x: bx2*4+ox, z: bz2*4+oz, h: b.h, bx: bx2, bz: bz2, d1, d2 });
    }
  }
}
console.log(`凸角数=${corners.length}: ${corners.map(c=>`(${c.x},${c.z})h=${c.h.toFixed(2)}`).join(" ")}`);

// 对每个凸角：从对角线外方向发射水平射线，y 扫弧带
let holes = 0; const holeList: string[] = []; let ok = 0;
for (const c of corners) {
  // 角的外对角线方向：由 d1/d2 的外法线合成
  const n1 = D4[c.d1], n2 = D4[c.d2];
  const dx = n1.dx + n2.dx, dz = n1.dz + n2.dz;
  const len = Math.hypot(dx, dz);
  const dirV = new THREE.Vector3(-dx / len, 0, -dz / len); // 从外向角射
  const arcB = c.h - 0.3;
  for (let y = arcB - 0.05; y <= c.h + 0.05; y += 0.02) {
    // 射线起点：角点外 5m 对角方向；加横向偏移覆盖角两侧
    for (const side of [-1, 0, 1]) {
      // 横向 = 垂直于对角方向
      const perp = new THREE.Vector3(-dirV.z, 0, dirV.x);
      const ox2 = c.x - dirV.x * 5 + perp.x * side * 0.3;
      const oz2 = c.z - dirV.z * 5 + perp.z * side * 0.3;
      rc.set(new THREE.Vector3(ox2, y, oz2), dirV);
      const hT = rc.intersectObject(topMesh, false);
      const hW = rc.intersectObject(walls.mesh!, false);
      let first: THREE.Intersection | null = null; let kind = "";
      if (hT.length && hW.length) { first = hT[0].distance <= hW[0].distance ? hT[0] : hW[0]; kind = hT[0].distance <= hW[0].distance ? "TOP" : "WALL"; }
      else if (hT.length) { first = hT[0]; kind = "TOP"; }
      else if (hW.length) { first = hW[0]; kind = "WALL"; }
      const distToCorner = Math.hypot(ox2 - c.x, oz2 - c.z);
      if (y < c.h && !first) {
        holes++;
        holeList.push(`MISS 角(${c.x},${c.z}) y=${y.toFixed(3)} side=${side} 起点(${ox2.toFixed(1)},${oz2.toFixed(1)}) ← 穿透`);
      } else if (first) ok++;
    }
  }
}
console.log(`\n=== 凸角对角射线 ===`);
console.log(`命中=${ok}  穿透(洞)=${holes}`);
for (const s of holeList.slice(0, 30)) console.log("  " + s);
