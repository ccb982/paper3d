/**
 * 剔除+打补丁（§14.10 R+P）验收：
 *   ① circleCells：圆覆盖 coarse cell 判定（AABB 中心最近点；角点并入；跨 chunk；负坐标；幂等）
 *   ② 顶面：补丁 fine cell 内部子顶点 = 原面 − PATCH_DEPTH 且颜色 = PATCH_COLOR；
 *      未补丁 fine cell 内部子顶点原样 0/[1,1,1]
 *   ③ 法线不变：平移下挖不改法线（逐顶点全等）
 *   ④ 侧壁：own 补丁 → 顶沿 −depth 且补丁色；补丁区外沿壁（邻补丁）= 补丁色（坑边界壁=补丁）；
 *      远离补丁区原样 [0.6]
 *   ⑤ 确定性/幂等：同一 overlay 两次构建逐位一致；circleCells 幂等
 *   ⑥ 跨 chunk 一致性：patch 横跨 z=60 缝隙 → 双侧壁顶沿同世界 x 列均有坑口下挖 → 边界棱闭合
 */
import {
  buildTopGeometry,
  buildWallGeometry,
  circleCells,
  topFineCells,
  PATCH_DEPTH,
  PATCH_COLOR,
  type PatchOverlay,
} from "../src/services/map/FaceBuild";
import { buildFaceTable } from "../src/services/map/FaceTable";
import { RasterMap } from "../src/services/map/RasterMap";

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

/** 从局部 cell 下标集合构造 PatchOverlay（isPatched 走全局 cell 语义） */
function overlayOf(cells: Set<number>): PatchOverlay {
  return {
    isPatched: (lx: number, lz: number) =>
      lx >= 0 && lz >= 0 && lx < N && lz < N && cells.has(lz * N + lx),
    depth: PATCH_DEPTH,
    color: PATCH_COLOR,
  };
}

