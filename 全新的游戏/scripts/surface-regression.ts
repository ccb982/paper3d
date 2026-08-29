// ============================================================
// surface-regression —— 视觉面重构回归（SurfaceRules 对照旧公式）
// ============================================================
// 用法：
//   weld 逐位对照 + β 统计：  npx tsx scripts/surface-regression.ts
//   （exit 1 = 回归失败）
//
// 六阶段：
//   A（weld 对照）：setEdgeCliffBand(-1) → 恒 weld = 旧世界。
//      sampleSurface 必须与旧公式（2×2 max + 三角形插值）【逐位一致】——
//      收敛三处重复实现的正确性证明。
//   B（β 统计）：恢复默认裁决带，统计 cliff 边按角色对分布（人工抽查
//      观感用）；并校验裁决对称性/确定性。
//   C（自由选择）：edgePolicy 覆盖 + 角色对规则 + 裁决带开关语义
//      （hard > smooth > 角色对 > β）。
//   D（网格装配）：ChunkSurface 顶面逐 cell 四角/UV/法线/索引与
//      SurfaceRules 语义对照（渲染=查询逐位同源）。
//   E（快照一致）：bakeCompute 快照源 vs 主线程块源逐位对照
//      （Worker 烘焙与主线程贴地同源证明）。
//   F（角点许可）：cornerHeight 插值许可语义——两边皆 weld 才插值，
//      任一 cliff 边段 → 自持（硬边直达角点零插值）。
//   G（精修执行器）：edgeFinal 唯一判点——默认引擎 ↔ 显式覆写 ↔ inherit
//      回落三者语义；refine 空精修恒透传（与默认引擎逐位一致）。
// ============================================================
import {
  generateChunk, CHUNK_SIZE,
  type ChunkData,
} from '../src/services/map/ChunkGenerator';
import {
  sampleSurface, edgeRuling, edgeOf, setEdgeCliffBand,
  cornerHeight, finalRuling, weldGap, baseHeightOf,
  type BlockSource, type BlockInfo,
} from '../src/services/map/SurfaceRules';
import { refine, overrideEdge, EMPTY_REFINEMENTS, setHeight, carveGradientErosion } from '../src/services/map/Refinements';
import { tileById, registerTile, TileDef } from '../src/services/map/Tiles';
import { buildChunkTopSurface } from '../src/services/map/ChunkSurface';
import { buildSnapshotFromChunks, makeSnapshotSource } from '../src/services/map/bakeCompute';
import type { RasterMap } from '../src/services/map/RasterMap';

declare const process: { exit(code: number): void };

// ---- chunk 缓存（per seed；同 RasterMap.ensureChunk 语义） ----
const cache = new Map<string, ChunkData>();
function getChunk(seed: number, cx: number, cz: number): ChunkData {
  const key = `${seed}:${cx}:${cz}`;
  let c = cache.get(key);
  if (!c) { c = generateChunk(seed, cx, cz); cache.set(key, c); }
  return c;
}

function makeSource(seed: number): BlockSource {
  return {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      const mx = bx * 4, mz = bz * 4;
      const cx = Math.floor(mx / CHUNK_SIZE);
      const cz = Math.floor(mz / CHUNK_SIZE);
      const c = getChunk(seed, cx, cz);
      const lx = mx - cx * CHUNK_SIZE;
      const lz = mz - cz * CHUNK_SIZE;
      const bi = (lz / 4) * 15 + lx / 4;
      return { id: c.blockTypes[bi] ?? 0, h: c.heights[lz * CHUNK_SIZE + lx] ?? 0 };
    },
  };
}

