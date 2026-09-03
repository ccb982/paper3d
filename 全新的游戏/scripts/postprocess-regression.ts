// ============================================================
// postprocess-regression —— 精修层后处理回归（设计稿《精修层后处理设计.md》§7）
// ============================================================
// 用法：
//   npx tsx scripts/postprocess-regression.ts   （exit 1 = 回归失败）
//
// 契约（A–I，随 POST_PROCESS_ENABLED 分支）：
//   A  空后处理 ≡ 原世界：总开关关 → ppSurfaceHeight ≡ sampleSurface 逐位
//   B  确定性幂等：同 seed 同点，ppSurfaceHeight / ppHeight 逐位一致
//   C  烘焙=渲染细：bakeSnapshotSource.surfaceHeightAt ≡ ppSurfaceHeight（重放同源）
//   D  t-junction 水密（渲染版细分骨架：暂无细分 → 退化占位）
//   E  物理粗自洽（渲染版细分后跑：可踩不穿不悬空）
//   F  圆滑不与 weld 坡重复
//   G  水/坑底不被挖·不圆滑
//   H  改墙/裁决后自洽（无悬空墙）
//   I  替换后渲染用渲染版、物理用物理版（两套不打架）
//
// 阶段：
//   A、B、C：无论总开关开/关都必绿（证明后处理同源且不破坏原世界）。
//   D–I：细分/替换实现后启用（当前总开关默认关 → 其前置条件不成立，标记 skip）。
// ============================================================
import { generateChunk, CHUNK_SIZE, type ChunkData } from "../src/services/map/ChunkGenerator";
import {
  sampleSurface,
  refineChunkSource,
  type BlockSource,
  type BlockInfo,
} from "../src/services/map/Refinements";
import {
  ppSurfaceHeight,
  ppHeight,
} from "../src/services/map/RefinementPostProcess";
import { POST_PROCESS_ENABLED } from "../src/services/map/RefinementPostProcessConfig";
import {
  buildSnapshotFromChunks,
  makeSnapshotSource,
} from "../src/services/map/bakeCompute";

declare const process: { exit(code: number): void };

// ---- chunk 缓存（per seed）----
const cache = new Map<string, ChunkData>();
function getChunk(seed: number, cx: number, cz: number): ChunkData {
  const key = `${seed}:${cx}:${cz}`;
  let c = cache.get(key);
  if (!c) {
    c = generateChunk(seed, cx, cz);
    cache.set(key, c);
  }
  return c;
}

function makeSource(seed: number): BlockSource {
  return {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      const mx = bx * 4,
        mz = bz * 4;
      const cx = Math.floor(mx / CHUNK_SIZE);
      const cz = Math.floor(mz / CHUNK_SIZE);
      const c = getChunk(seed, cx, cz);
      const lx = mx - cx * CHUNK_SIZE;
      const lz = mz - cz * CHUNK_SIZE;
      const bi = (lz / 4) * 15 + lx / 4;
      return {
        id: c.blockTypes[bi] ?? 0,
        h: c.heights[lz * CHUNK_SIZE + lx] ?? 0,
      };
    },
  };
}

const SEEDS = [11, 22, 33];
const RANGE = 2;

// ============================================================
// Phase A：空后处理 ≡ 原世界（逐位对照 ppSurfaceHeight vs sampleSurface）
// ============================================================
{
  let aFails = 0;
  let aSamples = 0;
  for (const seed of SEEDS) {
    const src = makeSource(seed);
    const x0 = -RANGE * CHUNK_SIZE,
      x1 = (RANGE + 1) * CHUNK_SIZE;
    for (let z = x0; z < x1; z += 0.25) {
      for (let x = x0; x < x1; x += 0.25) {
        const pp = ppSurfaceHeight(x, z, seed, src);
        const sm = sampleSurface(src, x, z);
        aSamples++;
        if (pp !== sm) {
          if (aFails < 5)
            console.error(`[A] 漂移 seed=${seed} (${x},${z}) pp=${pp} sm=${sm}`);
          aFails++;
        }
      }
    }
  }
  console.log(`[A] 空后处理≡原世界：${aSamples} 采样，漂移 ${aFails}`);
  if (aFails > 0 || aSamples === 0) {
    console.error("[A] 回归失败：后处理未开启时改变了原世界");
    process.exit(1);
  }
}