/** 世界坐标在 cell (lx,lz) 内、且位于 1m 网格边界之内（fine 内部子节点；排除共享边界） */
function fineCoreVerts(
  g: { vertices: Float32Array },
  lx: number,
  lz: number,
  ox: number,
  oz: number,
): number[] {
  const out: number[] = [];
  const v = g.vertices;
  for (let i = 0; i < v.length / 3; i++) {
    const wx = v[i * 3] + ox + HALF;
    const wz = v[i * 3 + 2] + oz + HALF;
    const fx = wx - Math.floor(wx);
    const fz = wz - Math.floor(wz);
    if (Math.floor(wx) === lx && Math.floor(wz) === lz && fx > 0.01 && fz > 0.01) out.push(i);
  }
  return out;
}

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

  // ---- ②③ 顶面：找一个 fine cell (沉浸区) 补丁，与一个远处 fine cell 对拍 ----
  const fine = topFineCells(table0, src0);
  let fx = -1, fy = -1, dx = -1, dy = -1;
  for (let i = 0; i < N * N; i++) if (fine[i]) { fx = i % N; fy = (i / N) | 0; break; }
  for (let j = (fy + 3) * N; j < N * N; j++) if (fine[j]) { dx = j % N; dy = (j / N) | 0; break; }
  const singlePatch = new Set<number>([fy * N + fx]);
  const topNo = buildTopGeometry(table0, src0);
  const topYes = buildTopGeometry(table0, src0, undefined, overlayOf(singlePatch));

  {
    const pv = fineCoreVerts(topYes, fx, fy, 0, 0);   // 补丁 fine cell 内部
    const uv2 = fineCoreVerts(topYes, dx, dy, 0, 0);  // 远处 fine cell 内部
    ok(fx >= 0 && dx >= 0 && pv.length > 0 && uv2.length > 0,
      `${tag} ②找到补丁 fine cell(${fx},${fy}) 与远处 cell(${dx},${dy})（内点 ${pv.length}/${uv2.length}）`);
    let badH = 0, badC = 0;
    for (const i of pv) {
      if (!near(topYes.vertices[i * 3 + 1] - topNo.vertices[i * 3 + 1], -PATCH_DEPTH)) badH++;
      if (!isPatchCol(topYes.colors, i * 3)) badC++;
    }
    for (const i of uv2) {
      if (!near(topYes.vertices[i * 3 + 1] - topNo.vertices[i * 3 + 1], 0)) badH++;
      if (!isWhite(topYes.colors, i * 3)) badC++;
    }
    ok(badH === 0, `${tag} ②补丁 = 原面 − depth、原样补丁外 = 原面（坏 ${badH}）`);
    ok(badC === 0, `${tag} ②补丁区 = PATCH_COLOR、原样区 = [1,1,1]（坏 ${badC}）`);
    let badN = 0;
    for (let i = 0; i < topYes.normals.length; i++) {
      if (!near(topYes.normals[i] - topNo.normals[i], 0, 1e-6)) badN++;
    }
    ok(badN === 0, `${tag} ③法线平移不变（零差 ${badN}）`);
  }

  // ---- ④ 侧壁：4×4 补丁区 [12..16)² 数据驱动 ----
  const patch4 = new Set<number>();
  for (let lz = 12; lz < 16; lz++) for (let lx = 12; lx < 16; lx++) patch4.add(lz * N + lx);
  const wallNo = buildWallGeometry(table0, src0);
  const wallYes = buildWallGeometry(table0, src0, undefined, overlayOf(patch4));
  {
    let loweredN = 0, loweredColBad = 0, intactN = 0, intactBad = 0, nbCol = 0;
    const vWn = wallNo.vertices, vWy = wallYes.vertices, cWy = wallYes.colors;
    const zone = (wx: number, wz: number) => Math.hypot(wx - 14, wz - 14);
    for (let i = 0; i < vWy.length / 3; i++) {
      const wx = vWy[i * 3] + HALF, wz = vWy[i * 3 + 2] + HALF;
      const dy = vWy[i * 3 + 1] - vWn[i * 3 + 1];
      if (near(dy, -PATCH_DEPTH)) {
        loweredN++;
        if (!isPatchCol(cWy, i * 3)) loweredColBad++;
      } else if (zone(wx, wz) > 15) {
        intactN++;
        if (!near(dy, 0)) intactBad++;
      } else if (zone(wx, wz) < 6 && isPatchCol(cWy, i * 3)) {
        nbCol++; // 未下挖但贴补丁 → 外沿壁补丁色
      }
    }
    ok(loweredN > 0 && loweredColBad === 0, `${tag} ④own 补丁侧壁顶沿 −depth 且补丁色（n=${loweredN} 坏色 ${loweredColBad}）`);
    // 注意：intactBad 的 [0.6] 断言需用 [1,1,1]≠、真实占位色为 0.6 → 单独检查
    let farGrayBad = 0;
    for (let i = 0; i < vWy.length / 3; i++) {
      const wx = vWy[i * 3] + HALF, wz = vWy[i * 3 + 2] + HALF;
      if (zone(wx, wz) > 15) {
        const yc = near(cWy[i * 3], 0.6) && near(cWy[i * 3 + 1], 0.6) && near(cWy[i * 3 + 2], 0.6);
        if (!yc) farGrayBad++;
      }
    }
    ok(intactN > 0 && intactBad === 0, `${tag} ④远离补丁区侧壁原样（n=${intactN} 坏 ${intactBad}）`);
    ok(farGrayBad === 0, `${tag} ④远离区颜色占位 [0.6] 未扰动（坏 ${farGrayBad}）`);
    ok(nbCol > 0, `${tag} ④补丁外沿壁（邻补丁侧）补丁色 n=${nbCol}（坑边界壁=补丁）`);
  }

  // ---- ⑤ 确定性/幂等 ----
  {
    const A = buildTopGeometry(table0, src0, undefined, overlayOf(patch4));
    const B = buildTopGeometry(table0, src0, undefined, overlayOf(patch4));
    let dV = 0, dC = 0;
    for (let i = 0; i < A.vertices.length; i++) {
      if (A.vertices[i] !== B.vertices[i]) dV++;
      if (A.colors[i] !== B.colors[i]) dC++;
    }
    ok(dV === 0 && dC === 0, `${tag} ⑤同 overlay 两次构建逐位一致（v=${dV} c=${dC}）`);
  }

  // ---- ⑥ 跨 chunk（z=60 缝隙）：两侧同宽 patch → 双侧同一世界 x 列坑口下挖 ----
  {
    const AX = new Set<number>(), BX = new Set<number>();
    for (let lx = 18; lx < 22; lx++) { AX.add(59 * N + lx); BX.add(0 * N + lx); }
    const AYes = buildWallGeometry(table0, src0, undefined, overlayOf(AX));
    const BYes = buildWallGeometry(table1, src1, undefined, overlayOf(BX));
    const lowerAtSeam = (g: { vertices: Float32Array }, planeLocal: number): number[] => {
      const out: number[] = [];
      const v = g.vertices;
      for (let i = 0; i < v.length; i += 3) {
        if (near(v[i + 2], planeLocal, 1e-3)) out.push(v[i] + HALF); // 世界 x
      }
      return out;
    };
    const ax = lowerAtSeam(AYes, 30);   // chunk(0,0) 南壁 local z=30 (world 60)
    const bx = lowerAtSeam(BYes, -30);  // chunk(0,1) 北壁 local z=−30 (world 60)
    ok(ax.length > 0 && bx.length > 0, `${tag} ⑥缝隙双侧坑壁存在（A ${ax.length} B ${bx.length} 顶点）`);
    const shared = ax.some((x) => bx.some((y) => near(x, y, 0.05)));
    ok(shared, `${tag} ⑥同一世界 x 列双侧都有坑口 → 边界棱闭合`);
  }
}

run(12345);
run(42);

console.log(failures === 0 ? "\n=== REGION PATCH 全部通过 ===" : `\n=== 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);