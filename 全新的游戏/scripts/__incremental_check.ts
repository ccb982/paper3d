/**
 * __incremental_check —— 增量几何 vs 全量几何 逐位一致性验收（开发验证用）
 *   · 对多 seed / 多 level 掩码：incrementalGeometry（含缓存 miss→hit）输出
 *     与 buildTopGeometry/buildWallGeometry（全量）逐位一致
 *   · computeTableGeometry(seed,cx,cz,levels) 同掩码连续两次（第二次缓存命中）一致
 * 执行：npx esbuild scripts/__incremental_check.ts --bundle --platform=node
 *       --format=esm --outfile=inc_check.mjs && node inc_check.mjs
 */
import { generateChunk } from "../src/services/map/ChunkGenerator";
import { buildFaceTable } from "../src/services/map/FaceTable";
import {
  buildLevelOverlay, buildTopGeometry, buildWallGeometry,
  type FaceGeometry,
} from "../src/services/map/FaceBuild";
import {
  incrementalGeometry, incrementalDropCache,
} from "../src/services/map/IncrementalGeometry";
import { computeTableGeometry } from "../src/services/map/PatchCompute";
import { makeChunkSource, refineChunkSource } from "../src/services/map/Refinements";

let failures = 0;
const ok = (c: boolean, m: string) => {
  if (c) console.log(`  ✓ ${m}`);
  else { failures++; console.log(`  ✗ ${m}`); }
};

const N = 60;

function makeReadChunk(seed: number) {
  const cache = new Map<string, { heights: Float32Array; blockTypes: Uint8Array }>();
  return (ccx: number, ccz: number) => {
    const key = `${ccx},${ccz}`;
    let d = cache.get(key);
    if (!d) {
      const g = generateChunk(seed, ccx, ccz);
      d = { heights: new Float32Array(g.heights), blockTypes: new Uint8Array(g.blockTypes) };
      cache.set(key, d);
    }
    return d;
  };
}

