import { buildFaceTable, checkTable } from "../src/services/map/FaceTable";
import { topYView } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";
const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(-60, 120, 2);
const src = raster.chunkSource(-1, 2);
const t = buildFaceTable(src, -1, 2);
const rep = checkTable(t);
console.log(`chunk(-1,2) 检验=${rep.errors.length}`);
const D = [[1,0],[-1,0],[0,1],[0,-1]];
const tbx = -10, tbz = 31;
for (let dz = -1; dz <= 1; dz++) {
  for (let dx = -1; dx <= 1; dx++) {
    const bx = tbx + dx, bz = tbz + dz;
    const b = src.blockAt(bx, bz);
    if (!b) { console.log(`块(${bx},${bz}) 无`); continue; }
    const ccx = Math.floor(bx / 15), ccz = Math.floor(bz / 15);
    const lbx = bx - ccx * 15, lbz = bz - ccz * 15;
    const cell = (ccx === -1 && ccz === 2) ? t.cells[lbz * 15 + lbx] : null;
    const tag = cell ? ` role=${cell.role} h=${cell.h.toFixed(2)}` : " (邻chunk)";
    const sides = cell ? cell.sides.map((s, i) => `d${i}:${s.kind}${s.oppKind !== s.kind ? "/" + s.oppKind : ""} calc=${s.calcDepth.toFixed(2)}`).join(" ") : "";
    console.log(`块(${bx},${bz}) ${tileById(b.id).key} h=${b.h.toFixed(2)}${tag}${cell ? " " + sides : ""}`);
  }
}
// 检查目标块各边墙顶 vs 顶面（各视角）最大差（找不贴合处）
const bx = tbx, bz = tbz;
const cell = t.cells[((bz - 2 * 15)) * 15 + (bx + 15)];
if (cell) {
  console.log("沿边采样 墙顶(本块视角) vs 邻/顶面: ");
  for (let dir = 0; dir < 4; dir++) {
    const s = cell.sides[dir as 0 | 1 | 2 | 3];
    const nbx = bx + D[dir][0], nbz = bz + D[dir][1];
    const x0 = bx * 4, z0 = bz * 4;
    let ax: number, az: number, bx2: number, bz2: number;
    if (dir === 0) { ax = x0 + 4; az = z0; bx2 = x0 + 4; bz2 = z0 + 4; }
    else if (dir === 1) { ax = x0; az = z0; bx2 = x0; bz2 = z0 + 4; }
    else if (dir === 2) { ax = x0; az = z0 + 4; bx2 = x0 + 4; bz2 = z0 + 4; }
    else { ax = x0; az = z0; bx2 = x0 + 4; bz2 = z0; }
    let maxDiff = 0, at = "";
    for (let k = 0; k <= 16; k++) {
      const gx = ax + (bx2 - ax) * (k / 16);
      const gz = az + (bz2 - az) * (k / 16);
      const wTop = topYView(t, src, bx, bz, gx, gz);
      const nTop = topYView(t, src, nbx, nbz, gx, gz);
      const d = Math.abs(wTop - nTop);
      if (d > maxDiff) { maxDiff = d; at = `(${gx.toFixed(1)},${gz.toFixed(1)}) 墙顶=${wTop.toFixed(2)} 邻=${nTop.toFixed(2)}`; }
    }
    console.log(`  d${dir} kind=${s.kind} 沿边墙顶 vs 邻最大差=${maxDiff.toFixed(3)} ${at}`);
  }
}
console.log("done");
