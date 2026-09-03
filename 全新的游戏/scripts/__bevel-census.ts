/* 弧边普查：对比「platform→ground 全部下落边」与「检测到的弧边」是否一致 */
import { generateChunk, type ChunkData } from "../src/services/map/ChunkGenerator";
import { makeChunkSource, finalRuling } from "../src/services/map/Refinements";
import { tileById } from "../src/services/map/Tiles";

const cache = new Map<string, ChunkData>();
const seed = 11;
const src = makeChunkSource((a, b) => {
  const k = `${seed}:${a}:${b}`;
  let x = cache.get(k);
  if (!x) { x = generateChunk(seed, a, b); cache.set(k, x); }
  return x;
});
const BPS = 15;
const D4 = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
const dirName = ["+x(东)","-x(西)","+z(南)","-z(北)"];

let platformCount = 0;
const dropEdges: string[] = [];   // platform → 任意更低邻居（不限角色/裁决）
const detected: string[] = [];    // 当前 isBevelEdge 判定命中的

for (let bz = 0; bz < BPS; bz++) for (let bx = 0; bx < BPS; bx++) {
  const cur = src.blockAt(bx, bz);
  if (!cur || tileById(cur.id).genRole !== "platform") continue;
  platformCount++;
  for (let dir = 0; dir < 4; dir++) {
    const d = D4[dir];
    const nb = src.blockAt(bx + d.dx, bz + d.dz);
    if (!nb) { continue; }
    const nbRole = tileById(nb.id).genRole;
    const ruling = finalRuling(src, bx, bz, dir as 0|1|2|3);
    if (nb.h < cur.h - 0.05) {
      dropEdges.push(
        `块(${bx},${bz})h=${cur.h.toFixed(2)} ${dirName[dir]} → ${nbRole}@${nb.h.toFixed(2)} ruling=${ruling}` +
        (nbRole === "ground" && ruling === "cliff" ? " [✓当前判定命中]" : " ←当前判定未命中!")
      );
      if (nbRole === "ground" && ruling === "cliff") detected.push(`${bx},${bz},${dir}`);
    }
  }
}
console.log(`platform 块数=${platformCount}`);
console.log(`platform 的下落边总数=${dropEdges.length}，其中当前判定命中=${detected.length}`);
console.log(`\n下落边清单:`);
for (const e of dropEdges) console.log("  " + e);
