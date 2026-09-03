/* 对比弧边(块0,5 dir=1)两端顶面边缘 vs 侧壁/封片几何 */
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
const walls = buildPostSideWalls(raster, 0, 0, new THREE.Texture(), new THREE.Texture());

const bx = 0, bz = 5, h = src.blockAt(bx, bz)!.h, arcB = h - 0.3;
console.log(`块(${bx},${bz}) h=${h.toFixed(3)} 弧底=${arcB.toFixed(3)} 弧边=x=0线 z∈[20,24]`);
console.log(`邻块：z<20=(0,4)? z>24=(0,6)?`);
for (const [nz, name] of [[4, "南邻(0,4)"], [6, "北邻(0,6)"]]) {
  const nb = src.blockAt(0, nz);
  console.log(`  ${name}: ${nb ? tileById(nb.id).genRole + "@" + nb.h.toFixed(2) : "无"} 东边(x=0侧)...`);
  // 检查邻块的 dir=1(x=0边?) —— (0,4) 的 -x 边在 x=0；它也是弧边吗？
  const cur2 = src.blockAt(0, nz)!;
  console.log(`    (0,${nz})的dir0(+x, x=4线?) ... 简化打印 (0,${nz}) 的 -x 邻`);
  const wx = src.blockAt(-1, nz);
  console.log(`    -x邻(-1,${nz}): ${wx ? tileById(wx.id).genRole + "@" + wx.h.toFixed(2) : "无"} ruling=${nb ? finalRuling(src, 0, nz, 1) : "?"}`);
}

// 顶面边缘顶点：x∈[-0.02,0.35], z=20 和 z=24 两条线
const TV = top.vertices;
for (const zl of [20, 24]) {
  console.log(`\n[顶面] z=${zl} 线 x∈[-0.02,0.35] 顶点:`);
  const rows = new Map<string, number>();
  for (let i = 0; i < TV.length / 3; i++) {
    const wx = TV[i * 3] + HALF, wz = TV[i * 3 + 2] + HALF;
    if (Math.abs(wz - zl) > 1e-4) continue;
    if (wx < -0.02 || wx > 0.35) continue;
    const vbx = Math.floor(wx / 4), vbz = Math.floor(wz / 4);
    rows.set(`${wx.toFixed(3)}|v(${vbx},${vbz})`, TV[i * 3 + 1]);
  }
  for (const [k, v] of [...rows.entries()].sort()) console.log(`  x=${k} y=${v.toFixed(4)}`);
}
// 墙/封片几何顶点：同样位置
console.log(`\n[墙/封片] z=20/24 线 x∈[-0.02,0.35] 顶点:`);
const W = walls.buffers.vertices, WN = walls.buffers.normals;
for (const zl of [20, 24]) {
  console.log(` z=${zl}:`);
  const seen = new Set<string>();
  for (let i = 0; i < W.length / 3; i++) {
    const wx = W[i * 3] + HALF, wz = W[i * 3 + 2] + HALF;
    if (Math.abs(wz - zl) > 1e-4) continue;
    if (wx < -0.02 || wx > 0.35) continue;
    const k = `${wx.toFixed(3)}|${W[i*3+1].toFixed(3)}`;
    if (seen.has(k)) continue; seen.add(k);
    console.log(`   x=${wx.toFixed(3)} y=${W[i * 3 + 1].toFixed(4)} n=(${WN[i*3]},${WN[i*3+2]})`);
  }
}
