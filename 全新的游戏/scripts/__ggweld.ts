import { buildFaceTable } from "../src/services/map/FaceTable";
import { tileById } from "../src/services/map/Tiles";
import { RasterMap } from "../src/services/map/RasterMap";
const CH = 60;
const D = [[1,0],[-1,0],[0,1],[0,-1]];
for (const seed of [12345, 42]) {
  for (const [cx, cz] of [[0, 0], [0, 1]]) {
    const raster = new RasterMap(seed);
    raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
    const src = raster.chunkSource(cx, cz);
    const t = buildFaceTable(src, cx, cz);
    let ggAll = 0, ggWeld = 0;
    const samples: string[] = [];
    for (const cell of t.cells) {
      if (cell.role !== "ground") continue;
      const bx = t.cx * 15 + (cell.idx % 15), bz = t.cz * 15 + Math.floor(cell.idx / 15);
      for (let d = 0; d < 4; d++) {
        const nb = src.blockAt(bx + D[d][0], bz + D[d][1]);
        if (!nb || tileById(nb.id).genRole !== "ground") continue;
        ggAll++;
        const s = cell.sides[d as 0 | 1 | 2 | 3];
        if (s.kind === "weld") {
          ggWeld++;
          if (samples.length < 8) samples.push(`(${bx},${bz}) d${d} h=${cell.h.toFixed(2)} nb=${nb.h.toFixed(2)} gap=${Math.abs(cell.h - nb.h).toFixed(2)}`);
        }
      }
    }
    console.log(`seed=${seed} chunk(${cx},${cz}) ground↔ground 边=${ggAll} weld=${ggWeld}`);
    for (const s of samples) console.log(`  ${s}`);
  }
}
console.log("done");
