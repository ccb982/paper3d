/** fine 图构成统计 + 构建耗时（复测 weld/bevel 外扩后的体量） */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry, topYView, topFineCells } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { rampWidthOf } from "../src/services/map/Refinements";

const CH = 60, N = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const table = buildFaceTable(src, cx, cz);
  const t0 = performance.now();
  const fineE = topFineCells(table, src);
  const t1 = performance.now();
  const top = buildTopGeometry(table, src);
  const t2 = performance.now();
  const wall = buildWallGeometry(table, src);
  const t3 = performance.now();
  let f = 0; for (const v of fineE) f += v;

  // fine/coarse 混合共享边计数（潜在细缝位）
  let mixed = 0;
  const isFine = (lx: number, lz: number) => lx >= 0 && lz >= 0 && lx < N && lz < N && fineE[lz * N + lx] === 1;
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      if (isFine(lx, lz)) continue;
      if (isFine(lx + 1, lz)) mixed++;
      if (isFine(lx, lz + 1)) mixed++;
    }
  }
  const tris = top.indices.length / 3;
  console.log(`seed=${seed} chunk(${cx},${cz}) fine=${f}/3600 混合边=${mixed} 顶tris=${tris} 顶=${(t2 - t1).toFixed(0)}ms 壁=${(t3 - t2).toFixed(0)}ms 图=${(t1 - t0).toFixed(0)}ms`);
}

run(12345, 0, 0);
run(12345, 1, 3);
run(42, 0, 0);
console.log("done");
void topYView; void rampWidthOf;
