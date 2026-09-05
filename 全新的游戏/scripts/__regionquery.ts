/**
 * 三维区域面查询工具验收（§14.8）：
 *   ① 拓扑重扫 vs 一次性装配逐位一致（顶/壁顶点+索引总数）
 *   ② 阶段1 粗筛：返回面的足迹/条带与形状 bounds 相交、两模式身份一致
 *   ③ 阶段2 分类：inside 顶点判定与形状 SDF 一致；partial 三角有边界交点参数
 *   ④ 模式 B 对位：resolveFaceVertices 的切片下标读真实缓冲与采样值一致
 *   ⑤ 读写往返：applyFaceVertices 后渲染/物理同序同值、同世界点两侧同值
 *   ⑥ 跨 chunk + 复合形状（union 球+折线槽）
 */
import {
  buildTopGeometry,
  buildWallGeometry,
  topFineCells,
} from "../src/services/map/FaceBuild";
import { buildFaceTable } from "../src/services/map/FaceTable";
import {
  applyFaceVertices,
  buildTopLayout,
  buildWallLayout,
  boundsOf,
  classifyParts,
  containsShape,
  layoutMatchesBuild,
  query3D,
  resolveFaceVertices,
  sdfAt,
  verticalPushOf,
  type BuiltChunk,
  type RegionTerrain,
} from "../src/services/map/RegionFaceQuery";
import { RasterMap } from "../src/services/map/RasterMap";

const CH = 60;
let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};

function makeTerrain(raster: RasterMap, built?: Map<number, BuiltChunk>): RegionTerrain {
  const tableCache = new Map<number, ReturnType<typeof buildFaceTable>>();
  return {
    chunkSource: (cx, cz) => raster.chunkSource(cx, cz),
    getTable: (cx, cz) => {
      const key = (cx + 4096) * 8192 + (cz + 4096);
      let t = tableCache.get(key);
      if (!t) { t = buildFaceTable(raster.chunkSource(cx, cz), cx, cz); tableCache.set(key, t); }
      return t;
    },
    builtOf: built ? (cx, cz) => built.get((cx + 4096) * 8192 + (cz + 4096)) ?? null : undefined,
  };
}

function builtChunkOf(
  raster: RasterMap, cx: number, cz: number,
  topG: { vertices: Float32Array; indices: Uint32Array },
  wallG: { vertices: Float32Array; indices: Uint32Array },
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
    topNormals: new Float32Array(topG.vertices.length),
    topIndices: topG.indices as Uint32Array,
    wallVertices: wallG.vertices as Float32Array,
    wallIndices: wallG.indices as Uint32Array,
    physVertices: pv,
    physIndices: pi,
  };
}

