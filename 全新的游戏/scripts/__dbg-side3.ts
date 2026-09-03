/* dump dir=3（黄）弧边的左右侧壁计算过程 */
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource, finalRuling } from "../src/services/map/Refinements";
import { tileById } from "../src/services/map/Tiles";
const cache = new Map<string, ChunkData>();
const seed = 11;
const src = makeChunkSource((a, b) => {
  const k = `${seed}:${a}:${b}`;
  let x = cache.get(k); if (!x) { x = generateChunk(seed, a, b); cache.set(k, x); }
  return x;
});
const WD = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
];
const isBevelEdge = (bx: number, bz: number, dir: number): boolean => {
  const cur = src.blockAt(bx, bz);
  if (!cur || tileById(cur.id).genRole !== "platform") return false;
  const wd = WD[dir];
  const nb = src.blockAt(bx + wd.dx, bz + wd.dz);
  if (!nb || tileById(nb.id).genRole !== "ground") return false;
  if (finalRuling(src, bx, bz, dir as 0|1|2|3) !== "cliff") return false;
  return nb.h < cur.h - 0.05;
};
// 找一条 dir=3 弧边
for (let bz = 0; bz < 15; bz++) for (let bx = 0; bx < 15; bx++) {
  if (!isBevelEdge(bx, bz, 3)) continue;
  console.log(`=== dir=3 弧边 块(${bx},${bz}) h=${src.blockAt(bx, bz)!.h.toFixed(2)} ===`);
  const cur = src.blockAt(bx, bz)!;
  for (const sd of [2, 3] as const) {  // dir+2=1, dir+3=0 —— 实际调用是 1 和 0，但列全 4 边更清楚
  }
  // 实际调用 drawSideWall(1) 和 drawSideWall(0)
  for (const sd of [0, 1, 2, 3] as const) {
    const wsd = WD[sd];
    const sb = src.blockAt(bx + wsd.dx, bz + wsd.dz);
    const role = sb ? tileById(sb.id).genRole : "无";
    const selfBevel = isBevelEdge(bx, bz, sd);
    // near 判定
    const dir = 3;
    const nearIsA = dir === 0 ? wsd.ax === 1 : dir === 1 ? wsd.ax === 0 : dir === 2 ? wsd.az === 1 : wsd.az === 0;
    const eAx = bx * 4 + wsd.ax * 4, eAz = bz * 4 + wsd.az * 4;
    const eBx = bx * 4 + wsd.bx * 4, eBz = bz * 4 + wsd.bz * 4;
    const nearX = nearIsA ? eAx : eBx, nearZ = nearIsA ? eAz : eBz;
    const farX = nearIsA ? eBx : eAx, farZ = nearIsA ? eBz : eAz;
    console.log(`  sd=${sd}(${sd === 0 ? "东" : sd === 1 ? "西" : sd === 2 ? "南" : "北"}边) 邻=${role}${selfBevel ? "【自身弧边→跳过】" : ""} near=(${nearX},${nearZ}) far=(${farX},${farZ})`);
  }
  // dir=3 的调用：drawSideWall(1) 和 drawSideWall(0)
  const process = (sd: 0 | 1 | 2 | 3) => {
    if (isBevelEdge(bx, bz, sd)) { console.log(`  调用 sd=${sd}: 自身弧边跳过`); return; }
    const wsd = WD[sd];
    const sb = src.blockAt(bx + wsd.dx, bz + wsd.dz);
    if (!sb) { console.log(`  调用 sd=${sd}: 邻块不存在跳过`); return; }
    const dir = 3;
    const nearIsA = dir === 0 ? wsd.ax === 1 : dir === 1 ? wsd.ax === 0 : dir === 2 ? wsd.az === 1 : wsd.az === 0;
    const eAx = bx * 4 + wsd.ax * 4, eAz = bz * 4 + wsd.az * 4;
    const eBx = bx * 4 + wsd.bx * 4, eBz = bz * 4 + wsd.bz * 4;
    const nearX = nearIsA ? eAx : eBx, nearZ = nearIsA ? eAz : eBz;
    const farX = nearIsA ? eBx : eAx, farZ = nearIsA ? eBz : eAz;
    const ux = Math.sign(farX - nearX), uz = Math.sign(farZ - nearZ);
    const farBevel = isBevelEdge(bx + ux, bz + uz, sd);
    const farRole = src.blockAt(bx + wsd.dx + ux, bz + wsd.dz + uz);
    console.log(`  调用 sd=${sd}: near=(${nearX},${nearZ}) far=(${farX},${farZ}) far端邻居块=(${bx + ux},${bz + uz})${farRole ? tileById(farRole.id).genRole : "?"} farBevel=${farBevel}`);
  };
  process(1); // dir+2
  process(0); // dir+3
  process(2); // 对照：对面
  break;
}
