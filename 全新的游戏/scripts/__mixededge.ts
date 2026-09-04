/** 混合边细缝测量：coarse/fine 共享边上，fine 侧 0.125 折线与 coarse 侧
 *  1m 弦的真实错位（= 可见细缝宽度上限）。采样 exact@fine节点 对弦。 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { topYView, topFineCells } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60, N = 60;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const table = buildFaceTable(src, cx, cz);
  const fineE = topFineCells(table, src);
  const isFine = (lx: number, lz: number) => lx >= 0 && lz >= 0 && lx < N && lz < N && fineE[lz * N + lx] === 1;
  const exact = (bx: number, bz: number, x: number, z: number) => topYView(table, src, bx, bz, x, z);

  let mixed = 0, bad = 0, worst = 0;
  let worstInfo = "";
  const check = (x0: number, z0: number, x1: number, z1: number, vbx: number, vbz: number) => {
    const yA = exact(vbx, vbz, x0, z0), yB = exact(vbx, vbz, x1, z1);
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const yE = exact(vbx, vbz, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      const dev = Math.abs(yE - (yA + (yB - yA) * t));
      if (dev > 0.005) bad++;
      if (dev > worst) { worst = dev; worstInfo = `(${x0},${z0})→(${x1},${z1}) t=${t.toFixed(2)} dev=${dev.toFixed(4)}`; }
    }
  };
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const wx0 = cx * N + lx, wz0 = cz * N + lz;
      const vbx = cx * 15 + Math.floor(lx / 4), vbz = cz * 15 + Math.floor(lz / 4);
      if (!isFine(lx, lz)) {
        // 粗 cell：检查与 fine 邻的共享边（东/南）；跳过落在块边界/chunk 边界
        // 的边（块边界有墙封，两侧视角本可不同）
        if ((lx + 1) % 4 !== 0 && isFine(lx + 1, lz)) { mixed++; check(wx0 + 1, wz0, wx0 + 1, wz0 + 1, vbx, vbz); }
        if ((lz + 1) % 4 !== 0 && isFine(lx, lz + 1)) { mixed++; check(wx0, wz0 + 1, wx0 + 1, wz0 + 1, vbx, vbz); }
      }
    }
  }
  console.log(`seed=${seed} chunk(${cx},${cz}) 混合边=${mixed} 错位采样>5mm=${bad} 最差=${worst.toFixed(4)}m @${worstInfo}`);
}

run(12345, 0, 0);
run(12345, 1, 3);
run(42, 0, 0);
run(42, 1, 1);
run(7, 0, 0);
console.log("done");