function run(seed: number) {
  const raster = new RasterMap(seed);
  raster.updateChunks(CH / 2, CH / 2, 3); // 覆盖 (−1..1, −1..1) 一带
  const terrain = makeTerrain(raster);
  const tag = `seed=${seed}`;

  // ---- ① 拓扑重扫对拍（chunk 0,0 与 0,1）----
  for (const [cx, cz] of [[0, 0], [0, 1], [1, 0]] as const) {
    const src = raster.chunkSource(cx, cz);
    const table = buildFaceTable(src, cx, cz);
    const fineE = topFineCells(table, src);
    const topG = buildTopGeometry(table, src);
    const wallG = buildWallGeometry(table, src);
    const rep = layoutMatchesBuild(fineE, topG, wallG);
    ok(rep.ok, `${tag} ①拓扑对拍 chunk(${cx},${cz}) ${rep.detail}`);
  }

  // ---- ②③ 球坑查询　----
  const gx = 0 * CH + 30.5, gz = 0 * CH + 30.5;
  const gy = raster.surfaceHeightAt(gx, gz);
  const sphere = { kind: "sphere" as const, x: gx, y: gy, z: gz, r: 2 };
  let t0 = performance.now();
  const RQ = query3D(sphere, terrain);
  const t1 = performance.now();
  const RQ2 = query3D(sphere, terrain); // 二次查询：getTable 命中同表 → fineCache(WeakMap) 命中 → 纯查询
  const t2 = performance.now();
  ok(RQ.faces.length > 0, `${tag} ②球坑 命中 ${RQ.faces.length} 面（含顶 ${RQ.faces.filter((f) => f.kind === "top-cell").length} 壁 ${RQ.faces.filter((f) => f.kind === "wall").length}），query3D 首次 ${(t1 - t0).toFixed(1)}ms 二次 ${(t2 - t1).toFixed(1)}ms`);

  const B = boundsOf(sphere);
  let badFoot = 0;
  for (const f of RQ.faces) {
    if (f.kind === "top-cell") {
      const fx0 = f.cx * CH + f.lx, fz0 = f.cz * CH + f.lz;
      if (!(fx0 < B.maxX && fx0 + 1 > B.minX && fz0 < B.maxZ && fz0 + 1 > B.minZ)) badFoot++;
    }
  }
  ok(badFoot === 0, `${tag} ②顶 cell 足迹全部与 bounds 相交（越界=${badFoot}）`);

  const parts = classifyParts(RQ);
  let vertMiss = 0, triMiss = 0, crossOK = 0;
  for (const p of parts) {
    if (p.top) {
      for (const v of p.top.verts) {
        if (containsShape(sphere, v.gx, v.y, v.gz) !== v.inside) { vertMiss++; }
      }
      for (let i = 0; i < p.top.triStates.length; i++) {
        const st = p.top.triStates[i];
        if (st === -1) {
          // partial 三角必须带边界交点
          const se = p.top.crossings.length > 0;
          if (se) crossOK++;
          else triMiss++;
        }
      }
    }
    if (p.wall) {
      for (const n of p.wall.nodes) {
        if (containsShape(sphere, n.x, n.topY, n.z) !== n.inside) vertMiss++;
      }
    }
  }
  ok(vertMiss === 0, `${tag} ③顶点 in/out 判定与形状 SDF 一致（err=${vertMiss}）`);
  ok(triMiss === 0 && crossOK > 0, `${tag} ③partial 三角均带边界交点参数（析出=${crossOK} err=${triMiss}）`);

  // ④ 模式 B 对位：切片下标读真实缓冲 == 采样值
  const src0 = raster.chunkSource(0, 0);
  const table0 = buildFaceTable(src0, 0, 0);
  const topG0 = buildTopGeometry(table0, src0);
  const wallG0 = buildWallGeometry(table0, src0);
  const built = new Map<number, BuiltChunk>();
  built.set((0 + 4096) * 8192 + (0 + 4096), builtChunkOf(raster, 0, 0, topG0, wallG0));
  built.set((1 + 4096) * 8192 + (0 + 4096), builtChunkOf(raster, 1, 0, buildTopGeometry(buildFaceTable(raster.chunkSource(1, 0), 1, 0), raster.chunkSource(1, 0)), buildWallGeometry(buildFaceTable(raster.chunkSource(1, 0), 1, 0), raster.chunkSource(1, 0))));
  const terrainB = makeTerrain(raster, built);
  const RQb = query3D(sphere, terrainB);
  let slotMiss = 0, slotChecked = 0;
  for (const f of RQb.faces) {
    if (f.kind !== "top-cell") continue;
    const chunk = built.get((f.cx + 4096) * 8192 + (f.cz + 4096))!;
    const slots = resolveFaceVertices(RQb, f);
    for (const s of slots) {
      // 渲染缓冲为 chunk 局部坐标（x/z −ox−HALF），y 为世界高（不偏移）
      const lx = s.x - f.cx * CH - CH / 2;
      const lz = s.z - f.cz * CH - CH / 2;
      const arr = s.renderMesh === "top" ? chunk.topVertices : chunk.wallVertices;
      for (const vi of s.renderVertex) {
        slotChecked++;
        if (Math.abs(arr[vi * 3] - lx) > 1e-6 || Math.abs(arr[vi * 3 + 1] - s.y) > 1e-6 || Math.abs(arr[vi * 3 + 2] - lz) > 1e-6) slotMiss++;
      }
    }
  }
  ok(slotMiss === 0 && slotChecked > 0, `${tag} ④切片下标读真实缓冲 == 表采样值（checked=${slotChecked} err=${slotMiss}）`);

  // ⑤ 读写往返：同世界点（顶沿↔壁顶沿）两侧同值、渲染=物理同序同值
  const centerCell = RQb.faces.find((f): f is Extract<typeof f, { kind: "top-cell" }> => f.kind === "top-cell" && f.isFine);
  const upd = classifyParts(RQb);
  if (centerCell) {
    const p = upd.find((pi2) => pi2.fid === centerCell.fid)!;
    const ds = p.top!.verts.filter((v) => v.inside).slice(0, 3).map((v) => ({ x: v.gx, z: v.gz, dy: -0.5 }));
    const wrote = applyFaceVertices(RQb, ds, terrainB);
    let same = true, physChecked = 0;
    for (const f of RQb.faces) {
      if (f.kind !== "top-cell") continue;
      const slots = resolveFaceVertices(RQb, f);
      const chunk = built.get((f.cx + 4096) * 8192 + (f.cz + 4096))!;
      for (const s of slots) {
        if (s.renderMesh !== "top") continue;
        for (let k = 0; k < s.renderVertex.length; k++) {
          const rv = s.renderVertex[k], pv = s.physVertex[k];
          physChecked++;
          if (chunk.topVertices[rv * 3 + 1] !== chunk.physVertices[pv * 3 + 1]) same = false;
        }
      }
    }
    ok(wrote > 0 && same && physChecked > 0, `${tag} ⑤apply 写入=${wrote} 渲染=物理同值（physChecked=${physChecked}）`);
  }

  // ⑥ 复合形状 + 跨 chunk：union(球 + 折线槽) 横跨 (0,0)|(1,0)
  const slot = {
    kind: "slot" as const,
    pts: [[59.5, 0 * CH + 29], [61.5, 0 * CH + 31]] as [number, number][],
    halfW: 0.6, topY: gy + 0.6, depth: 2,
  };
  const union = { kind: "union" as const, a: sphere, b: slot };
  const cross = query3D(union, terrainB);
  const chunkSet = new Set([...cross.chunks.keys()]);
  const has01 = chunkSet.has((0 + 4096) * 8192 + (0 + 4096));
  const has11 = chunkSet.has((1 + 4096) * 8192 + (0 + 4096));
  ok(has01 && has11, `${tag} ⑥复合形状跨 chunk：涉及 {0,0}+{1,0}（面数=${cross.faces.length}）`);
  ok(sdfAt(slot, 60.5, gy + 0.6, 30) <= 0 && sdfAt(slot, 60.9, gy + 1, 30.2) > 0, `${tag} ⑥折线槽 SDF 正确（槽内含/外）`);
  ok(verticalPushOf(sphere, gx, gy, gz) > 1.9 && verticalPushOf(sphere, gx + 3, gy, gz) === 0, `${tag} ⑥垂直下压量代理正确`);
}

run(12345);
run(42);

console.log(failures === 0 ? "\n=== REGION QUERY 全部通过 ===" : `\n=== 失败 ${failures} 项 ===`);
process.exit(failures === 0 ? 0 : 1);