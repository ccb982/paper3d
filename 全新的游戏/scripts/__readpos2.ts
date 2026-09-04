import { buildFaceTable, checkTable } from "../src/services/map/FaceTable";
import { topYView } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";
const CH = 60;
const raster = new RasterMap(12345);
raster.updateChunks(-60, 120, 2);
const src = raster.chunkSource(-1, 2);
const srcN = raster.chunkSource(-1, 1);
const t = buildFaceTable(src, -1, 2);
const tN = buildFaceTable(srcN, -1, 1);
checkTable(t); checkTable(tN);
// 焦点：z=120 线，x∈[-44,-32]（块 -11..-8, 北邻 29/30）
for (const [bzN, bzS] of [[29, 30], [29, 30]] as const) {
  void bzN; void bzS;
}
for (let bx = -11; bx <= -8; bx++) {
  const cN = tN.cells[(29 - 15) * 15 + (bx + 15)];
  const cS = t.cells[(30 - 30) * 15 + (bx + 15)];
  const bN = srcN.blockAt(bx, 29), bS = src.blockAt(bx, 30);
  const infoN = cN ? `role=${cN.role} h=${cN.h.toFixed(2)} d2=${cN.sides[2].kind}` : "";
  const infoS = cS ? `role=${cS.role} h=${cS.h.toFixed(2)} d3=${cS.sides[3].kind}` : "";
  console.log(`块北(${bx},29) ${bN ? tileById(bN.id).key : "?"} ${infoN} | 块南(${bx},30) ${bS ? tileById(bS.id).key : "?"} ${infoS}`);
}
// 沿 z=120 采样（x=-38.8 附近 x∈[-41,-37]）：北高块视角顶 vs 南低块视角顶（坡 crest?）与墙所在
console.log("z=120 线采样（视角北块 29 / 视角南块 30）:");
for (let gx = -41; gx <= -37; gx++) {
  const yN = topYView(tN, srcN, bxOf(gx), 29, gx, 120);
  const yS = topYView(t, src, bxOf(gx), 30, gx, 120);
  console.log(`  x=${gx} 北视角=${yN.toFixed(2)} 南视角=${yS.toFixed(2)}`);
}
// z=121（坡带内）南块视角
console.log("z=121 线（坡带）南视角:");
for (let gx = -41; gx <= -37; gx++) {
  const yS = topYView(t, src, bxOf(gx), 30, gx, 121);
  console.log(`  x=${gx} y=${yS.toFixed(2)}`);
}
function bxOf(gx: number) { return Math.floor(gx / 4); }
console.log("done");
