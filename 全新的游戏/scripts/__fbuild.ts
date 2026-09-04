/**
 * FaceBuild 冒烟：构建表 → 顶面/侧壁几何 → 自洽检查（索引范围/包围盒/样例段）。
 */
import { buildFaceTable, checkTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry, topYAt } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const table = buildFaceTable(src, cx, cz);
  const rep = checkTable(table);
  const top = buildTopGeometry(table, src);
  const wall = buildWallGeometry(table, src);

  // 自洽
  const nVT = top.vertices.length / 3, nVW = wall.vertices.length / 3;
  let maxIT = 0; for (const v of top.indices) maxIT = Math.max(maxIT, v);
  let maxIW = 0; for (const v of wall.indices) maxIW = Math.max(maxIW, v);
  // 包围盒
  const bb = (V: Float32Array) => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 1; i < V.length; i += 3) { mn = Math.min(mn, V[i]); mx = Math.max(mx, V[i]); }
    return [mn, mx];
  };
  const [topMin, topMax] = bb(top.vertices);
  const [wMin, wMax] = bb(wall.vertices);
  console.log(`seed=${seed} chunk(${cx},${cz}) 检验=${rep.errors.length} 错`);
  console.log(`  顶面: verts=${nVT} tris=${top.indices.length / 3} 索引合法=${maxIT < nVT} y∈[${topMin.toFixed(2)},${topMax.toFixed(2)}]`);
  console.log(`  侧壁: verts=${nVW} quads=${wall.indices.length / 6} 索引合法=${maxIW < nVW} y∈[${wMin.toFixed(2)},${wMax.toFixed(2)}]`);
  // 样例：第一个 bevel 块周围顶面高度
  let printed = 0;
  for (const cell of table.cells) {
    for (let d = 0; d < 4; d++) {
      const s = cell.sides[d as 0 | 1 | 2 | 3];
      if (s.kind !== "bevel" || printed >= 3) continue;
      printed++;
      const bx = table.cx * 15 + (cell.idx % 15);
      const bz = table.cz * 15 + Math.floor(cell.idx / 15);
      const px = bx * 4 + 2, pz = bz * 4 + 2;
      // 顶面中心与棱内 0.1m（弧带内）采样
      const cY = topYAt(table, src, px, pz);
      const nearY = topYAt(table, src, px, pz - 0.1); // 视方向可能不准，仅看值域
      console.log(`  bevel样例 块(${bx},${bz}) d${d} 顶中 y=${cY.toFixed(2)} 邻 0.1m y=${nearY.toFixed(2)} depth=${s.depth.toFixed(2)}`);
    }
  }
}

run(12345, 0, 0);
run(12345, 0, 1);
run(42, 0, 0);
console.log("done");
