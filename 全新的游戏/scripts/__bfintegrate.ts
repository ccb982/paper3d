/**
 * 顶面 A/B 逐位验证
 */
import { buildPostChunkTopSurface, postSurfaceHeightAt } from "../src/services/map/PostProcess";
import { buildBlockFaceIndex } from "../src/services/map/BlockFaceIndex";
import { buildChunkFinal } from "../src/services/map/Refinements";
import type { BlockFaceIndexBundle } from "../src/services/map/BlockFaceIndex";
import { RasterMap } from "../src/services/map/RasterMap";

const SEED = 42, cx = 0, cz = 0, PCS = 240;

function main() {
  const raster = new RasterMap(SEED);
  raster.updateChunks(cx * PCS + PCS / 2, cz * PCS + PCS / 2, 1);
  const src = raster.chunkSource(cx, cz);
  const cornerH = buildChunkFinal(src, cx, cz, PCS).cornerH;
  const dummy = { vertices: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), shade: new Float32Array(0), uvs: new Float32Array(0) } as any;
  const bundle: BlockFaceIndexBundle = { index: buildBlockFaceIndex(src, cx, cz, cornerH, dummy), src, cornerH, wallBuffers: dummy };

  const topA = buildPostChunkTopSurface(raster, cx, cz, bundle);
  const topB = buildPostChunkTopSurface(raster, cx, cz);
  let vDiff = 0, iDiff = 0;
  for (let i = 0; i < topA.vertices.length; i++) if (topA.vertices[i] !== topB.vertices[i]) vDiff++;
  for (let i = 0; i < topA.indices.length; i++) if (topA.indices[i] !== topB.indices[i]) iDiff++;
  console.log(`TOP verts: ${topA.vertices.length} ${topB.vertices.length} indices: ${topA.indices.length} ${topB.indices.length}`);
  console.log(`TOP vDiff: ${vDiff} iDiff: ${iDiff}`);

  let qDiff = 0;
  for (let i = 0; i < 4000; i++) {
    const wx = cx * PCS + i * 0.1, wz = cz * PCS + i * 0.137;
    if (postSurfaceHeightAt(raster, wx, wz) !== postSurfaceHeightAt(raster, wx, wz)) qDiff++;
  }
  console.log(`QUERY qDiff: ${qDiff} / 4000`);
  console.log("done");
}
main();
