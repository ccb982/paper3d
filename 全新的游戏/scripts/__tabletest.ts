/**
 * 表合理性测试：Pass1+Pass2 构建 → checkTable → 与旧 buildChunkWallBuffers
 * 几何对拍（hasWall 覆盖率 / topEdgeY / depth 差异），输出统计与样例。
 */
import { buildFaceTable, checkTable, viewTopAt, edgeEndpoints } from "../src/services/map/FaceTable";
import { buildChunkFinal, buildChunkWallBuffers } from "../src/services/map/Refinements";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60, HALF = CH / 2;

function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const palette = undefined as any;
  const ctx = { seed, palette, heightAt: (x: number, z: number) => raster.heightAt(x, z), tileDefAt: (x: number, z: number) => raster.tileDefAt(x, z) } as any;
  const wb = buildChunkWallBuffers(src, cx, cz, CH, ctx);
  buildChunkFinal(src, cx, cz, CH); // cornerH 不参与（wall 判定 f64 现算）
  const table = buildFaceTable(src, cx, cz);
  const rep = checkTable(table);
  console.log(`== seed=${seed} chunk(${cx},${cz}) ==`);
  console.log(`kind=${JSON.stringify(rep.stats.kind)} hasWall=${rep.stats.hasWall} bevel=${rep.stats.bevelCount} weldWithWall=${rep.stats.weldWithWall} 检验错误=${rep.errors.length}`);
  for (const e of rep.errors.slice(0, 6)) console.log(`  ERR ${e}`);

  // ---- 对拍：旧墙几何 vs 表 ----
  const V = wb.vertices;
  const nq = V.length / 12;
  // 几何真值：每 (bx,bz,dir) 段集合（顶边在边界线）
  const geom = new Map<string, { segs: Set<number>; topMax: number; depthMax: number }>();
  const gk = (bx: number, bz: number, dir: number) => `${bx},${bz},${dir}`;
  const lx0 = cx * 15, lz0 = cz * 15;
  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      for (let d = 0; d < 4; d++) geom.set(gk(lx0 + lbx, lz0 + lbz, d), { segs: new Set(), topMax: -1e9, depthMax: -1e9 });
    }
  }
  for (let q = 0; q < nq; q++) {
    const ax = V[q * 12] + cx * CH + HALF, az = V[q * 12 + 2] + cz * CH + HALF;
    const bx2 = V[q * 12 + 3] + cx * CH + HALF, bz2 = V[q * 12 + 5] + cz * CH + HALF;
    const ay = V[q * 12 + 1], by = V[q * 12 + 4], bot = V[(q * 4 + 2) * 3 + 1];
    // 找 (bx,bz,dir)：顶边所在边界线（x const 或 z const）→ 线两侧块，取发墙块未知；
    // 直接按线上块对遍历候选匹配几何（发墙 quad 属于 4 块之一且顶边在其 dir 线）
    for (let dir = 0; dir < 4; dir++) {
      // 用表核对更省：直接对表每边用几何段真值（见下），这里先收集 quad 挂在线两侧块记录
      // 简化：遍历该线两个可能块 × 匹配 dir
    }
  }
  // 由于发墙块归属需要判定，直接用「段覆盖真值」函数：
  // 几何真值：quad 顶边线 == (块,dir) 边线 且 法线 == dir 法线（归属高侧块）
  const NML = wb.normals;
  const wallGeom = (bx: number, bz: number, dir: number): { segs: Set<number>; topMax: number; botMin: number } => {
    const segs = new Set<number>();
    const [[e0x, e0z], [e1x, e1z]] = edgeEndpoints(bx, bz, dir);
    const isXLine = Math.abs(e0z - e1z) < 0.01;
    const base = isXLine ? Math.min(e0x, e1x) : Math.min(e0z, e1z);
    let topMax = -1e9, botMin = 1e9;
    const expN = [[1,0],[-1,0],[0,1],[0,-1]][dir];
    for (let q = 0; q < nq; q++) {
      const ax = V[q * 12] + cx * CH + HALF, az = V[q * 12 + 2] + cz * CH + HALF;
      const bx2 = V[q * 12 + 3] + cx * CH + HALF, bz2 = V[q * 12 + 5] + cz * CH + HALF;
      const onLine = isXLine
        ? Math.abs(az - e0z) < 0.02 && Math.abs(bz2 - e0z) < 0.02
        : Math.abs(ax - e0x) < 0.02 && Math.abs(bx2 - e0x) < 0.02;
      if (!onLine) continue;
      // 顶边两端必须完整落在本块该向 4m 边内（防邻块墙误收）
      const lo = isXLine ? Math.min(ax, bx2) : Math.min(az, bz2);
      const hi = isXLine ? Math.max(ax, bx2) : Math.max(az, bz2);
      const cLo = isXLine ? e0x : e0z;
      if (lo < cLo - 0.02 || hi > cLo + 4.02) continue;
      const nx = NML[q * 12], nz = NML[q * 12 + 2];
      if (Math.abs(nx - expN[0]) > 0.5 || Math.abs(nz - expN[1]) > 0.5) continue;
      const along = isXLine ? ax : az;
      const s = Math.floor(along - base);
      if (s >= 0 && s < 4) segs.add(s);
      topMax = Math.max(topMax, V[q * 12 + 1], V[q * 12 + 4]);
      botMin = Math.min(botMin, V[(q * 4 + 2) * 3 + 1]);
    }
    return { segs, topMax, botMin };
  };
  const gcache = new Map<string, { segs: Set<number>; topMax: number; botMin: number }>();
  const wallGeomOf = (bx: number, bz: number, dir: number) => {
    const k = bx + "," + bz + "," + dir;
    let g = gcache.get(k);
    if (!g) { g = wallGeom(bx, bz, dir); gcache.set(k, g); }
    return g;
  };
  let geomMiss = 0, geomExtra = 0, topDiff = 0, topDiffN = 0, depthDiff = 0, depthDiffN = 0;
  const samples: string[] = [];
  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      const cell = table.cells[lbz * 15 + lbx];
      const bx = lx0 + lbx, bz = lz0 + lbz;
      for (let dir = 0; dir < 4; dir++) {
        const side = cell.sides[dir as 0 | 1 | 2 | 3];
        const g = wallGeomOf(bx, bz, dir);
        const has = g.segs.size > 0;
        if (has !== side.hasWall) {
          if (has && !side.hasWall) geomMiss++;
          else geomExtra++;
          if (samples.length < 8) samples.push(`HAS 块(${bx},${bz}) d${dir} geom=${has} 表=${side.hasWall} kind=${side.kind}`);
        }
        if (has) {
          topDiff += Math.abs(g.topMax - side.topEdgeY); topDiffN++;
          const geomDepth = g.topMax - g.botMin;
          depthDiff += Math.abs(geomDepth - side.depth); depthDiffN++;
        }
      }
    }
  }
  console.log(`对拍: geomMiss(表漏)=${geomMiss} geomExtra(表多)=${geomExtra} | topEdgeY 平均差=${(topDiff / Math.max(1, topDiffN)).toFixed(4)} (n=${topDiffN}) | depth 平均差=${(depthDiff / Math.max(1, depthDiffN)).toFixed(4)} (n=${depthDiffN})`);
  for (const s of samples) console.log(`  ${s}`);
}

run(12345, 0, 0);
run(12345, 0, 1);
run(42, 0, 0);
console.log("done");
