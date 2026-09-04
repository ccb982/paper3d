/** 直接转储指定边线附近的所有墙 quad 顶点（含法线朝向判定归属） */
import { buildFaceTable, oppositeDir } from "../src/services/map/FaceTable";
import { buildWallGeometry, topYView } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";

const CH = 60, HALF = CH / 2;
const seed = 12345;

const raster = new RasterMap(seed);
raster.updateChunks(1 * CH + 30, 3 * CH + 30, 2);
const src = raster.chunkSource(1, 3);
const t = buildFaceTable(src, 1, 3);
const wall = buildWallGeometry(t, src);
const ox = 1 * CH, oz = 3 * CH;

// 该表内块(h=-3=pit/湿地)与地面之间的 weld 边全部列出 + 该边壁顶链
for (let lbz = 0; lbz < 15; lbz++) {
  for (let lbx = 0; lbx < 15; lbx++) {
    const bx = 1 * 15 + lbx, bz = 3 * 15 + lbz;
    const cell = t.cells[lbz * 15 + lbx];
    if (cell.h > -2) continue;
    for (let dir = 0; dir < 4; dir++) {
      const sSide = cell.sides[dir as 0 | 1 | 2 | 3];
      if (sSide.kind !== "weld") continue;
      const nb = src.blockAt(bx + (dir === 0 ? 1 : dir === 1 ? -1 : 0), bz + (dir === 2 ? 1 : dir === 3 ? -1 : 0));
      const role = tileById(nb?.id ?? 0).genRole;
      if (role === "pit" || role === "liquid") continue;
      // 壁顶链：收集该块该边 4m 内 x/z 常量线的顶点 y（顶 = hi）
      const isX = dir < 2;
      const c = isX ? bx * 4 + (dir === 0 ? 4 : 0) : bz * 4 + (dir === 2 ? 4 : 0);
      const b0 = isX ? bz * 4 : bx * 4;
      const pts = new Map<number, { hi: number; lo: number; n: number }>();
      for (let i = 0; i < wall.vertices.length; i += 3) {
        const wx = wall.vertices[i] + ox + HALF;
        const wz = wall.vertices[i + 2] + oz + HALF;
        const along = isX ? wz : wx;
        if (Math.abs((isX ? wx : wz) - c) > 0.02) continue;
        if (along < b0 - 0.02 || along > b0 + 4.02) continue;
        const si = Math.round((along - b0) * 10) / 10;
        const e = pts.get(si) ?? { hi: -1e9, lo: 1e9, n: 0 };
        e.hi = Math.max(e.hi, wall.vertices[i + 1]);
        e.lo = Math.min(e.lo, wall.vertices[i + 1]);
        e.n++;
        pts.set(si, e);
      }
      const ss = [...pts.entries()].sort((a, b) => a[0] - b[0]);
      const nbY = (nb?.h ?? 0);
      console.log(`\n=== 块(${bx},${bz}) h=${cell.h.toFixed(1)} d${dir} weld→ 邻(${nb?.id === undefined ? "?" : `${nb.id}`}) h=${nbY.toFixed(2)} role=${role}`);
      for (const [si, e] of ss) {
        const [x, z] = isX ? [c, b0 + si] : [b0 + si, c];
        const ex = topYView(t, src, bx, bz, x, z);
        const nbEx = topYView(t, src, bx + (dir === 0 ? 1 : dir === 1 ? -1 : 0), bz + (dir === 2 ? 1 : dir === 3 ? -1 : 0), x, z);
        console.log(`  s=${si.toFixed(1)} 顶点=${e.n} 壁顶=${e.hi.toFixed(3)} 壁底=${e.lo.toFixed(3)} | 本块视角顶=${ex.toFixed(3)} 邻块视角顶=${nbEx.toFixed(3)}`);
      }
    }
  }
}
console.log("\ndone");