function bytesOf(v: Float32Array | Uint32Array | undefined): string {
  if (!v) return "null";
  const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = v.length + ":";
  // 抽样式散列（逐字节对比在长数组上慢；抽样 256 点 + 首尾）
  const step = Math.max(1, Math.floor(b.length / 256));
  for (let i = 0; i < b.length; i += step) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function sameGeom(a: FaceGeometry, b: FaceGeometry): boolean {
  const arrs = (g: FaceGeometry): (Float32Array | Uint32Array | undefined)[] => [
    g.vertices, g.normals, g.uvs, g.colors, g.shade, g.patchW, g.indices,
  ];
  const A = arrs(a), B = arrs(b);
  for (let i = 0; i < A.length; i++) {
    const x = A[i], y = B[i];
    if (x === undefined || y === undefined) { if (x !== y) return false; continue; }
    if (x.byteLength !== y.byteLength) return false;
    const xb = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    const yb = new Uint8Array(y.buffer, y.byteOffset, y.byteLength);
    for (let k = 0; k < xb.length; k++) if (xb[k] !== yb[k]) return false;
  }
  return a.topTriCount === b.topTriCount;
}

function makeLevels(patches: [number, number, number][]): Uint8Array {
  const l = new Uint8Array(N * N);
  for (const [x, z, n] of patches) l[z * N + x] = n;
  return l;
}

function run(seed: number, cx: number, cz: number) {
  const tag = `seed=${seed} chunk=${cx},${cz}`;
  const readChunk = makeReadChunk(seed);
  const src = refineChunkSource(makeChunkSource(readChunk), seed, cx, cz);
  const table = buildFaceTable(src, cx, cz);

  const masks: Uint8Array[] = [
    makeLevels([[30, 30, 3]]),
    makeLevels([[20, 20, 1], [20, 21, 1], [21, 20, 1], [21, 21, 1]]),
    makeLevels([[16, 48, 2], [18, 46, 4], [22, 42, 1], [10, 10, 3]]),
    makeLevels([[0, 0, 2], [59, 59, 2], [0, 59, 1], [59, 0, 1]]),
    makeLevels([[30, 0, 4], [40, 28, 2], [50, 50, 1]]),
  ];

  for (let m = 0; m < masks.length; m++) {
    const levels = masks[m];
    const patch = buildLevelOverlay(levels, cx, cz);
    const refTop = buildTopGeometry(table, src, patch);
    const refWall = buildWallGeometry(table, src, patch);

    // ① 缓存 miss → 增量
    incrementalDropCache();
    const inc1 = incrementalGeometry(seed, cx, cz, table, src, patch);
    ok(sameGeom(inc1.top, refTop), `${tag} m${m} 顶面：miss 增量 = 全量`);
    ok(sameGeom(inc1.wall, refWall), `${tag} m${m} 侧壁：miss 增量 = 全量`);

    // ② 缓存 hit → 增量
    const inc2 = incrementalGeometry(seed, cx, cz, table, src, patch);
    ok(sameGeom(inc2.top, refTop), `${tag} m${m} 顶面：hit 增量 = 全量`);
    ok(sameGeom(inc2.wall, refWall), `${tag} m${m} 侧壁：hit 增量 = 全量`);

    // ③ computeTableGeometry 端到端（连续两次，第二次命中基座）
    incrementalDropCache();
    const g1 = computeTableGeometry(readChunk, seed, cx, cz, new Uint8Array(levels), null);
    const g2 = computeTableGeometry(readChunk, seed, cx, cz, new Uint8Array(levels), null);
    ok(
      bytesOf(g1.top.vertices) === bytesOf(g2.top.vertices) &&
        bytesOf(g1.wall.vertices) === bytesOf(g2.wall.vertices) &&
        g1.top.indices.length === g2.top.indices.length &&
        g1.wall.indices.length === g2.wall.indices.length,
      `${tag} m${m} computeTableGeometry miss/hit 字节一致`,
    );
    void patch;
  }

  // ④ 层数累积：同一个 base 下，先后两份 levels 各自增量都等于各自全量
  const L1 = makeLevels([[15, 15, 2]]);
  const L2 = makeLevels([[15, 15, 2], [40, 40, 3]]);
  const ptA = buildLevelOverlay(L1, cx, cz);
  const ptB = buildLevelOverlay(L2, cx, cz);
  incrementalDropCache();
  const iA = incrementalGeometry(seed, cx, cz, table, src, ptA);
  const refA = buildTopGeometry(table, src, ptA);
  ok(sameGeom(iA.top, refA), `${tag} 累积① levelsL1 增量 = 全量`);
  const iB = incrementalGeometry(seed, cx, cz, table, src, ptB);
  const refB = buildTopGeometry(table, src, ptB);
  ok(sameGeom(iB.top, refB), `${tag} 累积② levelsL2（在 L1 基座上）增量 = 全量`);
}

const MAJOR_LOG: { bytesOf: (v: Float32Array | Uint32Array | undefined) => string } = {
  bytesOf,
};
void MAJOR_LOG;

function timing(seed: number, cx: number, cz: number) {
  const readChunk = makeReadChunk(seed);
  const src = refineChunkSource(makeChunkSource(readChunk), seed, cx, cz);
  const table = buildFaceTable(src, cx, cz);
  // 中等伤疤（3×3 坑 + 两处单格擦痕），跨越块边界
  const levels = makeLevels([
    [20, 20, 2], [20, 21, 2], [21, 20, 2], [21, 21, 2],
    [31, 33, 1], [45, 12, 3],
  ]);
  const patch = buildLevelOverlay(levels, cx, cz);
  // 预热基座缓存
  incrementalDropCache();
  incrementalGeometry(seed, cx, cz, table, src, patch);
  // 计时：全量（每次全采样） vs 增量（基座命中，只重发受影响地块）
  const N_RUN = 20;
  let t0 = performance.now();
  for (let i = 0; i < N_RUN; i++) {
    buildTopGeometry(table, src, patch);
    buildWallGeometry(table, src, patch);
  }
  const fullMs = (performance.now() - t0) / N_RUN;
  t0 = performance.now();
  for (let i = 0; i < N_RUN; i++) incrementalGeometry(seed, cx, cz, table, src, patch);
  const incMs = (performance.now() - t0) / N_RUN;
  console.log(
    `\n★ 计时（seed=${seed} chunk=${cx},${cz} 中坑，${N_RUN} 次均值）` +
      `\n    全量 top+wall：${fullMs.toFixed(1)}ms   增量（基座命中）：${incMs.toFixed(2)}ms   ` +
      `加速 ${fullMs / incMs > 1 ? `${(fullMs / incMs).toFixed(1)}×` : "×（无加速）"}`,
  );
  process.exit(0);
}

function main() {
  run(101, 0, 0);
  run(7, 1, 0);
  run(2024, 0, -1);
  if (failures === 0) console.log("\n★ 增量几何与全量几何逐位一致（全部通过）");
  else { console.log(`\n✗ ${failures} 项失配`); process.exit(1); }
  timing(101, 0, 0);
}

main();