import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(30, 90, 2);
const src = raster.chunkSource(0, 1);
const t = buildFaceTable(src, 0, 1);
const top = buildTopGeometry(t, src);
const wall = buildWallGeometry(t, src);
let nanTop = 0, nanWall = 0;
for (const v of top.vertices) if (!isFinite(v)) nanTop++;
for (const v of wall.vertices) if (!isFinite(v)) nanWall++;
console.log(`顶面 NaN=${nanTop} verts=${top.vertices.length / 3} | 侧壁 NaN=${nanWall} verts=${wall.vertices.length / 3}`);
// 目标块（世界 11,22 → 局部 (11,7)）
const bx = 11, bz = 22;
const cell = t.cells[(bz % 15) * 15 + bx];
console.log(`块(${bx},${bz}) role=${cell.role} h=${cell.h.toFixed(2)}`);
for (let d = 0; d < 4; d++) {
  const s = cell.sides[d as 0 | 1 | 2 | 3];
  console.log(`  d${d} kind=${s.kind} calc=${s.calcDepth.toFixed(2)} depth=${s.depth.toFixed(2)} topY=${s.topEdgeY.toFixed(2)}`);
}
// 顶面该区域（x44-48,z88-92 → 局部 lx44-48,lz28-32）顶点数应为 5×5*4？检查是否有输出顶点接近
let inX = 0;
for (let i = 0; i < top.vertices.length; i += 3) {
  const lx = top.vertices[i] + 30 + 60 * 0;
  const lz = top.vertices[i + 2] + 30 + 60 * 0;
  void lx; void lz;
}
console.log("done");
