/** FaceBuild 冒烟 + 耗时：三块 chunk 顶面/侧壁构建耗时（含 fine map） */
import { buildFaceTable, checkTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const table = buildFaceTable(src, cx, cz);
  const rep = checkTable(table);
  const t0 = performance.now();
  const top = buildTopGeometry(table, src);
  const t1 = performance.now();
  const wall = buildWallGeometry(table, src);
  const t2 = performance.now();

  const nVT = top.vertices.length / 3, nVW = wall.vertices.length / 3;
  let maxIT = 0; for (const v of top.indices) maxIT = Math.max(maxIT, v);
  let maxIW = 0; for (const v of wall.indices) maxIW = Math.max(maxIW, v);
  const bb = (V: Float32Array) => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 1; i < V.length; i += 3) { mn = Math.min(mn, V[i]); mx = Math.max(mx, V[i]); }
    return [mn, mx];
  };
  const [topMin, topMax] = bb(top.vertices);
  const [wMin, wMax] = bb(wall.vertices);
  console.log(`seed=${seed} chunk(${cx},${cz}) 检验=${rep.errors.length} 错 | 表耗时=${(t1 - t0 - (t2 - t1)).toFixed(0)}?`);
  console.log(`  顶面: verts=${nVT} tris=${top.indices.length / 3} 索引合法=${maxIT < nVT} y∈[${topMin.toFixed(2)},${topMax.toFixed(2)}]`);
  console.log(`  侧壁: verts=${nVW} quads=${wall.indices.length / 6} 索引合法=${maxIW < nVW} y∈[${wMin.toFixed(2)},${wMax.toFixed(2)}]`);
  console.log(`  耗时: 顶=${(t1 - t0).toFixed(0)}ms 壁=${(t2 - t1).toFixed(0)}ms 总=${(t2 - t0).toFixed(0)}ms`);
}

run(12345, 0, 0);
run(12345, 1, 3);
run(42, 0, 0);
console.log("done");