// ---- 旧公式参照实现（重构前 RasterMap 逐字迁移；勿优化） ----
function oldHeightAt(src: BlockSource, x: number, z: number): number {
  return src.blockAt(Math.floor(x / 4), Math.floor(z / 4))?.h ?? 0;
}
function oldVertexHeightAt(src: BlockSource, x: number, z: number): number {
  return Math.max(
    oldHeightAt(src, x - 1, z - 1), oldHeightAt(src, x, z - 1),
    oldHeightAt(src, x - 1, z), oldHeightAt(src, x, z),
  );
}
function oldSurfaceHeightAt(src: BlockSource, x: number, z: number): number {
  const gx = Math.floor(x), gz = Math.floor(z);
  const fx = x - gx, fz = z - gz;
  const h00 = oldVertexHeightAt(src, gx, gz);
  const h10 = oldVertexHeightAt(src, gx + 1, gz);
  const h01 = oldVertexHeightAt(src, gx, gz + 1);
  const h11 = oldVertexHeightAt(src, gx + 1, gz + 1);
  if (fx + fz <= 1) return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  return h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
}

// ============================================================
// Phase A：weld 模式逐位对照
// ============================================================
setEdgeCliffBand(-1); // 恒 weld = 旧世界

const SEEDS = [1, 2, 3];
const RANGE = 2; // chunk 坐标 -2..2（含跨 chunk 接缝）
let samples = 0;
let fails = 0;

for (const seed of SEEDS) {
  const src = makeSource(seed);
  for (let cx = -RANGE; cx <= RANGE; cx++) {
    for (let cz = -RANGE; cz <= RANGE; cz++) {
      // 采样：0.5m 网格 + 0.25 偏移（覆盖 cell 内部/边线/角点）+ 顶点整点
      for (let pass = 0; pass < 2; pass++) {
        const off = pass === 0 ? 0.25 : 0.0;
        for (let gz = 0; gz < CHUNK_SIZE; gz += 0.5) {
          for (let gx = 0; gx < CHUNK_SIZE; gx += 0.5) {
            const x = cx * CHUNK_SIZE + gx + off;
            const z = cz * CHUNK_SIZE + gz + off;
            const a = sampleSurface(src, x, z);
            const b = oldSurfaceHeightAt(src, x, z);
            samples++;
            if (a !== b) {
              if (fails < 10) {
                console.error(`weld 漂移 seed=${seed} (${x.toFixed(2)},${z.toFixed(2)}) ${a} → ${b}`);
              }
              fails++;
            }
          }
        }
      }
    }
  }
}

console.log(`[A] weld 逐位对照：${samples} 采样，漂移 ${fails}`);
if (fails > 0) {
  console.error('[A] 回归失败：weld 路径与旧公式不一致');
  process.exit(1);
}

// ============================================================
// Phase B：β 默认统计（cliff 边角色对分布 + 对称性/确定性）
// ============================================================
setEdgeCliffBand(null); // 默认 β

const pairCount = new Map<string, number>();
let cliffEdges = 0;
let totalEdges = 0;
let ruleFails = 0;

for (const seed of SEEDS) {
  const src = makeSource(seed);
  for (let cx = -RANGE; cx <= RANGE; cx++) {
    for (let cz = -RANGE; cz <= RANGE; cz++) {
      // 每 chunk 内部边 + 右/下边界边（dir 0=+x 2=+z 避免重复计）
      for (let bz = 0; bz < 15; bz++) {
        for (let bx = 0; bx < 15; bx++) {
          const wbx = cx * 15 + bx;
          const wbz = cz * 15 + bz;
          for (const dir of [0, 2] as const) {
            const info = edgeOf(src, wbx, wbz, dir);
            totalEdges++;
            // 对称性：换序裁决必须一致
            const a = src.blockAt(wbx, wbz)!;
            const b = src.blockAt(wbx + (dir === 0 ? 1 : 0), wbz + (dir === 2 ? 1 : 0))!;
            if (edgeRuling(a, b) !== edgeRuling(b, a)) ruleFails++;
            // 确定性：重算必须一致
            if (edgeRuling(a, b) !== info.ruling) ruleFails++;
            if (info.ruling === 'cliff') {
              cliffEdges++;
              const ra = tileById(info.high.id).genRole;
              const rb = tileById(info.low.id).genRole;
              const key = [ra, rb].sort().join('|');
              pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
            }
          }
        }
      }
    }
  }
}

