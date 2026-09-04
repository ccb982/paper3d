/**
 * weld 闭合回读 v3（回归用）：壁顶顶点 vs 「顶几何实际输出」的边界折线逐点对差。
 * 从 buildTopGeometry / buildWallGeometry 输出缓冲各自筛出块边线上的顶点 →
 * 顶侧按沿边参数排序成折线、壁侧取每点 hi → 逐点求差（壁顶低于网格边 = 开口）。
 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60, HALF = CH / 2;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + 30, cz * CH + 30, 2);
  const src = raster.chunkSource(cx, cz);
  const t = buildFaceTable(src, cx, cz);
  const top = buildTopGeometry(t, src);
  const wall = buildWallGeometry(t, src);
  const ox = cx * CH, oz = cz * CH;
  const TV = top.vertices, WV = wall.vertices;

  const rows: string[] = [];
  let samples = 0, badSamples = 0, badEdges = 0;
  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      const cell = t.cells[lbz * 15 + lbx];
      const bx = cx * 15 + lbx, bz = cz * 15 + lbz;
      for (let dir = 0; dir < 4; dir++) {
        const isX = dir < 2;
        const c = isX ? bx * 4 + (dir === 0 ? 4 : 0) : bz * 4 + (dir === 2 ? 4 : 0);
        const b0 = isX ? bz * 4 : bx * 4;
        const meshPts = new Map<number, number>();
        for (let i = 0; i < TV.length; i += 3) {
          const wx = TV[i] + ox + HALF, wz = TV[i + 2] + oz + HALF;
          if (Math.abs((isX ? wx : wz) - c) > 0.02) continue;
          const along = (isX ? wz : wx) - b0;
          if (along < -0.02 || along > 4.02) continue;
          meshPts.set(Math.round(along * 1000) / 1000, TV[i + 1]);
        }
        if (meshPts.size < 2) continue;
        const ks = [...meshPts.keys()].sort((a, b) => a - b);
        const chainY = (s: number) => {
          if (s <= ks[0]) return meshPts.get(ks[0])!;
          for (let k = 1; k < ks.length; k++) {
            if (s <= ks[k]) {
              const a = ks[k - 1], b = ks[k];
              const ya = meshPts.get(a)!, yb = meshPts.get(b)!;
              return ya + (yb - ya) * ((s - a) / (b - a));
            }
          }
          return meshPts.get(ks[ks.length - 1])!;
        };
        const wallPts = new Map<number, number>();
        for (let i = 0; i < WV.length; i += 3) {
          const wx = WV[i] + ox + HALF, wz = WV[i + 2] + oz + HALF;
          if (Math.abs((isX ? wx : wz) - c) > 0.02) continue;
          const along = (isX ? wz : wx) - b0;
          if (along < -0.02 || along > 4.02) continue;
          const k = Math.round(along * 1000) / 1000;
          wallPts.set(k, Math.max(wallPts.get(k) ?? -1e9, WV[i + 1]));
        }
        let worst = 0, worstS = 0;
        for (const [s, wy] of wallPts) {
          samples++;
          const gap = wy - chainY(s);
          if (gap < -0.005) badSamples++;
          if (gap < worst) { worst = gap; worstS = s; }
        }
        if (worst < -0.005) {
          badEdges++;
          if (rows.length < 6) {
            const sS = cell.sides[dir as 0 | 1 | 2 | 3];
            rows.push(`块(${bx},${bz}) d${dir} ${sS.kind}/${sS.oppKind} Δ=${worst.toFixed(3)}@s=${worstS.toFixed(2)}`);
          }
        }
      }
    }
  }
  console.log(`seed=${seed} chunk(${cx},${cz}) 边=900 有缝边=${badEdges} 采样=${samples} 开口采样=${badSamples}`);
  for (const r of rows) console.log(`  ${r}`);
}

run(12345, 1, 3);
run(12345, 0, 0);
run(12345, 0, 1);
run(42, 0, 0);
run(42, 1, 1);
run(7, 0, 0);
console.log("done");
