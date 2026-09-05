/**
 * 查询后修改落位验收（RegionDeform）：
 *   ① 坑剖面：口沿 C¹、平底 −D、≥R 为 0（§13.4）
 *   ② 就地变形：fine cell 顶点下沉 ≈ profile；顶/壁/物理三通写同值
 *   ③ 水密：同一世界点（cell 边界 ↔ 壁顶沿）各槽位 Y 全等
 *   ④ coarse 部分覆盖 cell → 重建清单（needRefine 落位）
 *   ⑤ 法线重算：坑壁顶点法线偏离 (0,1,0)，且规范化
 *   ⑥ 大坑整入 coarse 区域：全内格就地沉、坑心深度 = D
 */
import { buildFaceTable } from "../src/services/map/FaceTable";
import { buildTopGeometry, buildWallGeometry, topFineCells } from "../src/services/map/FaceBuild";
import {
  classifyParts,
  query3D,
  worldKey,
  type BuiltChunk,
  type RegionTerrain,
  verticalPushOf,
} from "../src/services/map/RegionFaceQuery";
import {
  executeDeformInPlace,
  pitDepthUnder,
  pitProfileOffset,
  planDeform,
  yValuesAt,
  PIT_WALL,
} from "../src/services/map/RegionDeform";
import { RasterMap } from "../src/services/map/RasterMap";

const N = 60;
let failures = 0;
const ok = (c: boolean, m: string) => {
  if (c) console.log(`  ✓ ${m}`);
  else { failures++; console.log(`  ✗ ${m}`); }
};

function builtChunkOf(
  topG: { vertices: Float32Array; normals: Float32Array; indices: Uint32Array },
  wallG: { vertices: Float32Array; indices: Uint32Array },
  cx: number, cz: number,
): BuiltChunk {
  const pv = new Float32Array(topG.vertices.length + wallG.vertices.length);
  pv.set(topG.vertices, 0); pv.set(wallG.vertices, topG.vertices.length);
  const nVT = topG.vertices.length / 3;
  const pi = new Uint32Array(topG.indices.length + wallG.indices.length);
  pi.set(topG.indices, 0);
  for (let i = 0; i < wallG.indices.length; i++) pi[topG.indices.length + i] = wallG.indices[i] + nVT;
  return {
    key: (cx + 4096) * 8192 + (cz + 4096),
    topVertices: topG.vertices as Float32Array,
    topNormals: topG.normals as Float32Array,
    topIndices: topG.indices as Uint32Array,
    wallVertices: wallG.vertices as Float32Array,
    wallIndices: wallG.indices as Uint32Array,
    physVertices: pv,
    physIndices: pi,
  };
}