console.log(`[B] β 统计：${totalEdges} 边中 cliff ${cliffEdges}（${(cliffEdges / totalEdges * 100).toFixed(1)}%）`);
for (const [k, v] of [...pairCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k}: ${v}`);
}
if (ruleFails > 0) {
  console.error(`[B] 回归失败：裁决规则违例 ${ruleFails}（对称性/确定性）`);
  process.exit(1);
}
console.log('[B] β 统计 + 对称性/确定性校验通过');

// ============================================================
// Phase C：自由选择（edgePolicy 覆盖 + 裁决带开关）
// ============================================================
{
  const vis = { baseHsl: { h: 0, s: 0, l: 0.5 }, jitter: { h: 0, s: 0, l: 0 }, depression: false };
  registerTile(new TileDef(90, 'reg_hard', '回归硬边', 'ground', vis, { height: 0, walkable: true, edgePolicy: 'hard' }));
  registerTile(new TileDef(91, 'reg_smooth', '回归平滑', 'ground', vis, { height: 5, walkable: true, edgePolicy: 'smooth' }));
  registerTile(new TileDef(92, 'reg_platform', '回归高台', 'platform', vis, { height: 5, walkable: true }));
  registerTile(new TileDef(93, 'reg_liquid', '回归水', 'liquid', vis, { height: -0.4, walkable: false }));
  registerTile(new TileDef(94, 'reg_pit', '回归坑', 'pit', vis, { height: -3, walkable: false }));
  const flat = (h: number): BlockInfo => ({ id: 0, h });
  const hard = (h: number): BlockInfo => ({ id: 90, h });
  const smooth = (h: number): BlockInfo => ({ id: 91, h });
  const plat = (h: number): BlockInfo => ({ id: 92, h });
  const liq = (h: number): BlockInfo => ({ id: 93, h });
  const pit = (h: number): BlockInfo => ({ id: 94, h });
  let cFails = 0;
  const expect = (name: string, got: string, want: string) => {
    if (got !== want) { console.error(`[C] ${name}: ${got} ≠ ${want}`); cFails++; }
  };
  // policy 覆盖 Δh：hard 地块与 5m 高差平地也 cliff；smooth 与任意邻块 weld
  expect('hard 覆盖大高差', edgeRuling(hard(0), flat(5)), 'cliff');
  expect('smooth 覆盖大高差', edgeRuling(smooth(5), flat(0)), 'weld');
  // hard 与 smooth 相遇：hard 胜（规则链位次 1 先于 1'）
  expect('hard>smooth', edgeRuling(hard(0), smooth(5)), 'cliff');
  // 位次 1.5 角色对规则：仅 ground↔ground 允许 β 判硬，其余一律 weld
  expect('地面同类走β', edgeRuling(flat(0), flat(0.1)), 'cliff');
  expect('高台同类weld', edgeRuling(plat(5), plat(5.2)), 'weld');
  expect('水同类weld', edgeRuling(liq(-0.4), liq(-0.1)), 'weld');
  expect('坑同类weld', edgeRuling(pit(-3), pit(-3.2)), 'weld');
  expect('跨类weld', edgeRuling(flat(0), plat(5)), 'weld');
  // policy 仍压过角色对（位次 1/1' 在 1.5 之前）
  expect('hard压角色对', edgeRuling(hard(0), plat(5)), 'cliff');
  expect('smooth压角色对', edgeRuling(smooth(0), plat(5)), 'weld');
  // β 开关：-1 = 恒 weld（旧世界应急回退），null = 恢复默认
  setEdgeCliffBand(-1);
  expect('开关恒weld', edgeRuling(flat(0), flat(0.1)), 'weld');
  setEdgeCliffBand(null);
  expect('恢复β', edgeRuling(flat(0), flat(0.1)), 'cliff');
  // 缺省地块（无 edgePolicy）不受影响
  expect('缺省走β', edgeRuling(flat(0), flat(2)), 'weld');
  if (cFails > 0) { console.error('[C] 回归失败：自由选择语义'); process.exit(1); }
  console.log('[C] edgePolicy 覆盖 + 角色对规则 + 裁决带开关校验通过');
}

// ============================================================
// Phase D：网格装配（ChunkSurface 逐 cell 对照 SurfaceRules 语义）
// ============================================================
{
  let dFails = 0;
  for (const seed of SEEDS) {
    const src = makeSource(seed);
    // 最小 RasterMap 形状（buildChunkTopSurface 只消费 worldSeed/ensureData/getChunkData）
    const fakeRaster = {
      worldSeed: seed,
      ensureData: (_cx: number, _cz: number) => { getChunk(seed, _cx, _cz); },
      getChunkData: (cx: number, cz: number): ChunkData | undefined => getChunk(seed, cx, cz),
    } as unknown as RasterMap;

    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const build = buildChunkTopSurface(fakeRaster, cx, cz);
        const pos = build.geometry.getAttribute('position');
        const uv = build.geometry.getAttribute('uv');
        const nor = build.geometry.getAttribute('normal');
        const idx = build.geometry.getIndex()!;
        // 物理缓冲与渲染几何必须同一份数据
        if (build.vertices !== pos.array as Float32Array || build.indices !== idx.array as Uint32Array) {
          console.error('[D] 物理/渲染缓冲不同源'); dFails++;
        }
        const N = CHUNK_SIZE;
        let vi = 0;
        for (let lz = 0; lz < N; lz++) {
          for (let lx = 0; lx < N; lx++) {
            const bx = cx * 15 + Math.floor(lx / 4);
            const bz = cz * 15 + Math.floor(lz / 4);
            const wx = cx * N + lx, wz = cz * N + lz;
            // 顶点顺序 c00 c10 c11 c01（构建器约定）
            const want = [
              cornerHeight(src, bx, bz, wx, wz),
              cornerHeight(src, bx, bz, wx + 1, wz),
              cornerHeight(src, bx, bz, wx + 1, wz + 1),
              cornerHeight(src, bx, bz, wx, wz + 1),
            ];
            for (let k = 0; k < 4; k++) {
              const got = pos.getY(vi + k); // 顶点已按 (x,y,z) 布局，y = 高度
              if (Math.abs(got - want[k]) > 1e-6) {
                if (dFails < 5) console.error(`[D] 角高漂移 seed=${seed} (${wx},${wz}) v${k} ${got} ≠ ${want[k]}`);
                dFails++;
              }
              if (nor.getY(vi + k) !== 1 || nor.getX(vi + k) !== 0 || nor.getZ(vi + k) !== 0) {
                if (dFails < 5) console.error('[D] 法线非 +Y'); dFails++;
              }
            }
            // UV 与旧映射逐位同式：u=lx/60, v=lz/60（顶点序 c00 c10 c11 c01）
            const cellUV: [number, number][] = [
              [lx / N, lz / N], [(lx + 1) / N, lz / N],
              [(lx + 1) / N, (lz + 1) / N], [lx / N, (lz + 1) / N],
            ];
            for (let k = 0; k < 4; k++) {
              if (Math.abs(uv.getX(vi + k) - cellUV[k][0]) > 1e-6
                || Math.abs(uv.getY(vi + k) - cellUV[k][1]) > 1e-6) {
                if (dFails < 5) console.error('[D] UV 漂移'); dFails++;
              }
            }
            // 索引：T1=△(c00,c01,c10) T2=△(c01,c11,c10)
            const wantIdx = [vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1];
            for (let k = 0; k < 6; k++) {
              if (idx.getX(lz * N * 6 + lx * 6 + k) !== wantIdx[k]) {
                if (dFails < 5) console.error('[D] 索引剖分漂移（对角线约定破坏）'); dFails++;
              }
            }
            vi += 4;
          }
        }
      }
    }
  }
  if (dFails > 0) { console.error(`[D] 回归失败：网格装配违例 ${dFails}`); process.exit(1); }
  console.log('[D] ChunkSurface 网格装配对照通过（渲染=查询同源）');
}

// ============================================================
// Phase E：快照一致（Worker 烘焙源 vs 主线程块源逐位对照）
// ============================================================
{
  let eFails = 0;
  let eSamples = 0;
  for (const seed of SEEDS) {
    const rasterSrc = makeSource(seed);
    const fetchChunk = (cx: number, cz: number): ChunkData | undefined => getChunk(seed, cx, cz);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const snap = buildSnapshotFromChunks(seed, cx, cz, fetchChunk);
        const q = makeSnapshotSource(snap);
        // 覆盖 chunk ±8m（烘焙射线最远 16m 也在 22m 余量内；±8m 已含裁决带边界）
        for (let gz = -8; gz < CHUNK_SIZE + 8; gz += 0.5) {
          for (let gx = -8; gx < CHUNK_SIZE + 8; gx += 0.5) {
            const x = cx * CHUNK_SIZE + gx + 0.25;
            const z = cz * CHUNK_SIZE + gz + 0.25;
            const a = q.surfaceHeightAt(x, z);
            const b = sampleSurface(rasterSrc, x, z);
            eSamples++;
            if (a !== b) {
              if (eFails < 5) console.error(`[E] 快照漂移 seed=${seed} (${x.toFixed(2)},${z.toFixed(2)}) ${a} ≠ ${b}`);
              eFails++;
            }
          }
        }
      }
    }
  }
  if (eFails > 0) { console.error(`[E] 回归失败：快照与主线程不一致 ${eFails}`); process.exit(1); }
  console.log(`[E] 快照一致性通过（${eSamples} 采样逐位一致）`);
}

// ============================================================
// Phase F：角点许可（cornerHeight 插值许可语义）
//   两边皆 weld → max（插值）；任一边段 cliff → 自持（硬边直达角点）
// ============================================================
{
  // 手工 2×2 块场景（块坐标 (0..1)²；测内部顶点 (4,4) 与边内顶点 (4,2)）
  let fFails = 0;
  const expectNum = (name: string, got: number, want: number) => {
    if (Math.abs(got - want) > 1e-9) { console.error(`[F] ${name}: ${got} ≠ ${want}`); fFails++; }
  };
  const fixture = (blocks: Record<string, BlockInfo>): BlockSource => ({
    blockAt: (bx: number, bz: number): BlockInfo | undefined => blocks[`${bx},${bz}`],
  });
  const flat = (h: number): BlockInfo => ({ id: 0, h });
  const liq = (h: number): BlockInfo => ({ id: 93, h });
  const plat = (h: number): BlockInfo => ({ id: 92, h });

  // ① 全硬角（四块皆 ground 互为 cliff）→ 各自自持，零插值
  {
    const src = fixture({ '0,0': flat(0.2), '1,0': flat(0.05), '0,1': flat(0.15), '1,1': flat(0.1) });
    expectNum('全硬角 自持(1,0)', cornerHeight(src, 1, 0, 4, 4), 0.05);
    expectNum('全硬角 自持(0,1)', cornerHeight(src, 0, 1, 4, 4), 0.15);
    expectNum('全硬角 自持(1,1)', cornerHeight(src, 1, 1, 4, 4), 0.1);
  }
  // ② 岸线混合角：水(00)-地(10) weld + 地(10)-地(11) cliff
  //    → 地块一边硬一边坡 → 自持；水块两边皆 weld → max（坡道满高到角）
  {
    const src = fixture({ '0,0': liq(-0.4), '1,0': flat(0.2), '0,1': liq(-0.35), '1,1': flat(0.1) });
    expectNum('混合角 地自持', cornerHeight(src, 1, 0, 4, 4), 0.2);
    expectNum('混合角 水插值', cornerHeight(src, 0, 0, 4, 4), 0.2);
  }
  // ③ 全 weld 角（开阔水面）→ 恒 max ≡ 旧公式
  {
    const src = fixture({ '0,0': liq(-0.4), '1,0': liq(-0.1), '0,1': liq(-0.3), '1,1': liq(-0.25) });
    expectNum('全weld角 max', cornerHeight(src, 0, 0, 4, 4), Math.max(-0.4, -0.1, -0.3, -0.25));
  }
  // ④ cliff 边内部顶点：边段皆 cliff → 双方自持（边身纯硬，低侧不被拉高）
  {
    const src = fixture({ '0,0': flat(0.2), '1,0': flat(0.05), '0,1': flat(0.2), '1,1': flat(0.05) });
    expectNum('cliff边内顶点 低侧自持', cornerHeight(src, 1, 0, 4, 2), 0.05);
    expectNum('cliff边内顶点 高侧自持', cornerHeight(src, 0, 0, 4, 2), 0.2);
  }
  // ⑤ weld 边内部顶点：边段皆 weld → 低侧拉到高侧（weld 边全程连续）
  {
    const src = fixture({ '0,0': liq(-0.4), '1,0': flat(0.2), '0,1': liq(-0.4), '1,1': flat(0.2) });
    expectNum('weld边内顶点 低侧拉高', cornerHeight(src, 0, 0, 4, 2), 0.2);
    expectNum('weld边内顶点 高侧持平', cornerHeight(src, 1, 0, 4, 2), 0.2);
  }
  // ⑥ 对角高台：混合角地块自持、不被对角高块拉飞（已知边界情况：
  //    weld 侧水块被拉至高台高 → 端点错位缝隙，无墙 weld 边会暴露，见文档 §3.2 ⚠️）
  {
    const src = fixture({ '0,0': flat(0.05), '1,0': liq(-0.4), '0,1': flat(0.2), '1,1': plat(5) });
    expectNum('混合角 不吃对角高块', cornerHeight(src, 0, 0, 4, 4), 0.05);
  }
  if (fFails > 0) { console.error('[F] 回归失败：角点许可语义'); process.exit(1); }
  console.log('[F] 角点插值许可校验通过（两边皆 weld 才插值）');
}

// ============================================================
// Phase G：精修执行器（edgeFinal 唯一判点 + 空精修恒透传）
//   ① 默认引擎 ↔ 显式覆写 ↔ inherit 回落语义；
//   ② refine() 空精修恒透传 ≡ 默认引擎（第五铁律：对外纯净）。
// ============================================================
{
  let gFails = 0;
  const expectR = (name: string, got: unknown, want: unknown) => {
    if (got !== want) { console.error(`[G] ${name}: ${got} ≠ ${want}`); gFails++; }
  };
  // 手工 2×2 场景：块(0,0) 邻 +x(1,0) 高0.1（默认 cliff）；邻 +z(0,1) 高5（默认 weld）
  const gsrc: BlockSource = {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (bx === 0 && bz === 0) return { id: 0, h: 0 };
      if (bx === 1 && bz === 0) return { id: 0, h: 0.1 };
      if (bx === 0 && bz === 1) return { id: 0, h: 5 };
      return undefined;
    },
  };
  // ① 默认引擎
  expectR('[G] 默认 +x', finalRuling(gsrc, 0, 0, 0), 'cliff');
  expectR('[G] 默认 +z', finalRuling(gsrc, 0, 0, 2), 'weld');
  // ② 显式覆写
  let gref = overrideEdge(EMPTY_REFINEMENTS, 0, 0, 0, 'weld');
  gref = overrideEdge(gref, 0, 0, 2, 'cliff');
  const gsrcR = refine(gsrc, gref);
  expectR('[G] 覆写 +x→weld', finalRuling(gsrcR, 0, 0, 0), 'weld');
  expectR('[G] 覆写 +z→cliff', finalRuling(gsrcR, 0, 0, 2), 'cliff');
  // ③ inherit 回落
  const gref2 = overrideEdge(gref, 0, 0, 0, 'inherit');
  const gsrcR2 = refine(gsrc, gref2);
  expectR('[G] inherit +x 回落', finalRuling(gsrcR2, 0, 0, 0), 'cliff');
  expectR('[G] +z 仍覆写', finalRuling(gsrcR2, 0, 0, 2), 'cliff');
  // ④ 空精修恒透传
  const gsrcE = refine(gsrc, EMPTY_REFINEMENTS);
  expectR('[G] 空精修 +x', finalRuling(gsrcE, 0, 0, 0), finalRuling(gsrc, 0, 0, 0));
  expectR('[G] 空精修 +z', finalRuling(gsrcE, 0, 0, 2), finalRuling(gsrc, 0, 0, 2));
  if (gFails > 0) { console.error('[G] 回归失败：edgeFinal 唯一判点语义'); process.exit(1); }
  console.log('[G] edgeFinal 唯一判点校验通过（默认/覆写/inherit/空透传）');
}

// ============================================================
// Phase H：hBase 双语义 + 悬空补墙（weld 低侧面板底更深 → 补墙，防坡面悬空）
//   ① baseHeightOf 缺省 = h（空精修 ≡ 旧世界）；
//   ② weldGap 判定：默认 → 与旧 weld 门槛逐位一致；低侧 hBase 更深 → 需补墙；
//   ③ 补墙底部 = baseHeightOf(低侧)（不漏空，非仅视觉高）。
// ============================================================
{
  let hFails = 0;
  const expectH = (name: string, got: number | boolean, want: number | boolean) => {
    if (got !== want) { console.error(`[H] ${name}: ${got} ≠ ${want}`); hFails++; }
  };
  const MIN_DROP = 0.5;
  // 高侧块 (0,0) h=4（ground,id0）；低侧块 (1,0)。Δh 大 → 默认边裁决 weld。
  const mk = (h: number, hBase?: number): BlockInfo => ({ id: 0, h, ...(hBase !== undefined ? { hBase } : {}) });
  const hsrc = (low: BlockInfo): BlockSource => ({
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (bx === 0 && bz === 0) return mk(4);
      if (bx === 1 && bz === 0) return low;
      return undefined;
    },
  });

  // ① baseHeightOf 缺省 = h
  expectH('[H] baseHeightOf 缺省=h', baseHeightOf(mk(3)), 3);
  expectH('[H] baseHeightOf 显式', baseHeightOf(mk(3, 1.2)), 1.2);

  // ② weld 大落差边（低侧 raw h=0.1，缺省 hBase=0.1）→ 需墙、墙底=hBase(=h)、顶=高侧
  {
    const g = weldGap(hsrc(mk(0.1)), 0, 0, 0, MIN_DROP);
    expectH('[H] weld 需墙', g.needed, true);
    expectH('[H] 墙底=hBase(=h)', Number(g.bottom.toFixed(3)), 0.1);
    expectH('[H] 墙顶=高侧h', g.top, 4);
  }
  // ③ 低侧面板底更深（hBase=-3）→ 墙底延伸到 hBase（补住坡面下方的窟窿，非仅视觉低）
  {
    const g = weldGap(hsrc(mk(0.1, -3)), 0, 0, 0, MIN_DROP);
    expectH('[H] 深面板底 需墙', g.needed, true);
    expectH('[H] 墙底=深hBase', Number(g.bottom.toFixed(3)), -3);
    expectH('[H] 墙顶仍=高侧h', g.top, 4);
  }
  // ④ 墙底恒取 baseHeightOf(低侧)：不设置 hBase 时 == low.h（空精修≡旧世界逐位）
  {
    const g = weldGap(hsrc(mk(0.1)), 0, 0, 0, MIN_DROP);
    expectH('[H] 缺省底=低侧h', g.bottom, 0.1);
  }
  if (hFails > 0) { console.error('[H] 回归失败：hBase/悬空补墙'); process.exit(1); }
  console.log('[H] hBase 双语义 + 悬空补墙判定通过（缺省=h，面板底深→补到深底）');
}

// ============================================================
// Phase I：精修高度补丁 + 确定性侵蚀（setHeight/refine/carveGradientErosion）
//   ① refine 应用高度/底高补丁；空精修恒透传原对象（不变式）；
//   ② 侵蚀确定性：同 seed → 同磁盘；克制：块数 ≤ maxBlocks、深度 ≤ maxDepth；
//   ③ 补丁 h 与 hBase 同降 → baseHeightOf 跟随（不悬空）。
// ============================================================
{
  let iFails = 0;
  const expectI = (name: string, got: unknown, want: unknown) => {
    if (got !== want) { console.error(`[I] ${name}: ${got} ≠ ${want}`); iFails++; }
  };
  const isrc = (h: number): BlockSource => ({
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (bx >= -2 && bx <= 2 && bz >= -2 && bz <= 2) return { id: 0, h };
      return undefined;
    },
  });

  // ① 空精修恒透传（返回同一源对象）
  const emptySrc = isrc(1);
  expectI('[I] 空精修透传', refine(emptySrc, EMPTY_REFINEMENTS) === emptySrc, true);

  // ① 高度补丁：h 改写 + 底高缺省 = h
  const ref1 = setHeight(EMPTY_REFINEMENTS, 1, 1, 5);
  const src1 = refine(isrc(0.5), ref1);
  expectI('[I] setHeight 改 h', src1.blockAt(1, 1)!.h, 5);
  expectI('[I] setHeight 底高缺省=h', baseHeightOf(src1.blockAt(1, 1)!), 5);
  expectI('[I] 未补丁块不变', src1.blockAt(2, 2)!.h, 0.5);

  // ① 显式底高
  const ref2 = setHeight(EMPTY_REFINEMENTS, 1, 1, 5, -2);
  expectI('[I] setHeight 显式底高', refine(isrc(0.5), ref2).blockAt(1, 1)!.hBase, -2);

  // ② 侵蚀确定性 + 克制（用有低洼梯度的读出，确保真的切出连续沟壑）
  const grad: BlockSource = {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (Math.abs(bx) > 24 || Math.abs(bz) > 24) return undefined;
      const d = Math.abs(bx) + Math.abs(bz); // 菱形低洼：越靠近心越低
      return { id: 0, h: 3 - d * 0.1 };
    },
  };
  const reader = grad.blockAt.bind(grad);
  const resA = carveGradientErosion(777, reader, { maxBlocks: 20, maxDepth: 0.5, maxSteps: 6 });
  const resB = carveGradientErosion(777, reader, { maxBlocks: 20, maxDepth: 0.5, maxSteps: 6 });
  expectI('[I] 侵蚀确定性', resA.heights.size, resB.heights.size);
  expectI('[I] 侵蚀确实切出(patch>0)', resA.heights.size > 0, true);
  expectI('[I] 侵蚀块数克制≤上限', resA.heights.size <= 20, true);
  for (const [, p] of resA.heights) {
    if (p.hBase === undefined || p.h - p.hBase > 1e-9) { console.error('[I] 侵蚀 h/hBase 未同降'); iFails++; break; }
  }
  // ③ 侵蚀结果经 refine 生效（h 与 hBase 同降，baseHeightOf 跟随）
  const srcE = refine(grad, resA);
  let applied = 0;
  for (const [key, p] of resA.heights) {
    const b = srcE.blockAt(p.bx, p.bz)!;
    if (b.h === p.h && b.hBase === p.hBase) applied++;
  }
  expectI('[I] 侵蚀补丁全部生效', applied, resA.heights.size);
  if (iFails > 0) { console.error('[I] 回归失败：高度补丁/侵蚀'); process.exit(1); }
  console.log(`[I] 高度补丁 + 确定性侵蚀通过（补丁${resA.heights.size}块·克制）`);
}

console.log('[surface-regression] 全部通过');
