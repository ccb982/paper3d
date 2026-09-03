/* 回读探针：单个圆角边高台的侧壁 vs 顶面实际几何对比 */
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
(globalThis as any).__PP_DEBUG = true;
const src = makeChunkSource((a, b) => getChunk(seed, a, b) as ChunkData | undefined);
const raster = {
  worldSeed: seed,
  chunkSource: () => src,
  getChunkData: () => undefined,
  heightAt: (x: number, z: number) => {
    const gx = Math.floor(x), gz = Math.floor(z);
    const B = src.blockAt(Math.floor(gx / 4), Math.floor(gz / 4));
    return B ? B.h : 0;
  },
  tileDefAt: (x: number, z: number) => {
    const gx = Math.floor(x), gz = Math.floor(z);
    const B = src.blockAt(Math.floor(gx / 4), Math.floor(gz / 4));
    return tileById(B ? B.id : 0);
  },
} as any;

// ---- 找圆角边：platform 块，邻居 ground 且更低 ----
const BPS = 15;
let found: { bx: number; bz: number; dir: number; h: number; nbH: number } | null = null;
for (let bz = 0; bz < BPS && !found; bz++) {
  for (let bx = 0; bx < BPS && !found; bx++) {
    const b = src.blockAt(bx, bz);
    if (!b || tileById(b.id).genRole !== "platform") continue;
    for (let dir = 0; dir < 4; dir++) {
      const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
      const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
      const nb = src.blockAt(bx + dx, bz + dz);
      if (!nb) continue;
      if (tileById(nb.id).genRole !== "ground") continue;
      if (nb.h >= b.h - 0.05) continue;
      found = { bx, bz, dir, h: b.h, nbH: nb.h };
      break;
    }
  }
}
if (!found) { console.log("no bevel edge found in chunk 0,0 seed", seed); process.exit(1); }
const { bx, bz, dir, h, nbH } = found;
console.log(`[found] block=(${bx},${bz}) dir=${dir} platformH=${h} groundH=${nbH}`);

// 该块 4 边邻居角色（确认是否“只有一个弧边”）
for (let d = 0; d < 4; d++) {
  const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
  const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
  const nb = src.blockAt(bx + dx, bz + dz);
  console.log(`  dir${d}: nb=${nb ? tileById(nb.id).genRole + "@" + nb.h : "none"}`);
}

// ---- 构建实际几何 ----
const top = buildPostChunkTopSurface(raster, 0, 0);
const albedo = new THREE.Texture(); const lightmap = new THREE.Texture();
const walls = buildPostSideWalls(raster, 0, 0, albedo, lightmap);

// ---- ① 顶面网格：找边界线上的顶点，看实际高度分布 ----
// 世界边界线：dir=0 → x=(bx+1)*4；dir=1 → x=bx*4；dir=2 → z=(bz+1)*4；dir=3 → z=bz*4
const edgeX = dir === 0 ? (bx + 1) * 4 : dir === 1 ? bx * 4 : -1;
const edgeZ = dir === 2 ? (bz + 1) * 4 : dir === 3 ? bz * 4 : -1;
const V = top.vertices;
const edgeTopPts: { a: number; y: number }[] = [];
for (let i = 0; i < V.length / 3; i++) {
  const wx = V[i * 3] + 0 + HALF;   // chunk 0 → 世界
  const wz = V[i * 3 + 2] + 0 + HALF;
  const y = V[i * 3 + 1];
  if (edgeX >= 0 && Math.abs(wx - edgeX) < 1e-6) {
    if (wz >= bz * 4 - 1e-6 && wz <= (bz + 1) * 4 + 1e-6) edgeTopPts.push({ a: wz, y });
  } else if (edgeZ >= 0 && Math.abs(wz - edgeZ) < 1e-6) {
    if (wx >= bx * 4 - 1e-6 && wx <= (bx + 1) * 4 + 1e-6) edgeTopPts.push({ a: wx, y });
  }
}
edgeTopPts.sort((p, q) => p.a - q.a);
console.log(`\n[顶面边界线顶点] 共 ${edgeTopPts.length} 个（理论高度应为 h-0.3=${h - 0.3}）:`);
for (const p of edgeTopPts) console.log(`  a=${p.a.toFixed(3)} y=${p.y.toFixed(4)} ${p.y < h - 0.305 ? "←低于弧底!" : p.y > h - 0.295 ? "←高于弧底!" : ""}`);

