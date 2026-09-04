import { RasterMap } from "../src/services/map/RasterMap";
import { buildChunkFinal, buildChunkWallBuffers, finalRuling } from "../src/services/map/Refinements";
import { tileById } from "../src/services/map/Tiles";
import { buildBlockFaceIndex } from "../src/services/map/BlockFaceIndex";

(globalThis as any).__PP_STAT = true;
const raster = new RasterMap(11);
const cx = 0, cz = 5;
const src = raster.chunkSource(cx, cz);
const N = 60;
const finalTerrain = buildChunkFinal(src, cx, cz, N);
const buffers = buildChunkWallBuffers(src, cx, cz, N, {
  seed: 11,
  palette: undefined,
  heightAt: (x, z) => raster.heightAt(x, z),
  tileDefAt: (x, z) => raster.tileDefAt(x, z),
});

const index = buildBlockFaceIndex(src, cx, cz, finalTerrain.cornerH, buffers);

console.log("cells:", index.cells.length);

let roleMismatch = 0, hMismatch = 0, rulingMismatch = 0;
for (let lbz = 0; lbz < index.BPS; lbz++) {
  for (let lbx = 0; lbx < index.BPS; lbx++) {
    const e = index.cells[lbz * index.BPS + lbx];
    const bx = cx * index.BPS + lbx, bz = cz * index.BPS + lbz;
    const info = src.blockAt(bx, bz);
    const role = info ? tileById(info.id).genRole : "";
    if (role !== e.role) roleMismatch++;
    if ((info?.h ?? 0) !== e.h) hMismatch++;
    for (let dir = 0; dir < 4; dir++) {
      const r = finalRuling(src, bx, bz, dir as 0 | 1 | 2 | 3);
      if (r !== e.sides[dir].ruling) rulingMismatch++;
    }
  }
}
console.log({ roleMismatch, hMismatch, rulingMismatch });

let wallQuad = 0, withRef = 0;
for (const c of index.cells) for (const s of c.sides) {
  wallQuad += s.wallRef ? s.wallRef.quadCount : 0;
  if (s.wallRef) withRef++;
}
console.log({ totalQuads: buffers.vertices.length / 12, wallQuadAggregated: wallQuad, sidesWithWall: withRef });

const ch = index.cornerHAt(cx * N + 2, cz * N + 2);
const ci = (2 * N + 2) * 4;
console.log("cornerHAt:", ch, "direct:", finalTerrain.cornerH[ci], finalTerrain.cornerH[ci + 1], finalTerrain.cornerH[ci + 2], finalTerrain.cornerH[ci + 3]);

// bevel 边统计
let bevelEdges = 0;
for (const c of index.cells) for (const s of c.sides) if (s.isBevel) bevelEdges++;
console.log("bevelEdges:", bevelEdges);
