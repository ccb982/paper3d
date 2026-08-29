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
// ============================================================
import {
  generateChunk, CHUNK_SIZE,
  type ChunkData,
} from '../src/services/map/ChunkGenerator';
import {
  sampleSurface, edgeRuling, edgeOf, setEdgeCliffBand,
  cornerHeight,
  type BlockSource, type BlockInfo,
} from '../src/services/map/SurfaceRules';
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

console.log('[surface-regression] 全部通过');