// ---- ② 顶面网格：边界向内 0.5m 剖面（看弧形是否正常，有没有额外下挖） ----
console.log(`\n[顶面边界→内 0.5m 剖面]（边中点处）:`);
const mid = (bx + 0.5) * 4;
const forX = dir === 0, backX = dir === 1, forZ = dir === 2, backZ = dir === 3;
for (let t = 0; t <= 10; t++) {
  const d = t * 0.05;
  const wx = forX ? edgeX - d : backX ? edgeX + d : mid;
  const wz = forZ ? edgeZ - d : backZ ? edgeZ + d : mid;
  // 从顶面几何里找最近顶点
  let best = -1, bd = 1e9;
  for (let i = 0; i < V.length / 3; i++) {
    const dx2 = V[i * 3] + HALF - wx, dz2 = V[i * 3 + 2] + HALF - wz;
    const dd = dx2 * dx2 + dz2 * dz2;
    if (dd < bd) { bd = dd; best = i; }
  }
  console.log(`  d=${d.toFixed(2)} nearest顶点y=${V[best * 3 + 1].toFixed(4)} (dist=${Math.sqrt(bd).toFixed(3)})`);
}

// ---- ③ 墙：找该边法线方向的墙顶点，看实际墙顶高度 ----
const W = walls.buffers.vertices;
const Wn = walls.buffers.normals;
const dnx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
const dnz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
const wallPts: { a: number; y: number }[] = [];
for (let i = 0; i < W.length / 3; i++) {
  if (Wn[i * 3] !== dnx || Wn[i * 3 + 2] !== dnz) continue;
  const wx = W[i * 3] + HALF, wz = W[i * 3 + 2] + HALF, y = W[i * 3 + 1];
  if (edgeX >= 0 && Math.abs(wx - edgeX) < 1e-6 && wz >= bz * 4 - 1e-6 && wz <= (bz + 1) * 4 + 1e-6) wallPts.push({ a: wz, y });
  else if (edgeZ >= 0 && Math.abs(wz - edgeZ) < 1e-6 && wx >= bx * 4 - 1e-6 && wx <= (bx + 1) * 4 + 1e-6) wallPts.push({ a: wx, y });
}
wallPts.sort((p, q) => p.a - q.a);
console.log(`\n[墙顶点] 该边共 ${wallPts.length} 个:`);
for (const p of wallPts) console.log(`  a=${p.a.toFixed(3)} y=${p.y.toFixed(4)}`);

// ---- ④ 缺口检测：墙顶(quad顶边) vs 顶面同位置同view顶点 精确匹配 ----
{
  const WI = walls.buffers.indices;
  const used = new Set<number>();
  for (let i = 0; i < WI.length; i++) used.add(WI[i]);
  const post = buildPostChunkTopSurface(raster, 0, 0);
  const TV = post.vertices;
  // 顶面顶点索引：key = x|z|viewBx|viewBz（顶面局部 x,z → 世界；view = cell 所属块）
  const topMap = new Map<string, number>();
  for (let i = 0; i < TV.length / 3; i++) {
    const wx = TV[i * 3] + HALF, wz = TV[i * 3 + 2] + HALF;
    const vbx = Math.floor(wx / 4), vbz = Math.floor(wz / 4);
    topMap.set(`${wx.toFixed(4)}|${wz.toFixed(4)}|${vbx}|${vbz}`, TV[i * 3 + 1]);
  }
  const UV = walls.buffers.uvs;
  const gaps: string[] = [];
  let count = 0, matched = 0;
  for (const vi of [...used].sort((a, b) => a - b)) {
    if (vi % 4 >= 2) continue; // 只查顶边 2 顶点
    const y = W[vi * 3 + 1];
    const wx = W[vi * 3] + HALF, wz = W[vi * 3 + 2] + HALF;
    const q = Math.floor(vi / 4);
    const tblX = Math.round(UV[q * 8] * 15 - 0.5);
    const tblZ = Math.round(UV[q * 8 + 1] * 15 - 0.5);
    const key = `${wx.toFixed(4)}|${wz.toFixed(4)}|${tblX}|${tblZ}`;
    const topY = topMap.get(key);
    if (topY === undefined) continue; // 顶面无此(位置,view)顶点（如 chunk 外缘）→ 跳过
    matched++;
    const diff = y - topY;
    if (Math.abs(diff) <= 0.005) continue;
    count++;
    if (gaps.length >= 25) continue;
    gaps.push(`(${wx.toFixed(2)},${wz.toFixed(2)}) view(${tblX},${tblZ}) 墙y=${y.toFixed(4)} 顶面=${topY.toFixed(4)} 差=${diff.toFixed(4)}`);
  }
  console.log(`\n[缺口检测] 匹配到顶面顶点的墙顶=${matched}，其中|差|>5mm 的真缺口=${count} 处`);
  for (const g of gaps) console.log("  " + g);
}