function run(seed: number) {
  const tag = `seed=${seed}`;
  const raster = new RasterMap(seed);
  raster.updateChunks(N / 2, N / 2, 3);
  const tableCache = new Map<number, ReturnType<typeof buildFaceTable>>();
  const built = new Map<number, BuiltChunk>();
  const terrain: RegionTerrain = {
    chunkSource: (cx, cz) => raster.chunkSource(cx, cz),
    getTable: (cx, cz) => {
      const key = (cx + 4096) * 8192 + (cz + 4096);
      let t = tableCache.get(key);
      if (!t) { t = buildFaceTable(raster.chunkSource(cx, cz), cx, cz); tableCache.set(key, t); }
      return t;
    },
    builtOf: (cx, cz) => built.get((cx + 4096) * 8192 + (cz + 4096)) ?? null,
  };
  const src0 = raster.chunkSource(0, 0);
  const table0 = buildFaceTable(src0, 0, 0);
  const topG0 = buildTopGeometry(table0, src0);
  const wallG0 = buildWallGeometry(table0, src0);
  const topPre = new Float32Array(topG0.vertices.length);
  const wallPre = new Float32Array(wallG0.vertices.length);
  const physPre = new Float32Array(
    topG0.vertices.length + wallG0.vertices.length);
  built.set((0 + 4096) * 8192 + (0 + 4096), builtChunkOf(topG0, wallG0, 0, 0));
  const b0 = built.get((0 + 4096) * 8192 + (0 + 4096))!;
  topPre.set(b0.topVertices); wallPre.set(b0.wallVertices); physPre.set(b0.physVertices);

  // ---- ① 坑剖面 ----
  {
    const R = 1.2, D = 0.4;
    ok(Math.abs(pitProfileOffset(R, R, D)) < 1e-9, `${tag} ①口沿 r=R offset=0`);
    ok(Math.abs(pitProfileOffset(0, R, D) - (-D)) < 1e-9, `${tag} ①坑心 = −D`);
    ok(pitProfileOffset(R + 0.5, R, D) === 0, `${tag} ①r≥R 之外 = 0`);
    const mid = pitProfileOffset(R - PIT_WALL / 2, R, D);
    ok(Math.abs(mid - (-D / 2)) < 1e-6, `${tag} ①壁中点 = −D/2（smoothstep(0.5)）`);
    const eps = 1e-4;
    const dA = (pitProfileOffset(R - eps, R, D) - pitProfileOffset(R, R, D)) / eps;
    const dB = (pitProfileOffset(R - PIT_WALL + eps, R, D) - pitProfileOffset(R - PIT_WALL, R, D)) / eps;
    ok(Math.abs(dA) < 0.02 && Math.abs(dB) < 0.02, `${tag} ①陡壁上/下端 C¹（斜率 ${dA.toFixed(3)}/${dB.toFixed(3)}）`);
  }

  // ---- ②③⑤ 深坑落在 fine cell 内 ----
  let fineIdx = -1;
  for (let i = 0; i < N * N; i++) if (topFineCells(table0, src0)[i]) { fineIdx = i; break; }
  ok(fineIdx >= 0, `${tag} ②存在 fine cell`);
  const lx = fineIdx % N, lz = Math.floor(fineIdx / N);
  const wx = lx + 0.5, wz = lz + 0.5;
  const gy = raster.surfaceHeightAt(wx, wz);
  const R = 0.8, D = 0.4;
  const dent = { kind: "sphere" as const, x: wx, y: gy, z: wz, r: R };
  const depthAt = pitDepthUnder(wx, wz, R, D);

  const RQ = query3D(dent, terrain);
  const plan = planDeform(RQ, classifyParts(RQ, { depthAt }));
  ok(plan.updates.length > 0, `${tag} ②plan 产出 ${plan.updates.length} 个下沉更新`);
  const res = executeDeformInPlace(RQ, plan, terrain, { depthAt });
  ok(res.written > 0, `${tag} ②就地写回 ${res.written} 槽（渲染+物理）→ normals=${res.normals}`);

  // 坑心：槽位同值 & 深度 ≈ D（对比变形前缓冲真高）
  {
    const preY = yValuesAt(RQ, wx, wz, terrain, { top: topPre, wall: wallPre, phys: physPre })[0];
    const ys = yValuesAt(RQ, wx, wz, terrain);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    ok(ys.length > 0 && maxY - minY < 1e-4, `${tag} ②坑心同点槽位同值（n=${ys.length} 差=${(maxY - minY).toExponential(1)}）`);
    ok(Math.abs(minY - (preY - D)) < 0.01, `${tag} ②坑心 Y=${minY.toFixed(3)} ≈ 原缓冲−D=${(preY - D).toFixed(3)}（pre=${preY.toFixed(3)}）`);
  }

  // ③ 写回不变式：每槽 = 原高 + 同一下沉量（dy 只依赖世界点）；不引入新缝隙
  {
    const dyByKey = new Map(plan.updates.map((u) => [worldKey(u.x, u.z), u.dy]));
    let checked = 0, writeBad = 0, gapBad = 0;
    for (const [key, dy] of dyByKey) {
      const [px, pz] = key.split(",").map(Number);
      const pre = yValuesAt(RQ, px, pz, terrain, { top: topPre, wall: wallPre, phys: physPre });
      const post = yValuesAt(RQ, px, pz, terrain);
      if (pre.length === 0) continue;
      checked++;
      for (let i = 0; i < post.length; i++) {
        if (Math.abs(post[i] - (pre[i] + dy)) > 1e-4 && writeBad < 6) {
          console.log(`    [debug] key=${key} dy=${dy.toFixed(4)} i=${i} pre=${pre[i].toFixed(4)} post=${post[i].toFixed(4)}`);
        }
        if (Math.abs(post[i] - (pre[i] + dy)) > 1e-4) writeBad++;
      }
      const span = (a: number[]) => Math.max(...a) - Math.min(...a);
      if (span(post) > span(pre) + 1e-6) gapBad++;
    }
    ok(checked > 0 && writeBad === 0 && gapBad === 0,
      `${tag} ③写回不变式：每槽=原高+dy（key=${checked} 错写=${writeBad}），缝隙不扩大（gap=${gapBad}）`);
  }

  // ④ coarse 部分覆盖 → 重建清单 + 内侧角照沉（平层区域确保坑缘有健康深度）
  {
    const d2 = { kind: "sphere" as const, x: wx + 20, y: gy, z: wz + 20, r: 1.4 };
    const d2d = pitDepthUnder(d2.x, d2.z, d2.r, D);
    const RQ2 = query3D(d2, terrain);
    const p2 = planDeform(RQ2, classifyParts(RQ2, { depthAt: d2d }));
    const coarseHits = RQ2.faces.filter(
      (f): f is Extract<typeof f, { kind: "top-cell" }> => f.kind === "top-cell" && !f.isFine,
    ).length;
    ok(coarseHits > 0, `${tag} ④坑触及 coarse cell（n=${coarseHits}）`);
    if (p2.rebuild.length > 0) {
      ok(p2.rebuild[0].reason === "coarse-partial-need-fine", `${tag} ④重建原因=${p2.rebuild[0].reason} (cells=${p2.stats.rebuildCells})`);
      ok(p2.rebuild[0].cells.length > 0, `${tag} ④重建 cell 清单非空`);
    }
    ok(p2.updates.length > 0, `${tag} ④部分覆盖格角落照沉（updates=${p2.updates.length} ≥ rebuild=${p2.stats.rebuildCells}）`);
  }

  // ⑤ 法线重算：坑壁顶点法线有水平分量且规范化
  {
    const chunk = built.get((0 + 4096) * 8192 + (0 + 4096))!;
    const face = RQ.faces.find(
      (f): f is Extract<typeof f, { kind: "top-cell" }> => f.kind === "top-cell" && f.isFine && plan.inPlaceFids.has(f.fid),
    );
    ok(face !== undefined, `${tag} ⑤有就地 fine face`);
    if (face) {
      const vB = face.render.vBase;
      let found = false, lenOK = true;
      for (let i = 0; i < face.render.vCount; i++) {
        const nx = chunk.topNormals[(vB + i) * 3], ny = chunk.topNormals[(vB + i) * 3 + 1], nz = chunk.topNormals[(vB + i) * 3 + 2];
        if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-3) lenOK = false;
        if (Math.abs(nx) > 0.01 || Math.abs(nz) > 0.01) found = true;
      }
      ok(lenOK, `${tag} ⑤法线规范化（长度=1）`);
      ok(found, `${tag} ⑤坑壁法线出现水平分量（偏离 (0,1,0)）`);
    }
  }

  // ⑥ 大坑整入 coarse 区域
  {
    const d3 = { kind: "sphere" as const, x: wx + 20, y: gy, z: wz + 20, r: 3 };
    const RQ3 = query3D(d3, terrain);
    const parts3 = classifyParts(RQ3, { depthAt: pitDepthUnder(d3.x, d3.z, d3.r, D) });
    const p3 = planDeform(RQ3, parts3);
    const coarseHits = RQ3.faces.filter((f) => f.kind === "top-cell" && !f.isFine).length;
    ok(planDeform(RQ3, parts3).updates.length > 0, `${tag} ⑥大坑 coarse 全内格就地沉（coarse=${coarseHits} updates=${p3.updates.length}）`);
    let cn: { dy: number } | undefined = undefined, bd = Infinity;
    for (const u of p3.updates) {
      const d = Math.hypot(u.x - d3.x, u.z - d3.z);
      if (d < bd) { bd = d; cn = u; }
    }
    ok(cn !== undefined && Math.abs(cn.dy + D) < 0.02, `${tag} ⑥大坑近心点 dy = ${cn?.dy.toFixed(3)} ≈ −D（距坑心 ${bd.toFixed(2)}m）`);
  }

  ok(verticalPushOf(dent, wx, gy, wz) > R - 1e-6, `${tag} ⑥球代理垂直下压量=r（${verticalPushOf(dent, wx, gy, wz).toFixed(2)}）`);
}

run(12345);
run(42);

console.log(failures === 0 ? "\n=== REGION DEFORM 全部通过 ===" : `\n=== 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);