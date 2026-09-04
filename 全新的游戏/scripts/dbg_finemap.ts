/** 统计 fine 图构成：bevel 源 / weld 曲率源 / 外扩 —— 计数与分布 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { topFineCells, cellBevelFine } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { topYView } from "../src/services/map/FaceBuild";
import { rampWidthOf } from "../src/services/map/Refinements";

const CH = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const table = buildFaceTable(src, cx, cz);
  const t0 = performance.now();
  const fineE = topFineCells(table, src);
  const t1 = performance.now();

  // 独立复算 weld 曲率源（不扩）计数：逐 weld 块 cell 测
  let weldSrc = 0, bevelSrc = 0, rawBevel = 0;
  const cellsWeld = new Set<number>();
  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      const cell = table.cells[lbz * 15 + lbx];
      let hasWeld = false;
      for (let d = 0; d < 4; d++) if (cell.sides[d as 0 | 1 | 2 | 3].kind === "weld") hasWeld = true;
      const bx = cx * 15 + lbx, bz = cz * 15 + lbz;
      for (let jz = 0; jz < 4; jz++) {
        for (let jx = 0; jx < 4; jx++) {
          const lx = lbx * 4 + jx, lz = lbz * 4 + jz;
          const idx = lz * N + lx;
          if (cellBevelFine(table, src, lx, lz)) { bevelSrc++; rawBevel++; continue; }
          if (!hasWeld) continue;
          // 复算：与本块任一 weld 棱距离 < 坡带宽？
          const wx0 = cx * N + lx, wz0 = cz * N + lz;
          const nearD = [
            Math.max(0, (bx + 1) * 4 - wx0 - 1),
            Math.max(0, wx0 - bx * 4),
            Math.max(0, (bz + 1) * 4 - wz0 - 1),
            Math.max(0, wz0 - bz * 4),
          ];
          let band = false;
          for (let d = 0; d < 4; d++) {
            if (cell.sides[d as 0 | 1 | 2 | 3].kind === "weld" && nearD[d] < rampWidthOf(src, bx, bz, d as 0 | 1 | 2 | 3)) band = true;
          }
          if (!band) continue;
          // 5 点偏差测
          const y00 = topYView(table, src, bx, bz, wx0, wz0);
          const y10 = topYView(table, src, bx, bz, wx0 + 1, wz0);
          const y11 = topYView(table, src, bx, bz, wx0 + 1, wz0 + 1);
          const y01 = topYView(table, src, bx, bz, wx0, wz0 + 1);
          const dev = (p: number, e: number) => Math.abs(p - e) > 0.03;
          const bad =
            dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 0.5), (y01 + y10) / 2) ||
            dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0), (y00 + y10) / 2) ||
            dev(topYView(table, src, bx, bz, wx0 + 0.5, wz0 + 1), (y01 + y11) / 2) ||
            dev(topYView(table, src, bx, bz, wx0, wz0 + 0.5), (y00 + y01) / 2) ||
            dev(topYView(table, src, bx, bz, wx0 + 1, wz0 + 0.5), (y10 + y11) / 2);
          if (bad) { weldSrc++; cellsWeld.add(idx); }
        }
      }
    }
  }
  // bevel 周边（含扩前的 bevel 相邻）与总 fine
  const expanded = new Set<number>();
  let total = 0;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (!fineE[lz * N + lx]) continue;
      total++;
      if (!cellsWeld.has(lz * N + lx)) expanded.add(lz * N + lx);
    }
  }
  console.log(`seed=${seed} chunk(${cx},${cz}) fine总=${total}/3600 | 源: bevel=${bevelSrc} weld曲率=${weldSrc} 其余=外扩 | 外扩非源=${expanded.size}`);
  console.log(`  fine图耗时=${(t1 - t0).toFixed(0)}ms`);
}
const N = 60;
run(12345, 0, 0);
run(12345, 1, 3);
console.log("done");
