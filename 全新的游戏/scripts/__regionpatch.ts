/**
 * 剔除+打补丁（§14.10 R+P，坑缘坡面版）验收：
 *   ① circleCells：圆覆盖 coarse cell 判定（AABB 判交；角点并入；跨 chunk；负坐标；幂等）
 *   ② 深度场：坑内满深 −D、边界线 0；坑内顶点色全补丁色、区外白/原样（只取 cell 内部顶点判定）
 *   ③ 坡面插值：坑缘存在中间深度、深度场数值连续（smoothstep）、坡面法线倾斜
 *   ④ 补丁全权负责内部：坑内块边界壁整段剔除（位置对齐）；坑缘壁存在、顶沿不悬空、补丁色；
 *      远离区壁（位置多集）逐位一致
 *   ⑤ 确定性：同 overlay 两次构建逐位一致
 *   ⑥ 跨 chunk：补丁触 seam → 深度在 seam 两侧各自收口 0（封死不悬空）、seam 壁保留且补丁色
 *   ⑦ 防 T 结细缝：补丁 cell 全 0.125m 细分 + 同点无高度分裂
 *   ⑧ Worker 字节级一致性：活闭包 vs 传输拷贝闭包（= terrainPatch 路径）逐位一致
 */
import {
  buildLevelOverlay,
  buildTopGeometry,
  buildWallGeometry,
  circleCells,
  topFineCells,
  topYView,
  PATCH_DEPTH,
  PATCH_COLOR,
} from "../src/services/map/FaceBuild";import { buildFaceTable } from "../src/services/map/FaceTable";
import { RasterMap } from "../src/services/map/RasterMap";
import { computeTableGeometry } from "../src/services/map/PatchCompute";
import {
  markCell as psMark,
  isPatchedAt as psIsPatched,
  depthAtWorld as psDepth,
  clearAll as psClear,
} from "../src/services/map/PatchState";

const N = 60;
const CH = 60;
const HALF = CH / 2;
let failures = 0;
const ok = (c: boolean, m: string) => {
  if (c) console.log(`  ✓ ${m}`);
  else { failures++; console.log(`  ✗ ${m}`); }
};
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;
const isPatchCol = (c: Float32Array, i: number) =>
  near(c[i], PATCH_COLOR[0]) && near(c[i + 1], PATCH_COLOR[1]) && near(c[i + 2], PATCH_COLOR[2]);
const isWhite = (c: Float32Array, i: number) =>
  near(c[i], 1) && near(c[i + 1], 1) && near(c[i + 2], 1);

