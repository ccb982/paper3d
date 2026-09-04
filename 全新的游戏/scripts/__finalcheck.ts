/**
 * 最终渲染层回读：对 buildWallGeometry 输出逐 quad 检查：
 *   · 退化（竖直高<0.02 → 隐形）
 *   · 可见（跨越>0.02）
 * 按块统计每向是否「有可见侧壁」，输出缺可见壁的边清单与成因。
 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildWallGeometry, buildTopGeometry } from "../src/services/map/FaceBuild";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60;
function run(seed: number, cx: number, cz: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(cx * CH + CH / 2, cz * CH + CH / 2, 2);
  const src = raster.chunkSource(cx, cz);
  const t = buildFaceTable(src, cx, cz);
  const wall = buildWallGeometry(t, src);
  const V = wall.vertices;
  // 每 (块,dir) 收集段 quad 的可见性
  const perEdge = new Map<string, { visible: number; hidden: number; yMin: number; yMax: number }>();
  const key = (bx: number, bz: number, dir: number) => `${bx},${bz},${dir}`;
  const ox = cx * CH, oz = cz * CH;
  const SEG = 8;
  for (let q = 0; q < wall.indices.length / 6; q++) {
    const vi = q * 4;
    const x0 = V[vi * 3], z0 = V[vi * 3 + 2];
    const ys = [V[vi * 3 + 1], V[(vi + 1) * 3 + 1], V[(vi + 2) * 3 + 1], V[(vi + 3) * 3 + 1]];
    const yHi = Math.max(...ys), yLo = Math.min(...ys);
    // 定位块/向：quad 顶边两端 = 世界近似（x/z const 线）
    const wx = x0 + ox + CH / 2, wz = z0 + oz + CH / 2;
    // 顶边方向：沿 x 或沿 z
    const ax = V[vi * 3], az = V[vi * 3 + 2];
    const bx2 = V[(vi + 1) * 3], bz2 = V[(vi + 1) * 3 + 2];
    const isX = Math.abs(az - bz2) < 0.01;
    // 世界坐标常量线 c = 局部+中心
    const c = (isX ? z0 : x0) + CH / 2 + (isX ? cz * CH : cx * CH);
    const blockIdx = Math.floor(c / 4);
    // dir 与块：沿 x 顶边 → 立面 z const；法线方向由 DIRS 序决定
    const along = isX ? x0 : z0;
    const A = along + (isX ? cx * CH + CH / 2 : cz * CH + CH / 2);
    const B = A + 4;
    void B;
    // 本 quad 覆盖沿边 s（0..SEG-1）
    const s = Math.floor(((isX ? wx : wz) - blockIdx * 4 - 0) / 0.5);
    const dir = isX ? 2 : 0; // 粗略；逐 q 精确匹配在下方按块循环做，这里跳过
    void s; void dir; void wx; void wz; void ax; void az; void bx2; void bz2; void blockIdx; void A; void along;
    const isVisible = yHi - yLo > 0.02;
    const k = `raw:${q}`;
    let e = perEdge.get(k);
    if (!e) { e = { visible: 0, hidden: 0, yMin: 1e9, yMax: -1e9 }; perEdge.set(k, e); }
    void isVisible;
  }
  // 简化：按块循环统计（每块 4 向 × 8 段 = 32 quad 区间），直接用几何扫
  // 对每块每向沿边 8 段统计 y 跨度
  const misses: string[] = [];
  let hiddenOnly = 0, missingGeom = 0, visibleEdges = 0, allEdges = 0;
  for (let lbz = 0; lbz < 15; lbz++) {
    for (let lbx = 0; lbx < 15; lbx++) {
      const cell = t.cells[lbz * 15 + lbx];
      const bx = cx * 15 + lbx, bz = cz * 15 + lbz;
      for (let dir = 0; dir < 4; dir++) {
        allEdges++;
        // 该边 8 段中可见段数
        let visSegs = 0, geomSegs = 0;
        for (let s = 0; s < SEG; s++) {
          // 收集几何中该 (块,dir,段) 的 y 范围
          // 直接以墙几何顶点检索：顶点局部 x/z 在该边线（±0.02）且沿边段内
          const lo = Math.floor(s * 0.5), hi = lo + 0.5;
          // 世界边常量：
          const constX = dir === 0 ? bx * 4 + 4 : dir === 1 ? bx * 4 : undefined;
          const constZ = dir === 2 ? bz * 4 + 4 : dir === 3 ? bz * 4 : undefined;
          let found = false;
          let yHi = -1e9, yLo = 1e9;
          for (let i = 0; i < V.length; i += 3) {
            const lx = V[i] + cx * CH + CH / 2;
            const lz = V[i + 2] + cz * CH + CH / 2;
            const y = V[i + 1];
            const onX = constX !== undefined && Math.abs(lx - constX) < 0.02;
            const onZ = constZ !== undefined && Math.abs(lz - constZ) < 0.02;
            if (!(onX || onZ)) continue;
            const along = constX !== undefined ? lz : lx;
            const base = constX !== undefined ? bz * 4 : bx * 4;
            const off = along - base;
            if (off < lo - 0.02 || off > hi + 0.02) continue;
            found = true;
            yHi = Math.max(yHi, y); yLo = Math.min(yLo, y);
          }
          if (found) { geomSegs++; if (yHi - yLo > 0.02) visSegs++; }
        }
        if (geomSegs === 0) {
          missingGeom++;
          if (misses.length < 15) misses.push(`无几何 块(${bx},${bz}) d${dir} kind=${cell.sides[dir as 0 | 1 | 2 | 3].kind}`);
        } else if (visSegs === 0) {
          hiddenOnly++;
          if (misses.length < 15) misses.push(`全隐形 块(${bx},${bz}) d${dir} kind=${cell.sides[dir as 0 | 1 | 2 | 3].kind}`);
        } else {
          visibleEdges++;
        }
      }
    }
  }
  console.log(`seed=${seed} chunk(${cx},${cz}) 边总数=${allEdges} | 可见壁边=${visibleEdges} 全隐形边=${hiddenOnly} 无几何边=${missingGeom}`);
  for (const m of misses) console.log(`  ${m}`);
}

run(12345, 0, 1);
run(12345, 0, 0);
console.log("done");
