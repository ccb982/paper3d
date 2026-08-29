// ============================================================
// surface-regression —— 视觉面重构回归（SurfaceRules 对照旧公式）
// ============================================================
// 用法：
//   weld 逐位对照 + β 统计：  npx tsx scripts/surface-regression.ts
//   （exit 1 = 回归失败）
//
// 两阶段：
//   A（weld 对照）：setEdgeCliffBand(-1) → 恒 weld = 旧世界。
//      sampleSurface 必须与旧公式（2×2 max + 三角形插值）【逐位一致】——
//      收敛三处重复实现的正确性证明。
//   B（β 统计）：恢复默认裁决带，统计 cliff 边按角色对分布（人工抽查
//      观感用）；并校验裁决对称性/确定性。
// ============================================================
import {
  generateChunk, CHUNK_SIZE,
  type ChunkData,
} from '../src/services/map/ChunkGenerator';
import {
  sampleSurface, edgeRuling, edgeOf, setEdgeCliffBand,
  type BlockSource, type BlockInfo,
} from '../src/services/map/SurfaceRules';
import { tileById } from '../src/services/map/Tiles';

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
console.log('[surface-regression] 通过');
