import { buildFaceTable } from "../src/services/map/FaceTable";
import { topYView } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(30, 30, 2);
const src = raster.chunkSource(0, 0);
const t = buildFaceTable(src, 0, 0);
let rough = 0;
for (const cell of t.cells) {
  const bx = t.cx * 15 + (cell.idx % 15), bz = t.cz * 15 + Math.floor(cell.idx / 15);
  // 每块内部 4 个 1m cell 角 + 内部采样点（0.5 步 7×7，取 max-min）
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const y = topYView(t, src, bx, bz, bx * 4 + j * 0.5 + 0.25, bz * 4 + i * 0.5 + 0.25);
      mn = Math.min(mn, y); mx = Math.max(mx, y);
    }
  }
  const roughHere = mx - mn;
  if (roughHere > 0.05) {
    rough++;
    if (rough <= 12) console.log(`块(${bx},${bz}) role=${cell.role} h=${cell.h.toFixed(2)} 顶差=${roughHere.toFixed(3)} y[${mn.toFixed(2)},${mx.toFixed(2)}]`);
  }
}
console.log(`不平整块(>0.05m) = ${rough} / 225`);
console.log("done");
