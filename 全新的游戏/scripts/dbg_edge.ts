/** 单边深查：打印边沿线 owner/邻视角精确顶高 vs 壁顶顶点（含上下）逐 0.125m */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildWallGeometry, topYView, topFineCells } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";
import { tileById } from "../src/services/map/Tiles";

const CH = 60, HALF = CH / 2;
const raster = new RasterMap(12345);
raster.updateChunks(1 * CH + 30, 3 * CH + 30, 2);
const src = raster.chunkSource(1, 3);
const t = buildFaceTable(src, 1, 3);
const wall = buildWallGeometry(t, src);
const ox = 1 * CH, oz = 3 * CH;
const fineE = topFineCells(t, src);
const cell = t.cells[(58 % 15) * 15 + (25 % 15)];
console.log(`块(25,58) h=${cell.h} role=${cell.role} sides=${[0,1,2,3].map(d => cell.sides[d as 0|1|2|3].kind + "/" + cell.sides[d as 0|1|2|3].oppKind).join(" ")}`);
for (let d = 0; d < 4; d++) {
  const n = d === 0 ? src.blockAt(26, 58) : d === 1 ? src.blockAt(24, 58) : d === 2 ? src.blockAt(25, 59) : src.blockAt(25, 57);
  console.log(`d${d} 邻(${n?.id ?? "?"}) h=${n?.h.toFixed(2)} role=${n ? tileById(n.id).genRole : "?"} kind=${cell.sides[d as 0|1|2|3].kind}`);
}
// 详细看 d1 边：x=100 常量，z∈[232,236]
const d = 1;
{
  const bx = 25, bz = 58;
  const c = bx * 4; // x
  console.log(`\n=== d1 边 x=${c} z∈[${bz * 4},${bz * 4 + 4}]；每 0.25m 采样，壁顶点(每 0.25 bin 的 hi/lo) ===`);
  const bin = new Map<number, { hi: number; lo: number; n: number }>();
  for (let i = 0; i < wall.vertices.length; i += 3) {
    const wx = wall.vertices[i] + ox + HALF;
    const wz = wall.vertices[i + 2] + oz + HALF;
    if (Math.abs(wx - c) > 0.02 || wz < 231.8 || wz > 236.2) continue;
    const k = Math.round((wz - 232) * 4) / 4;
    const e = bin.get(k) ?? { hi: -1e9, lo: 1e9, n: 0 };
    e.hi = Math.max(e.hi, wall.vertices[i + 1]); e.lo = Math.min(e.lo, wall.vertices[i + 1]); e.n++;
    bin.set(k, e);
  }
  for (let s = 0; s <= 4.001; s += 0.25) {
    const z = bz * 4 + s;
    const owner = topYView(t, src, bx, bz, c, z);
    const e = bin.get(Math.round(s * 4) / 4);
    const sMark = Math.round(s * 100) / 100;
    const fineCell = fineE[((bz % 15) * 4 + Math.floor(s)) * 60 + (bx % 15) * 4];
    console.log(`  s=${sMark.toFixed(2)} 壁顶点=${e?.n ?? 0} hi=${e?.hi.toFixed(3) ?? "-"} lo=${e?.lo.toFixed(3) ?? "-"} | owner视角顶=${owner.toFixed(3)} 本cellFine=${fineCell}`);
  }
  console.log("fineE 沿边 4 格:", [0, 1, 2, 3].map((j) => fineE[((58 % 15) * 4 + j) * 60 + (25 % 15) * 4]).join(","), "| 相邻东块侧:", [0, 1, 2, 3].map((j) => fineE[((58 % 15) * 4 + j) * 60 + (25 % 15) * 4 + 3]).join(","));
}
console.log("done");