// ============================================================
// Phase B：确定性幂等（ppHeight / ppSurfaceHeight 重算逐位一致）
// ============================================================
{
  let bFails = 0;
  let bSamples = 0;
  for (const seed of SEEDS) {
    const src = makeSource(seed);
    const x0 = -RANGE * CHUNK_SIZE,
      x1 = (RANGE + 1) * CHUNK_SIZE;
    for (let z = x0; z < x1; z += 0.5) {
      for (let x = x0; x < x1; x += 0.5) {
        const p1 = ppHeight(x, z, seed, src);
        const p2 = ppHeight(x, z, seed, src);
        const s1 = ppSurfaceHeight(x, z, seed, src);
        const s2 = ppSurfaceHeight(x, z, seed, src);
        bSamples++;
        if (p1 !== p2 || s1 !== s2) bFails++;
      }
    }
  }
  console.log(`[B] 确定性幂等：${bSamples} 采样重算一致`);
  if (bFails > 0) {
    console.error("[B] 回归失败：同 seed 同点结果不一致");
    process.exit(1);
  }
}

// ============================================================
// Phase C：烘焙=渲染细（makeSnapshotSource.surfaceHeightAt ≡ ppSurfaceHeight）
// ============================================================
{
  let cFails = 0;
  let cSamples = 0;
  for (const seed of SEEDS) {
    const fetchChunk = (cx: number, cz: number): ChunkData | undefined =>
      getChunk(seed, cx, cz);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const snap = buildSnapshotFromChunks(seed, cx, cz, fetchChunk);
        const q = makeSnapshotSource(snap);
        const rawSrc = makeSource(seed);
        // 主线程参照 = 与 Worker 同源的 per-chunk 精修源（同 surfaceHeightAt 实装）
        const refCache = new Map<string, BlockSource>();
        const mainRef = (ccx: number, ccz: number): BlockSource => {
          const k = `${ccx},${ccz}`;
          let r = refCache.get(k);
          if (!r) {
            r = refineChunkSource(rawSrc, seed, ccx, ccz);
            refCache.set(k, r);
          }
          return r;
        };
        for (let gz = -4; gz < CHUNK_SIZE + 4; gz += 0.5) {
          for (let gx = -4; gx < CHUNK_SIZE + 4; gx += 0.5) {
            const x = cx * CHUNK_SIZE + gx + 0.25;
            const z = cz * CHUNK_SIZE + gz + 0.25;
            const bake = q.surfaceHeightAt(x, z);
            const ccx = Math.floor(x / CHUNK_SIZE);
            const ccz = Math.floor(z / CHUNK_SIZE);
            const pp = ppSurfaceHeight(x, z, seed, mainRef(ccx, ccz));
            cSamples++;
            if (bake !== pp) {
              if (cFails < 5)
                console.error(
                  `[C] 烘焙≠后处理 seed=${seed} (${x},${z}) bake=${bake} pp=${pp}`,
                );
              cFails++;
            }
          }
        }
      }
    }
  }
  console.log(`[C] 烘焙=渲染细同源：${cSamples} 采样一致`);
  if (cFails > 0) {
    console.error("[C] 回归失败：Worker 烘焙抽样与后处理最终面不一致");
    process.exit(1);
  }
}

// ============================================================
// Phase D–I：细分/物理/替换实现后启用；当前总开关默认关 → 其前置不成立，标记 skip
// ============================================================
console.log(
  `[D–I] 细分替换阶段：POST_PROCESS_ENABLED=${POST_PROCESS_ENABLED}，实现后启用`,
);

console.log("[postprocess-regression] 全部通过");
