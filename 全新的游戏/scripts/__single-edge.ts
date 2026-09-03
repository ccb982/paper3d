/* 复现：只有一个弧边的高台 → 侧壁形状回读 + 射线找洞 */
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

// ---- 找只有一个弧边的高台块 ----
let target: { bx: number; bz: number; dir: number; h: number } | null = null;
const BPS = 15;
outer:
for (let bz = 0; bz < BPS; bz++) for (let bx = 0; bx < BPS; bx++) {
  const b = src.blockAt(bx, bz);
  if (!b || tileById(b.id).genRole !== "platform") continue;
  const dirs: number[] = [];
  for (let d = 0; d < 4; d++) if (isBevel(bx, bz, d)) dirs.push(d);
  if (dirs.length === 1) { target = { bx, bz, dir: dirs[0], h: b.h }; break outer; }
}
if (!target) { console.log("未找到单弧边高台块"); process.exit(1); }
const { bx, bz, dir, h } = target;
console.log(`单弧边高台：块(${bx},${bz}) h=${h.toFixed(3)} 弧边dir=${dir}`);
// 块 4 边情况
for (let d = 0; d < 4; d++) {
  const dd = D4[d];
  const nb = src.blockAt(bx + dd.dx, bz + dd.dz);
  console.log(`  dir${d}: nb=${nb ? tileById(nb.id).genRole + "@" + nb.h.toFixed(2) + " ruling=" + finalRuling(src, bx, bz, d as 0|1|2|3) : "边界外"} ${isBevel(bx, bz, d) ? "←弧边" : ""}`);
}

// 弧边的世界线
const edgeX = dir === 0 ? (bx + 1) * 4 : dir === 1 ? bx * 4 : -1;
const edgeZ = dir === 2 ? (bz + 1) * 4 : dir === 3 ? bz * 4 : -1;

const top = buildPostChunkTopSurface(raster, 0, 0);
const topMesh = new THREE.Mesh(top.geometry);
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());
walls.mesh!.position.set(HALF, 0, HALF);
topMesh.position.set(HALF, 0, HALF);
topMesh.updateMatrixWorld(true);
walls.mesh!.updateMatrixWorld(true);

// ---- ① 侧壁形状回读（该边墙顶轮廓） ----
const W = walls.buffers.vertices, WI = walls.buffers.indices, WN = walls.buffers.normals;
const used = new Set<number>();
for (let i = 0; i < WI.length; i++) used.add(WI[i]);
const dnx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
const dnz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
const pts: { a: number; y: number; t: number }[] = [];
for (const vi of used) {
  if (WN[vi * 3] !== dnx || WN[vi * 3 + 2] !== dnz) continue;
  const wx = W[vi * 3] + HALF, wz = W[vi * 3 + 2] + HALF;
  if (edgeX >= 0 ? Math.abs(wx - edgeX) > 1e-5 : Math.abs(wz - edgeZ) > 1e-5) continue;
  const a = edgeX >= 0 ? wz : wx;
  if (a < (dir < 2 ? bz * 4 : bx * 4) - 1e-5 || a > (dir < 2 ? (bz + 1) * 4 : (bx + 1) * 4) + 1e-5) continue;
  pts.push({ a, y: W[vi * 3 + 1], t: vi % 4 });
}
pts.sort((p, q) => p.a - q.a || p.t - q.t);
console.log(`\n① 该弧边墙顶点（a=沿边坐标, t0/1=顶边 t2/3=底边）:`);
for (const p of pts) console.log(`  a=${p.a.toFixed(3)} y=${p.y.toFixed(4)} [t${p.t}]`);

// ---- ② 射线找洞：从弧边外侧垂直射入 + 两端斜向 ----
const rc = new THREE.Raycaster();
const arcB = h - 0.3;
let holes = 0; const holeList: string[] = []; let ok = 0;
const dirV = new THREE.Vector3(-dnx, 0, -dnz); // 从外朝墙（墙法线朝外，射线反向）
for (let y = arcB - 0.15; y <= h + 0.15; y += 0.02) {
  for (let a = 0.125; a < 4; a += 0.25) {
    // 墙面点（世界）
    const px = edgeX >= 0 ? edgeX : a;
    const pz = edgeX >= 0 ? a : edgeZ;
    origin2: {
      const o = new THREE.Vector3(px + dnx * 6 + dnz * 0, y, pz + dnz * 6);
      // 三条平行微偏射线：正对 + 沿边偏±0.02（查 quad 间缝）
      for (const off of [-0.02, 0, 0.02]) {
        const oo = new THREE.Vector3(o.x + (edgeX >= 0 ? 0 : off) * -dnz * 0 + (edgeX >= 0 ? 0 : 0), y, o.z);
        if (edgeX >= 0) oo.z += off; else oo.x += off;
        rc.set(oo, dirV);
        const hT = rc.intersectObject(topMesh, false);
        const hW = rc.intersectObject(walls.mesh!, false);
        let first: THREE.Intersection | null = null; let kind = "";
        if (hT.length && hW.length) { const t = hT[0].distance <= hW[0].distance ? hT[0] : hW[0]; first = t; kind = t === hT[0] ? "TOP" : "WALL"; }
        else if (hT.length) { first = hT[0]; kind = "TOP"; }
        else if (hW.length) { first = hW[0]; kind = "WALL"; }
        if (!first) {
          if (y < h) { holes++; holeList.push(`MISS y=${y.toFixed(3)} a=${a.toFixed(3)} off=${off} ← 穿透`); }
          continue;
        }
        if (y <= arcB + 0.001) {
          // 弧底以下必须命中该墙
          if (kind === "WALL") ok++; else { holes++; holeList.push(`y=${y.toFixed(3)} a=${a.toFixed(3)} off=${off} 首命中=${kind} ← 弧底以下没打到墙`); }
        } else {
          // 弧带内：命中弧面或墙都算封闭
          ok++;
        }
      }
    }
  }
}
console.log(`\n② 射线检测：正常=${ok} 洞=${holes}`);
for (const s of holeList.slice(0, 30)) console.log("  " + s);