function run(seed: number) {
  const tag = `seed=${seed}`;
  const raster = new RasterMap(seed);
  raster.updateChunks(N / 2, N / 2, 3);
  const src0 = raster.chunkSource(0, 0);
  const table0 = buildFaceTable(src0, 0, 0);
  const src1 = raster.chunkSource(0, 1);
  const table1 = buildFaceTable(src1, 0, 1);

  // ---- ① circleCells ----
  {
    const inner = circleCells(10.5, 10.5, 0.26, CH);
    ok(inner.length === 1 && inner[0].lx === 10 && inner[0].lz === 10,
      `${tag} ①圆心在 cell 内 + R=0.26 → 恰 1 cell（${inner.length}）`);
    const corner = circleCells(20, 20, 0.6, CH);
    const kk = corner.map((c) => `${c.lx},${c.lz}`).sort();
    ok(corner.length === 4 && kk.join("|") === "19,19|19,20|20,19|20,20",
      `${tag} ①圆心在 4 cell 角点 → 4 cell 并入（AABB 判交）[${kk.join("|")}]`);
    const seam = circleCells(20.5, 59.5, 0.6, CH);
    const chunks = new Set(seam.map((c) => `${c.cx},${c.cz}`));
    ok(chunks.has("0,0") && chunks.has("0,1") && seam.some((c) => c.cx === 0 && c.cz === 1 && c.lz === 0),
      `${tag} ①跨 chunk 边界 → 双侧命中（chunks=${[...chunks].join("|")}）`);
    const neg = circleCells(-0.4, -0.4, 0.6, CH);
    ok(neg.some((c) => c.cx === -1 && c.cz === -1 && c.lx === 59 && c.lz === 59),
      `${tag} ①负坐标 → 块索引 −1、块内 59`);
    const again = circleCells(20.5, 59.5, 0.6, CH);
    ok(seam.length === again.length && seam.every((c, i) => c.lx === again[i].lx && c.lz === again[i].lz),
      `${tag} ①circleCells 幂等（n=${again.length}）`);
  }

  // ---- ② 顶面：3×3 补丁区，中心 = 第一个 fine cell（fx 落在 4m 块界，覆盖块边隔断） ----
  const fine = topFineCells(table0, src0);
  let fx = -1, fy = -1, dx = -1, dy = -1;
  for (let i = 0; i < N * N; i++) if (fine[i]) { fx = i % N; fy = (i / N) | 0; break; }
  for (let j = (fy + 3) * N; j < N * N; j++) if (fine[j]) { dx = j % N; dy = (j / N) | 0; break; }
  fx = fx - (fx % 4); // 对齐到 4m 块界，使坑中心列跨块界（可观测隔断剔除）
  const patchCells = new Set<number>();
  for (let lz = fy - 1; lz <= fy + 1; lz++) for (let lx = fx - 1; lx <= fx + 1; lx++) patchCells.add(lz * N + lx);
  const arr = new Uint8Array(N * N);
  for (const c of patchCells) arr[c] = 1;
  const overlay = buildLevelOverlay(arr, 0, 0);

  const wOf = (wx: number, wz: number) => ({ lx: Math.floor(wx), lz: Math.floor(wz) });
  const isP = (wx: number, wz: number) => { const { lx, lz } = wOf(wx, wz); return patchCells.has(lz * N + lx); };
  // 仅取 cell 内部顶点（小数坐标，无共享边界歧义）
  const interiorOf = (wx: number, wz: number) => {
    const fx2 = wx - Math.floor(wx), fz2 = wz - Math.floor(wz);
    return fx2 > 0.02 && fz2 > 0.02 && fx2 < 0.98 && fz2 < 0.98;
  };
  // ★ 对照基准 = 同 fine 掩码、深度 0 的构建（拓扑与补丁构建逐位对齐，索引可直接相减）
  const overlay0 = buildLevelOverlay(arr, 0, 0, 0);
  const topYes = buildTopGeometry(table0, src0, overlay);
  const topNo = buildTopGeometry(table0, src0, overlay0);
  const wallYes = buildWallGeometry(table0, src0, overlay);
  const wallNo = buildWallGeometry(table0, src0, overlay0);

  {
    let pBad = 0, wBad = 0, hBad = 0, pCore = 0, wCore = 0;
    let minDy = Infinity, maxDy = -Infinity;
    for (let i = 0; i < topYes.vertices.length / 3; i++) {
      const wx = topYes.vertices[i * 3] + HALF, wz = topYes.vertices[i * 3 + 2] + HALF;
      const dy = topYes.vertices[i * 3 + 1] - topNo.vertices[i * 3 + 1];
      const core = interiorOf(wx, wz);
      if (isP(wx, wz)) {
        minDy = Math.min(minDy, dy); maxDy = Math.max(maxDy, dy);
        if (dy < -PATCH_DEPTH - 1e-5 || dy > 1e-5) hBad++;
        if (core) { pCore++; if (!isPatchCol(topYes.colors, i * 3)) pBad++; }
      } else {
        if (!near(dy, 0, 1e-5)) hBad++;
        if (core) { wCore++; if (!isWhite(topYes.colors, i * 3)) wBad++; }
      }
    }
    ok(fx > 0 && fx < N - 4 && fy > 0 && fy < N - 2, `${tag} ②3×3 补丁区中心块界 x=${fx}，z 行 ${fy - 1}..${fy + 1}`);
    ok(hBad === 0 && near(minDy, -PATCH_DEPTH, 1e-5) && near(maxDy, 0, 1e-5),
      `${tag} ②深度场：坑内满深 ${minDy.toFixed(4)} / 边界线 ${maxDy.toFixed(4)}（坏 ${hBad}）`);
    ok(pCore > 0 && pBad === 0 && wCore > 0 && wBad === 0,
      `${tag} ②补丁区内部顶点全 PATCH_COLOR（${pCore}）；区外白（${wCore}）（坏 ${pBad}/${wBad}）`);
  }

  // ---- ③ 坡面插值 ----
  {
    let slopeV = 0, tilt = 0;
    for (let i = 0; i < topYes.vertices.length / 3; i++) {
      const wx = topYes.vertices[i * 3] + HALF, wz = topYes.vertices[i * 3 + 2] + HALF;
      const dy = topYes.vertices[i * 3 + 1] - topNo.vertices[i * 3 + 1];
      if (isP(wx, wz) && dy > -PATCH_DEPTH + 1e-6 && dy < -1e-6) slopeV++;
      if (isP(wx, wz) && Math.abs(topYes.normals[i * 3]) > 1e-3) tilt++;
    }
    ok(slopeV > 0, `${tag} ③坡面插值顶点存在（n=${slopeV}，0>depth>−D）`);
    const xL = fx - 1, xR = fx + 1;
    const d0 = overlay.depthOf(xL, fy + 0.5);       // 坑口线 = 0
    const d1 = overlay.depthOf(xL + 0.25, fy + 0.5); // 坡面中点（W=0.5m/层 → 0.5D）
    const d2 = overlay.depthOf(xL + 1, fy + 0.5);    // 坑内满深
    const d3 = overlay.depthOf(xR + 1, fy + 0.5);
    ok(d0 === 0 && d1 > 0.08 && d1 < 0.12 && d2 >= PATCH_DEPTH - 1e-6 && d3 === 0,
      `${tag} ③深度场：坑口线 0 / 坡面中点 0.5D / 坑内满深（${d0.toFixed(3)}/${d1.toFixed(3)}/${d2.toFixed(3)}/${d3.toFixed(3)}）`);
    let maxStep = 0;
    for (let s = 0; s <= 20; s++) {
      const a = overlay.depthOf(xL + s / 20, fy + 0.3);
      const b = overlay.depthOf(xL + (s + 1) / 20, fy + 0.3);
      maxStep = Math.max(maxStep, Math.abs(b - a));
    }
    ok(maxStep < 0.03, `${tag} ③坡面连续（相邻采样最大差 ${maxStep.toFixed(4)}）`);
    ok(tilt > 0, `${tag} ③坑缘坡面法线倾斜（n=${tilt}）`);
  }

  // ---- ③b 真实子弹 footprint（circleCells R=0.6 十字坑）中心必须满深（可见性） ----
  {
    const hit = { x: 20.5, z: 20.5 }; // cell 中心命中 → 十字 5 格
    const foot = circleCells(hit.x, hit.z, 0.6, CH);
    const arrC = new Uint8Array(N * N);
    let inChunk = 0;
    for (const c of foot) if (c.cx === 0 && c.cz === 0) { arrC[c.lz * N + c.lx] = 1; inChunk++; }
    ok(inChunk >= 5, `${tag} ③b R=0.6 命中 cell 中心 → ${inChunk} 格十字坑`);
    const ovC = buildLevelOverlay(arrC, 0, 0);
    const dC = ovC.depthOf(hit.x, hit.z);
    ok(dC >= PATCH_DEPTH * 0.99, `${tag} ③b 坑心满深 ${dC.toFixed(3)} ≥ 0.99D（可见坑）`);
    const topC = buildTopGeometry(table0, src0, ovC);
    const topCNo = buildTopGeometry(table0, src0);
    let floorV = 0, slopeV2 = 0;
    for (let i = 0; i < topC.vertices.length / 3; i++) {
      const wx = topC.vertices[i * 3] + HALF, wz = topC.vertices[i * 3 + 2] + HALF;
      const dy = topC.vertices[i * 3 + 1] - topCNo.vertices[i * 3 + 1];
      if (wx > 19.4 && wx < 21.6 && wz > 19.4 && wz < 21.6) {
        if (dy <= -PATCH_DEPTH * 0.95) floorV++;
        else if (dy < -1e-6) slopeV2++;
      }
    }
    ok(floorV > 0 && slopeV2 > 0, `${tag} ③b 坑底顶点 n=${floorV} + 坡面顶点 n=${slopeV2}`);
  }

  // ---- ④ 补丁全权负责内部（主 3×3 坑）：坑缘壁补丁色；残余壁顶沿 ∈ 原面−[0,D]（随深度场） ----
  {
    const insideBox = (wx: number, wz: number) =>
      wx > fx - 1.5 && wx < fx + 1.5 && wz > fy - 1.5 && wz < fy + 1.5;
    // xz → 无补丁壁顶沿最高 y（判定残余壁是否随深度场下降且不越界）
    const topAtXz = new Map<string, number>();
    for (let i = 0; i < wallNo.vertices.length; i += 3) {
      const k = wallNo.vertices[i].toFixed(3) + "," + wallNo.vertices[i + 2].toFixed(3);
      const y = wallNo.vertices[i + 1];
      const prev = topAtXz.get(k);
      if (prev === undefined || y > prev) topAtXz.set(k, y);
    }
    let rimOK = 0, dyBad = 0, dyBadN = 0;
    // 先取 yes 侧每 xz 的壁顶沿（max y）——dy 判定只针对顶沿顶点，底部顶点不参与
    const yesTopXz = new Map<string, number>();
    for (let i = 0; i < wallYes.vertices.length; i += 3) {
      const wx = wallYes.vertices[i] + HALF, wz = wallYes.vertices[i + 2] + HALF;
      if (!insideBox(wx, wz)) continue;
      const k = wallYes.vertices[i].toFixed(3) + "," + wallYes.vertices[i + 2].toFixed(3);
      const y = wallYes.vertices[i + 1];
      const prev = yesTopXz.get(k);
      if (prev === undefined || y > prev) yesTopXz.set(k, y);
    }
    for (let i = 0; i < wallYes.vertices.length; i += 3) {
      const wx = wallYes.vertices[i] + HALF, wz = wallYes.vertices[i + 2] + HALF;
      if (!insideBox(wx, wz)) continue;
      const k = wallYes.vertices[i].toFixed(3) + "," + wallYes.vertices[i + 2].toFixed(3);
      if (!near(wallYes.vertices[i + 1], yesTopXz.get(k) ?? -1e9, 1e-3)) continue; // 非顶沿
      const noTop = topAtXz.get(k);
      if (noTop === undefined) continue;
      const dy = wallYes.vertices[i + 1] - noTop;
      // 顶沿允许随深度场下降 [−D, 0]；超出 = 错位/悬空
      if (dy < -PATCH_DEPTH - 1e-4 || dy > 1e-4) { dyBad++; dyBadN++; }
      if (dy > -PATCH_DEPTH + 1e-4 && isPatchCol(wallYes.colors, i)) rimOK++;
    }
    ok(rimOK > 0, `${tag} ④坑缘/坑内壁补丁色（n=${rimOK}）`);
    ok(dyBad === 0, `${tag} ④坑内壁高度 ∈ 原面−[0,D] 无错位（坏 ${dyBadN}）`);
  }

  // ---- ④a 远离区：壁顶点多集（x,y,z）逐位一致 + 颜色灰 ----
  {
    const farCheck = (g: { vertices: Float32Array; colors: Float32Array }, farFn: (wx: number, wz: number) => boolean) => {
      const m = new Map<string, number>();
      let grayBad = 0;
      for (let i = 0; i < g.vertices.length / 3; i++) {
        const wx = g.vertices[i * 3] + HALF, wz = g.vertices[i * 3 + 2] + HALF;
        if (!farFn(wx, wz)) continue;
        const k = g.vertices[i * 3].toFixed(3) + "," + g.vertices[i * 3 + 1].toFixed(3) + "," + g.vertices[i * 3 + 2].toFixed(3);
        m.set(k, (m.get(k) ?? 0) + 1);
        if (!near(g.colors[i * 3], 1.0)) grayBad++;
      }
      return { m, grayBad };
    };
    const farFn = (wx: number, wz: number) => {
      const { lx, lz } = wOf(wx, wz);
      return !(lx >= fx - 3 && lx <= fx + 3 && lz >= fy - 3 && lz <= fy + 3);
    };
    const FNo = farCheck(wallNo, farFn);
    const FYes = farCheck(wallYes, farFn);
    let farSame = FNo.m.size === FYes.m.size;
    if (farSame) for (const [k, v] of FNo.m) if (FYes.m.get(k) !== v) { farSame = false; break; }
    ok(farSame, `${tag} ④远离区壁逐位一致（no=${FNo.m.size} yes=${FYes.m.size}）`);
    ok(FYes.grayBad === 0, `${tag} ④远离区颜色 = 中性白 [1,1,1] 未扰动（坏 ${FYes.grayBad}）`);
  }

  // ---- ④b 壁覆写语义：flush 平隔断 → 剔除；台阶（可见崖壁）→ 保留+补丁化+顶沿随深度场 ----
  {
    // 搜索地形里真实存在的块界平面（x 为 4 的倍数）：<0.02m = flush，>0.25m = 台阶
    const planeDiff = (p: number, zS: number) => {
      const bz0 = Math.floor(zS / 4);
      const hE = topYView(table0, src0, p / 4, bz0, p, zS);
      const hW = topYView(table0, src0, p / 4 - 1, bz0, p, zS);
      return Math.abs(hE - hW);
    };
    let fPlane = -1, fR0 = -1, sPlane = -1, sR0 = -1, tPlane = -1, tR0 = -1;
    for (let p = 12; p <= 44; p += 4) {
      for (let b = 5; b <= 9; b++) {
        const r0 = b * 4 + 1; // 该 4m 带内第 2 行起的两行（区域行 r0,r0+1）
        const dA = planeDiff(p, r0), dB = planeDiff(p, r0 + 1), dC = planeDiff(p, r0 + 2);
        const dMax = Math.max(dA, dB, dC);
        const dMid = planeDiff(p, r0 + 1.5);
        if (fPlane < 0 && dMax < 0.002) { fPlane = p; fR0 = r0; }          // 真 flush（浮点噪声级）
        if (tPlane < 0 && dMid > 0.0025 && dMax < 0.03) { tPlane = p; tR0 = r0; } // 微小高台棱
        if (sPlane < 0 && dMid > 0.25) { sPlane = p; sR0 = r0; }           // 大台阶
        if (fPlane > 0 && sPlane > 0 && tPlane > 0) break;
      }
      if (fPlane > 0 && sPlane > 0 && tPlane > 0) break;
    }
    const regionOf = (p: number, r0: number) => {
      const a = new Uint8Array(N * N);
      for (let lz = r0; lz <= r0 + 1; lz++) for (let lx = p - 2; lx <= p + 1; lx++) a[lz * N + lx] = 1;
      return a;
    };
    const planeStats = (gYes: { vertices: Float32Array; colors: Float32Array }, gNo: { vertices: Float32Array }, p: number, r0: number) => {
      const noTop = new Map<string, number>();
      for (let i = 0; i < gNo.vertices.length; i += 3) {
        const wx = gNo.vertices[i] + HALF;
        if (wx > p - 0.5 && wx < p + 0.5) {
          const k = gNo.vertices[i].toFixed(3) + "," + gNo.vertices[i + 2].toFixed(3);
          const y = gNo.vertices[i + 1];
          const prev = noTop.get(k);
          if (prev === undefined || y > prev) noTop.set(k, y);
        }
      }
      let n = 0, colored = 0, deep = 0;
      for (let i = 0; i < gYes.vertices.length; i += 3) {
        const wx = gYes.vertices[i] + HALF, wz = gYes.vertices[i + 2] + HALF;
        if (!near(wx, p, 1e-3)) continue;
        if (wz < r0 + 0.1 || wz > r0 + 1.9) continue;
        n++;
        if (isPatchCol(gYes.colors, i)) colored++;
        const noTopY = noTop.get(gYes.vertices[i].toFixed(3) + "," + gYes.vertices[i + 2].toFixed(3));
        if (noTopY !== undefined && gYes.vertices[i + 1] <= noTopY - PATCH_DEPTH + 0.01) deep++;
      }
      return { n, colored, deep };
    };
    ok(fPlane > 0 && sPlane > 0 && tPlane > 0,
      `${tag} ④b 找到 flush x=${fPlane} / 微小棱 x=${tPlane} / 台阶 x=${sPlane}（行 ${fR0}/${tR0}/${sR0}）`);
    if (fPlane > 0) {
      const ovF = buildLevelOverlay(regionOf(fPlane, fR0), 0, 0);
      const wFNo = buildWallGeometry(table0, src0);
      const wFYes = buildWallGeometry(table0, src0, ovF);
      const b4 = planeStats(wFNo, wFNo, fPlane, fR0).n;
      const a4 = planeStats(wFYes, wFNo, fPlane, fR0);
      ok(b4 > 0 && a4.n === 0, `${tag} ④b flush 平隔断整段剔除（补丁前 ${b4} → 补丁后 ${a4.n}）`);
    }
    if (tPlane > 0) {
      const ovT = buildLevelOverlay(regionOf(tPlane, tR0), 0, 0);
      const wTNo = buildWallGeometry(table0, src0);
      const wTYes = buildWallGeometry(table0, src0, ovT);
      const aT = planeStats(wTYes, wTNo, tPlane, tR0);
      ok(aT.n > 0 && aT.colored === aT.n,
        `${tag} ④b 微小高台棱侧壁保留（毫米级高差也有壁；n=${aT.n} 全补丁色 ${aT.colored}）`);
    }
    if (sPlane > 0) {
      const ovS2 = buildLevelOverlay(regionOf(sPlane, sR0), 0, 0);
      const wSNo = buildWallGeometry(table0, src0);
      const wSYes = buildWallGeometry(table0, src0, ovS2);
      const aS = planeStats(wSYes, wSNo, sPlane, sR0);
      ok(aS.n > 0 && aS.colored === aS.n,
        `${tag} ④b 台阶壁保留且全补丁色（n=${aS.n} 补丁 ${aS.colored}）——无空洞`);
      ok(aS.deep > 0, `${tag} ④b 台阶壁顶沿随深度场下降（满深顶点 n=${aS.deep}）——坑底落地`);
    }
  }


  {
    const A = buildTopGeometry(table0, src0, overlay);
    const B = buildTopGeometry(table0, src0, overlay);
    let dV = 0;
    for (let i = 0; i < A.vertices.length; i++) if (A.vertices[i] !== B.vertices[i]) dV++;
    ok(dV === 0, `${tag} ⑤同 overlay 两次构建逐位一致（v=${dV}）`);
  }

  // ---- ⑦ 防 T 结细缝：补丁 cell 全 fine（内部核 49 顶点/0.125m 细分）+ 同块内同点无高度分裂 ----
  {
    // 找一块完全落在单个 4m 块内部的 3×3 区域（避免设计内台阶线干扰判定）
    const fineBase = topFineCells(table0, src0);
    let bx7 = -1, by7 = -1;
    for (let b = 2; b <= 11 && bx7 < 0; b++) {
      for (let bb = 2; bb <= 11; bb++) {
        const ok2 = (lx: number, lz: number) => fineBase[lz * N + lx] === 0;
        if (ok2(b * 4 + 1, bb * 4 + 1) && ok2(b * 4 + 2, bb * 4 + 2) && ok2(b * 4 + 3, bb * 4 + 3)) {
          bx7 = b * 4 + 1; by7 = bb * 4 + 1; break;
        }
      }
    }
    ok(bx7 > 0, `${tag} ⑦找到平坦 3×3 区（块 ${bx7 >> 2},${by7 >> 2}）`);
    if (bx7 > 0) {
      const arr7 = new Uint8Array(N * N);
      for (let lz = by7; lz < by7 + 3; lz++) for (let lx = bx7; lx < bx7 + 3; lx++) arr7[lz * N + lx] = 1;
      const ov7 = buildLevelOverlay(arr7, 0, 0);
      const top7 = buildTopGeometry(table0, src0, ov7);
      const corePerCell = new Map<number, number>();
      const yAt = new Map<string, number[]>();
      for (let i = 0; i < top7.vertices.length / 3; i++) {
        const wx = top7.vertices[i * 3] + HALF, wz = top7.vertices[i * 3 + 2] + HALF;
        const lx = Math.floor(wx), lz = Math.floor(wz);
        const fx2 = wx - lx, fz2 = wz - lz;
        if (fx2 > 0.05 && fz2 > 0.05 && fx2 < 0.95 && fz2 < 0.95) {
          corePerCell.set(lz * N + lx, (corePerCell.get(lz * N + lx) ?? 0) + 1);
        }
        const k = wx.toFixed(3) + "," + wz.toFixed(3);
        const ys = yAt.get(k) ?? [];
        ys.push(top7.vertices[i * 3 + 1]);
        yAt.set(k, ys);
      }
      let badCore = 0;
      for (let lz = by7; lz < by7 + 3; lz++) {
        for (let lx = bx7; lx < bx7 + 3; lx++) {
          const n = corePerCell.get(lz * N + lx) ?? 0;
          if (n !== 49) badCore++;
        }
      }
      ok(badCore === 0, `${tag} ⑦补丁 cell 全部 0.125m 细分（内部核 49 顶点；坏 ${badCore}）`);
      let splitBad = 0, splitSeen = 0;
      for (const [k, ys] of yAt) {
        if (ys.length < 2) continue;
        const [wxS, wzS] = k.split(",").map(Number);
        if (wxS < bx7 + 0.05 || wxS > bx7 + 2.95 || wzS < by7 + 0.05 || wzS > by7 + 2.95) continue;
        splitSeen++;
        const maxY = Math.max(...ys), minY = Math.min(...ys);
        if (maxY - minY > 1e-3) splitBad++;
      }
      ok(splitSeen > 0 && splitBad === 0, `${tag} ⑦区域内同点无高度分裂（复查 ${splitSeen} 坏 ${splitBad}）`);
    }
  }

  // ---- ⑥ 跨 chunk：补丁触 seam ----
  {
    const mk = (rows: number[]) => {
      const a = new Uint8Array(N * N);
      for (let lx = 18; lx < 22; lx++) for (const lz of rows) a[lz * N + lx] = 1;
      return a;
    };
    const ovS0 = buildLevelOverlay(mk([59]), 0, 0);
    const ovS1 = buildLevelOverlay(mk([0]), 0, 1);
    ok(near(ovS0.depthOf(20, 59.999), 0, 0.01) && near(ovS1.depthOf(20, 60.001), 0, 0.01),
      `${tag} ⑥seam 两侧深度各自收口为 0（封死不悬空）`);
    const dNear = ovS0.depthOf(20, 59.75); // 距 seam 0.25m → 坡面中点（W=0.5）
    const dFar = ovS0.depthOf(20, 59.5);   // seam 行中段（1m 宽 → 恰满 1 层）
    ok(dNear > 0.05 && dNear < 0.15 && dFar >= PATCH_DEPTH - 1e-6,
      `${tag} ⑥seam 行坡降存在（0.25m=${dNear.toFixed(3)} 中段=${dFar.toFixed(3)}）`);
    const wS0 = buildWallGeometry(table0, src0, ovS0);
    const wS1 = buildWallGeometry(table1, src1, ovS1);
    let seam0 = 0, seam1 = 0, seamBad = 0;
    for (let i = 0; i < wS0.vertices.length; i += 3) {
      const wz = wS0.vertices[i + 2] + HALF;
      if (near(wz, CH, 1e-3) && isPatchCol(wS0.colors, i)) seam0++;
      else if (isPatchCol(wS0.colors, i)) seamBad++;
    }
    for (let i = 0; i < wS1.vertices.length; i += 3) {
      const wz = wS1.vertices[i + 2] + 60 + HALF;
      if (near(wz, CH, 1e-3) && isPatchCol(wS1.colors, i)) seam1++;
    }
    ok(seam0 > 0 && seam1 > 0, `${tag} ⑥seam 壁双侧保留且补丁色（A ${seam0} / B ${seam1}）`);
    ok(seamBad === 0, `${tag} ⑥无其他补丁色壁（越界着色 = ${seamBad}）`);
  }

  // ---- ⑧ Worker 字节级一致性：活闭包 vs 传输拷贝闭包（= terrainPatch Worker 路径） ----
  {
    const arr8 = new Uint8Array(N * N);
    for (let lz = 14; lz <= 16; lz++) for (let lx = 20; lx <= 23; lx++) arr8[lz * N + lx] = 1;
    const cmp = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined, name: string) => {
      if (!a || !b) return a === b;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    const live = computeTableGeometry((ccx, ccz) => raster.getChunkData(ccx, ccz), seed, 0, 0, arr8);
    // 传输拷贝语义：3×3 邻域 arrays 全量 new 拷贝 → Worker 端闭包（同 PatchChunkData）
    const copied = new Map<string, { heights: Float32Array; blockTypes: Uint8Array }>();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const d = raster.getChunkData(dx, dz);
        if (d) copied.set(`${dx},${dz}`, { heights: new Float32Array(d.heights), blockTypes: new Uint8Array(d.blockTypes) });
      }
    }
    const snap = computeTableGeometry(
      (ccx, ccz) => copied.get(`${ccx},${ccz}`),
      seed, 0, 0, arr8,
    );
    const topEq =
      cmp(live.top.vertices, snap.top.vertices, "v") &&
      cmp(live.top.normals, snap.top.normals, "n") &&
      cmp(live.top.colors, snap.top.colors, "c") &&
      cmp(live.top.indices, snap.top.indices, "i");
    const wallEq =
      cmp(live.wall.vertices, snap.wall.vertices, "v") &&
      cmp(live.wall.normals, snap.wall.normals, "n") &&
      cmp(live.wall.colors, snap.wall.colors, "c") &&
      cmp(live.wall.shade, snap.wall.shade, "s") &&
      cmp(live.wall.indices, snap.wall.indices, "i");
    ok(live.top.vertices.length > 0 && topEq && wallEq,
      `${tag} ⑧ Worker 拷贝路径几何字节与活源逐位一致（top=${live.top.vertices.length / 3}v wall=${live.wall.vertices.length / 3}v）`);
  }

  // ---- ⑨ 玩法高度采样同步：surfaceHeightAt 减补丁包络场（角色脚底/贴地/clamp） ----
  {
    const h0 = raster.surfaceHeightAt(20.5, 20.5);
    const outside0 = raster.surfaceHeightAt(33.5, 33.5);
    const foot = circleCells(20.5, 20.5, 0.6, CH).filter((c) => c.cx === 0 && c.cz === 0)
      .map((c) => ({ lx: c.lx, lz: c.lz }));
    const changed1 = raster.digCells(0, 0, foot);
    const h1 = raster.surfaceHeightAt(20.5, 20.5);
    const outside1 = raster.surfaceHeightAt(33.5, 33.5);
    ok(changed1 && near(h1 - h0, -PATCH_DEPTH, 1e-3) && near(raster.levelDepthAt(20.5, 20.5), PATCH_DEPTH, 1e-3),
      `${tag} ⑨ 单枪坑心 surfaceHeightAt −D（${(h1 - h0).toFixed(3)}，变化=${changed1}）`);
    ok(near(outside1 - outside0, 0, 1e-6), `${tag} ⑨ 坑外高度不受影响（Δ=${(outside1 - outside0).toFixed(5)}）`);
    ok(raster.isLevelPatched(20.5, 20.5) && !raster.isLevelPatched(33.5, 33.5),
      `${tag} ⑨ isLevelPatched 世界查询正确`);
  }

  // ---- ⑨b 补丁上再打补丁：同点两枪深 2D（无限修补的层数叠加） ----
  {
    const h1 = raster.surfaceHeightAt(20.5, 20.5);
    const foot = circleCells(20.5, 20.5, 0.6, CH).filter((c) => c.cx === 0 && c.cz === 0)
      .map((c) => ({ lx: c.lx, lz: c.lz }));
    // 几何基准 g1 = 第一枪后的层 1（与第二枪同布局 → 索引可比）
    const g1 = computeTableGeometry((ccx, ccz) => raster.getChunkData(ccx, ccz), seed, 0, 0,
      new Uint8Array(raster.levelsOf(0, 0)));
    const changed2 = raster.digCells(0, 0, foot);
    const h2 = raster.surfaceHeightAt(20.5, 20.5);
    ok(changed2 && near(h2 - h1, -PATCH_DEPTH, 1e-3) && near(raster.levelDepthAt(20.5, 20.5), 2 * PATCH_DEPTH, 1e-3),
      `${tag} ⑨b 两枪叠加中心 −2D（${(h2 - h1).toFixed(3)}，变化=${changed2}）`);
    const g2 = computeTableGeometry((ccx, ccz) => raster.getChunkData(ccx, ccz), seed, 0, 0,
      new Uint8Array(raster.levelsOf(0, 0)));
    ok(g1.top.vertices.length === g2.top.vertices.length, `${tag} ⑨b 层1/层2 布局一致（v=${g1.top.vertices.length}）`);
    let minDy = Infinity, splitBad = 0, fullHit = 0;
    for (let i = 0; i < g2.top.vertices.length / 3; i++) {
      const wx = g2.top.vertices[i * 3] + HALF, wz = g2.top.vertices[i * 3 + 2] + HALF;
      if (wx < 19.4 || wx > 21.6 || wz < 19.4 || wz > 21.6) continue;
      const dy = g2.top.vertices[i * 3 + 1] - g1.top.vertices[i * 3 + 1];
      if (dy < minDy) minDy = dy;
      if (dy < -PATCH_DEPTH - 1e-3 || dy > 1e-3) splitBad++; // 第二枪增量只能 ≤ −D
      if (near(dy, -PATCH_DEPTH, 1e-3)) fullHit++;
    }
    ok(near(minDy, -PATCH_DEPTH, 1e-3), `${tag} ⑨b 第二枪几何增量 minDy=${minDy.toFixed(3)} ≈ −D`);
    ok(splitBad === 0 && fullHit > 0, `${tag} ⑨b 包络连续（越界 ${splitBad}，满深点 ${fullHit}）`);
  }
}

run(12345);
run(42);

console.log(failures === 0 ? "\n=== REGION PATCH 全部通过 ===" : `\n=== 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);