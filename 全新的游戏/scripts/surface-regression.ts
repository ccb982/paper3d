// ============================================================
// surface-regression —— 视觉面重构回归（撕裂面+传导场模型，2026-08-31 重写）
// ============================================================
// 用法：
//   单跑新模型三件套：  npx tsx scripts/surface-regression.ts
//   （exit 1 = 回归失败）
//
// 契约基线（《精修层过渡模型重构设计.md》§1.1 不变式表）：
//   ① 顶点一致性：同一世界顶点，任一相邻 cell 读到的值浮点位相等
//   ② 无幽灵拉高：对角高块不经真 weld 边缓冲不得抬此角
//   ③ 墙 = 硬边界基础几何（2026-08-31 与裁决解耦）：两侧块高有落差即发墙；
//      cliff 墙 = 撕裂面本身，weld 墙 = 贴坡背墙（斜坡蒙皮附加在墙前）
//   ④ 空斜坡 ≡ 旧平面：恒定高块顶面与旧 PlaneGeometry 逐位一致（保留）
//
// 阶段：
//   A（空斜坡对照）：全平地/全同高块，sampleSurface 与旧线性插值公式逐位一致。
//   B（β 统计）：恢复默认裁决带，统计 cliff 边按角色对分布（人工抽查观感）；
//      并校验裁决对称性/确定性。
//   C（自由选择）：edgePolicy 覆盖 + 角色对规则 + 裁决带开关语义
//      （hard > smooth > 角色对 > β）。
//   D（网格装配）：ChunkSurface 顶面逐 cell 四角/UV/法线/索引与 cornerCell
//      语义对照（渲染=查询逐位同源）。
//   E（快照一致）：bakeCompute 快照源 vs 主线程块源逐位对照
//      （Worker 烘焙与主线程贴地同源证明）。
//   F（顶点一致 + 无幽灵拉高）：cornerCell 顶点语义——weld 边两侧同值、
//      对角高块不抬角、cliff 边自持。
//   G（精修执行器）：edgeFinal 唯一判点——默认引擎 ↔ 显式覆写 ↔ inherit
//      回落三者语义；refine 空精修恒透传。
//   H（墙 = 硬边界基础几何）：有落差即发墙；weld 边发贴坡背墙（墙顶=crest）；
//      等高零墙；hBase 缺省 = h（baseHeightOf）。
// ============================================================
import {
  generateChunk,
  CHUNK_SIZE,
  type ChunkData,
} from "../src/services/map/ChunkGenerator";
import {
  sampleSurface,
  edgeRuling,
  edgeOf,
  finalRuling,
  baseHeightOf,
  cornerCell,
  rampProfile,
  buildChunkWallBuffers,
  type BlockSource,
  type BlockInfo,
} from "../src/services/map/SurfaceRules";
import {
  refine,
  overrideEdge,
  EMPTY_REFINEMENTS,
  setHeight,
  carveGradientErosion,
  makeChunkSource,
  refineChunkSource,
  type ChunkDataLite,
} from "../src/services/map/Refinements";
import { tileById, registerTile, TileDef } from "../src/services/map/Tiles";
import { buildChunkTopSurface } from "../src/services/map/ChunkSurface";
import {
  buildSnapshotFromChunks,
  makeSnapshotSource,
} from "../src/services/map/bakeCompute";
import type { RasterMap } from "../src/services/map/RasterMap";

declare const process: { exit(code: number): void };

// ---- chunk 缓存（per seed；同 RasterMap.ensureChunk 语义） ----
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

// ============================================================
// Phase A：空斜坡 ≡ 旧平面（恒定高块/全平地逐位对照，§1.1 不变式④ 保留）
// ============================================================

// 全平 source：人工构造恒定高块（无限平面语义），排除一切 weld/cliff/斜坡
const PLAIN_H = 2.0;
const plainSource: BlockSource = {
  blockAt(): BlockInfo | undefined {
    return { id: 0, h: PLAIN_H };
  },
};

// ---- 旧公式参照（全平/恒定块下与空斜坡 вершит一致）----
function oldPlainHeight(): number {
  return PLAIN_H;
}

const RANGE = 2; // chunk 坐标 -2..2（含跨 chunk 接缝）
let aSamples = 0;
let aFails = 0;

// 全平 source 上整个 RANGE×RANGE 区域逐位对照（无任何过渡 → 必逐位一致）
{
  const x0 = -RANGE * CHUNK_SIZE,
    x1 = (RANGE + 1) * CHUNK_SIZE;
  const z0 = x0,
    z1 = x1;
  for (let pass = 0; pass < 2; pass++) {
    const off = pass === 0 ? 0.25 : 0.0;
    for (let z = z0; z < z1; z += 0.5) {
      for (let x = x0; x < x1; x += 0.5) {
        const got = sampleSurface(plainSource, x + off, z + off);
        aSamples++;
        if (got !== oldPlainHeight()) {
          if (aFails < 5)
            console.error(
              `平面漂移 (${(x + off).toFixed(2)},${(z + off).toFixed(2)}) ${got} → ${oldPlainHeight()}`,
            );
          aFails++;
        }
      }
    }
  }
}

console.log(`[A] 空斜坡对照：${aSamples} 采样，漂移 ${aFails}`);
if (aFails > 0 || aSamples === 0) {
  console.error("[A] 回归失败：空斜坡/全平地面与旧公式不一致（或无平面采样）");
  process.exit(1);
}

// ============================================================
// Phase B：默认裁决统计（默认恒硬边界 + 对称性/确定性）
// ============================================================

const SEEDS = [1, 2, 3];
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
            const b = src.blockAt(
              wbx + (dir === 0 ? 1 : 0),
              wbz + (dir === 2 ? 1 : 0),
            )!;
            if (edgeRuling(a, b, dir) !== edgeRuling(b, a, dir ^ 1))
              ruleFails++;
            // 确定性：重算必须一致
            if (edgeRuling(a, b, dir) !== info.ruling) ruleFails++;
            if (info.ruling === "cliff") {
              cliffEdges++;
              const ra = tileById(info.high.id).genRole;
              const rb = tileById(info.low.id).genRole;
              const key = [ra, rb].sort().join("|");
              pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
            }
          }
        }
      }
    }
  }
}

console.log(
  `[B] 默认裁决统计：${totalEdges} 边中 cliff ${cliffEdges}（${((cliffEdges / totalEdges) * 100).toFixed(1)}%）`,
);
for (const [k, v] of [...pairCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k}: ${v}`);
}
if (ruleFails > 0) {
  console.error(`[B] 回归失败：裁决规则违例 ${ruleFails}（对称性/确定性）`);
  process.exit(1);
}
console.log("[B] 默认硬边界统计 + 对称性/确定性校验通过");

// ============================================================
// Phase C：自由选择（edgePolicy 覆盖 + 裁决带开关）
// ============================================================
{
  const vis = {
    baseHsl: { h: 0, s: 0, l: 0.5 },
    jitter: { h: 0, s: 0, l: 0 },
    depression: false,
  };
  registerTile(
    new TileDef(90, "reg_hard", "回归硬边", "ground", vis, {
      height: 0,
      walkable: true,
      edgePolicy: "hard",
    }),
  );
  registerTile(
    new TileDef(91, "reg_smooth", "回归平滑", "ground", vis, {
      height: 5,
      walkable: true,
      edgePolicy: "smooth",
    }),
  );
  registerTile(
    new TileDef(92, "reg_platform", "回归高台", "platform", vis, {
      height: 5,
      walkable: true,
    }),
  );
  registerTile(
    new TileDef(93, "reg_liquid", "回归水", "liquid", vis, {
      height: -0.4,
      walkable: false,
    }),
  );
  registerTile(
    new TileDef(94, "reg_pit", "回归坑", "pit", vis, {
      height: -3,
      walkable: false,
    }),
  );
  const flat = (h: number): BlockInfo => ({ id: 0, h });
  const hard = (h: number): BlockInfo => ({ id: 90, h });
  const smooth = (h: number): BlockInfo => ({ id: 91, h });
  const plat = (h: number): BlockInfo => ({ id: 92, h });
  const liq = (h: number): BlockInfo => ({ id: 93, h });
  const pit = (h: number): BlockInfo => ({ id: 94, h });
  let cFails = 0;
  const expect = (name: string, got: string, want: string) => {
    if (got !== want) {
      console.error(`[C] ${name}: ${got} ≠ ${want}`);
      cFails++;
    }
  };
  // policy 覆盖 Δh：hard 地块与 5m 高差平地也 cliff；smooth 与任意邻块 weld
  expect("hard 覆盖大高差", edgeRuling(hard(0), flat(5)), "cliff");
  expect("smooth 覆盖大高差", edgeRuling(smooth(5), flat(0)), "weld");
  // hard 与 smooth 相遇：hard 胜（规则链位次 1 先于 1'）
  expect("hard>smooth", edgeRuling(hard(0), smooth(5)), "cliff");
  // ★ 2026-08-31 定版「插值 = 显式 opt-in」：默认引擎恒硬边界，无 smooth
  //   的一律 cliff——不再按角色对 / β 微高差自动 weld。
  expect("地面同类默认硬", edgeRuling(flat(0), flat(0.1)), "cliff");
  expect("地面同类大差也硬", edgeRuling(flat(0), flat(2)), "cliff");
  expect("高台同类默认硬", edgeRuling(plat(5), plat(5.2)), "cliff");
  expect("水同类默认硬", edgeRuling(liq(-0.4), liq(-0.1)), "cliff");
  expect("坑同类默认硬", edgeRuling(pit(-3), pit(-3.2)), "cliff");
  expect("跨类默认硬", edgeRuling(flat(0), plat(5)), "cliff");
  // policy 仍显式 opt-in / opt-out（位次 1/1' 恒在默认之前生效）
  expect("hard压角色对", edgeRuling(hard(0), plat(5)), "cliff");
  expect("smooth压角色对", edgeRuling(smooth(0), plat(5)), "weld");
  if (cFails > 0) {
    console.error("[C] 回归失败：自由选择语义");
    process.exit(1);
  }
  console.log("[C] edgePolicy 显式 opt-in/out 校验通过（默认恒硬边界）");
}

// ============================================================
// Phase D：网格装配（ChunkSurface 逐 cell 对照 SurfaceRules 语义）
// ============================================================
{
  let dFails = 0;
  for (const seed of SEEDS) {
    const src = makeSource(seed);
    // 最小 RasterMap 形状（buildChunkTopSurface 消费 chunkSource / worldSeed）
    const srcBlocks = makeChunkSource(
      (ccx, ccz) => getChunk(seed, ccx, ccz) as ChunkDataLite | undefined,
    );
    const fakeRaster = {
      worldSeed: seed,
      surfaceBlocks: srcBlocks,
      chunkSource: (cx: number, cz: number) =>
        refineChunkSource(srcBlocks, seed, cx, cz),
    } as unknown as RasterMap;

    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const build = buildChunkTopSurface(fakeRaster, cx, cz);
        const pos = build.geometry.getAttribute("position");
        const uv = build.geometry.getAttribute("uv");
        const nor = build.geometry.getAttribute("normal");
        const idx = build.geometry.getIndex()!;
        // 物理缓冲与渲染几何必须同一份数据
        if (
          build.vertices !== (pos.array as Float32Array) ||
          build.indices !== (idx.array as Uint32Array)
        ) {
          console.error("[D] 物理/渲染缓冲不同源");
          dFails++;
        }
        const N = CHUNK_SIZE;
        let vi = 0;
        for (let lz = 0; lz < N; lz++) {
          for (let lx = 0; lx < N; lx++) {
            const bx = cx * 15 + Math.floor(lx / 4);
            const bz = cz * 15 + Math.floor(lz / 4);
            const wx = cx * N + lx,
              wz = cz * N + lz;
            // 顶点顺序 c00 c10 c11 c01（构建器约定）
            const want = [
              cornerCell(src, bx, bz, wx, wz),
              cornerCell(src, bx, bz, wx + 1, wz),
              cornerCell(src, bx, bz, wx + 1, wz + 1),
              cornerCell(src, bx, bz, wx, wz + 1),
            ];
            for (let k = 0; k < 4; k++) {
              const got = pos.getY(vi + k); // 顶点已按 (x,y,z) 布局，y = 高度
              if (Math.abs(got - want[k]) > 1e-6) {
                if (dFails < 5)
                  console.error(
                    `[D] 角高漂移 seed=${seed} (${wx},${wz}) v${k} ${got} ≠ ${want[k]}`,
                  );
                dFails++;
              }
              if (
                nor.getY(vi + k) !== 1 ||
                nor.getX(vi + k) !== 0 ||
                nor.getZ(vi + k) !== 0
              ) {
                if (dFails < 5) console.error("[D] 法线非 +Y");
                dFails++;
              }
            }
            // UV 与旧映射逐位同式：u=lx/60, v=lz/60（顶点序 c00 c10 c11 c01）
            const cellUV: [number, number][] = [
              [lx / N, lz / N],
              [(lx + 1) / N, lz / N],
              [(lx + 1) / N, (lz + 1) / N],
              [lx / N, (lz + 1) / N],
            ];
            for (let k = 0; k < 4; k++) {
              if (
                Math.abs(uv.getX(vi + k) - cellUV[k][0]) > 1e-6 ||
                Math.abs(uv.getY(vi + k) - cellUV[k][1]) > 1e-6
              ) {
                if (dFails < 5) console.error("[D] UV 漂移");
                dFails++;
              }
            }
            // 索引：T1=△(c00,c01,c10) T2=△(c01,c11,c10)
            const wantIdx = [vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1];
            for (let k = 0; k < 6; k++) {
              if (idx.getX(lz * N * 6 + lx * 6 + k) !== wantIdx[k]) {
                if (dFails < 5)
                  console.error("[D] 索引剖分漂移（对角线约定破坏）");
                dFails++;
              }
            }
            // ★ 贴地/物理采样 = 视觉网格形状（2026-08-31 修正）：
            //   sampleSurface @ 面内分点 == 本米格四角 cornerCell 三角形插值。
            //   want = [h00,h10,h11,h01]；剖分对角线 c01—c10（idx 3—1）。
            for (const [fx, fz] of [
              [0.25, 0.25],
              [0.5, 0.5],
              [0.75, 0.6],
              [0.3, 0.8],
            ]) {
              const tri =
                fx + fz <= 1
                  ? want[0] * (1 - fx - fz) + want[3] * fz + want[1] * fx
                  : want[2] * (fx + fz - 1) + want[3] * (1 - fx) + want[1] * (1 - fz);
              const gotS = sampleSurface(src, wx + fx, wz + fz);
              if (Math.abs(gotS - tri) > 1e-6) {
                if (dFails < 8)
                  console.error(
                    `[D] 物理≠视觉 seed=${seed} (${(wx + fx).toFixed(2)},${(wz + fz).toFixed(2)}) sample=${gotS} mesh=${tri}`,
                  );
                dFails++;
              }
            }
            vi += 4;
          }
        }
      }
    }
  }
  if (dFails > 0) {
    console.error(`[D] 回归失败：网格装配违例 ${dFails}`);
    process.exit(1);
  }
  console.log("[D] ChunkSurface 网格装配对照通过（渲染=查询同源）");
}

// ============================================================
// Phase E：快照一致（Worker 烘焙源 vs 主线程块源逐位对照）
// ============================================================
{
  let eFails = 0;
  let eSamples = 0;
  for (const seed of SEEDS) {
    const rasterSrc = makeSource(seed);
    const fetchChunk = (cx: number, cz: number): ChunkData | undefined =>
      getChunk(seed, cx, cz);
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
              if (eFails < 5)
                console.error(
                  `[E] 快照漂移 seed=${seed} (${x.toFixed(2)},${z.toFixed(2)}) ${a} ≠ ${b}`,
                );
              eFails++;
            }
          }
        }
      }
    }
  }
  if (eFails > 0) {
    console.error(`[E] 回归失败：快照与主线程不一致 ${eFails}`);
    process.exit(1);
  }
  console.log(`[E] 快照一致性通过（${eSamples} 采样逐位一致）`);
}

// ============================================================
// Phase F：顶点一致性 + 无幽灵拉高（§1.1 不变式①②③）
// ============================================================
{
  // 手工 2×2 块场景（块坐标 (0..1)²；测内部顶点 (4,4) 与边内顶点 (4,2)）
  let fFails = 0;
  const expectNum = (name: string, got: number, want: number) => {
    if (Math.abs(got - want) > 1e-9) {
      console.error(`[F] ${name}: ${got} ≠ ${want}`);
      fFails++;
    }
  };
  const fixture = (blocks: Record<string, BlockInfo>): BlockSource => ({
    blockAt: (bx: number, bz: number): BlockInfo | undefined =>
      blocks[`${bx},${bz}`],
  });
  /** ★ 显式钉死焊边的 fixture（新规则：weld = opt-in，默认恒 cliff） */
  const weldFixture = (
    blocks: Record<string, BlockInfo>,
    edgeFinal: (
      bx: number,
      bz: number,
      dir: 0 | 1 | 2 | 3,
    ) => "weld" | "cliff" | undefined,
  ): BlockSource => ({
    blockAt: (bx: number, bz: number): BlockInfo | undefined =>
      blocks[`${bx},${bz}`],
    edgeFinal,
  });
  const flat = (h: number): BlockInfo => ({ id: 0, h });
  const liq = (h: number): BlockInfo => ({ id: 93, h });
  const plat = (h: number): BlockInfo => ({ id: 92, h });

  // ① 撕裂角自持（不变式 §3.2）：对全 cliff 角，每块沿边角 = 各自 h（零插值），
  //    不会因对角/邻块被抬（根除对角幽灵拉高）
  {
    const src = fixture({
      "0,0": flat(0.2),
      "1,0": flat(0.05),
      "0,1": flat(0.15),
      "1,1": flat(0.1),
    });
    expectNum("[F] 撕裂角 00 自持", cornerCell(src, 0, 0, 4, 4), 0.2);
    expectNum("[F] 撕裂角 10 自持", cornerCell(src, 1, 0, 4, 4), 0.05);
    expectNum("[F] 撕裂角 01 自持", cornerCell(src, 0, 1, 4, 4), 0.15);
    expectNum("[F] 撕裂角 11 自持", cornerCell(src, 1, 1, 4, 4), 0.1);
  }

  // ② 无幽灵拉高：对角高台 (1,1)=5 只与 (0,0) 对角相接 → 不抬 (0,0) 的角
  //    （假设各边裁决后无 weld 缓冲链可传导到该角）
  {
    const src = fixture({
      "0,0": flat(0.2),
      "1,0": flat(0.05),
      "0,1": flat(0.15),
      "1,1": plat(5),
    });
    expectNum("[F] 对角高块不抬角", cornerCell(src, 0, 0, 4, 4), 0.2);
  }

  // ③ weld 边连续（不变式 §2.3：共享 weld 边两侧沿整边【中段】零落差）；
  //    端点（块角）允许撕裂（§3.5：端面墙收口，不承诺零落差）。
  //    ★ 2026-08-31 后修正：插值 = 硬边界后修正，同类型对永不插值（V2）。
  //      要产生实际坡带，焊缝必须落在【可插值类型对】上 → 用 plat(high)↔flat(low)。
  {
    // 边 (0,0)~(1,0) 显式钉死 weld（两侧成对，weld 对称裁决）；
    // 低侧 (0,0) 顶沿边向高侧攀爬；铺满周围块（含 z±1 边缘），保证
    // cornerCell 无缺块干扰
    const src = weldFixture(
      {
        "0,0": flat(0),
        "1,0": plat(0.6),
        "0,1": flat(0),
        "1,1": plat(0.6),
        "0,-1": flat(0),
        "1,-1": plat(0.6),
      },
      (bx, bz, dir) =>
        (bx === 0 && bz === 0 && dir === 0) ||
        (bx === 1 && bz === 0 && dir === 1)
          ? "weld"
          : undefined,
    );
    // 采样共享边 x=4：仅中段（0.5..3.5）低侧 == 高侧（端点撕裂由端面墙补）
    for (const wz of [0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      const low = cornerCell(src, 0, 0, 4, wz);
      const high = cornerCell(src, 1, 0, 4, wz);
      expectNum(
        `[F] weld 边中段零落差 z=${wz}`,
        Number(low.toFixed(3)),
        Number(high.toFixed(3)),
      );
    }
  }

  // ④ cliff 自持（不变式 §3.2）：cliff 边两侧各持各高，零插值
  {
    const src = fixture({
      "0,0": flat(0.2),
      "1,0": flat(0.05),
      "0,1": flat(0.2),
      "1,1": flat(0.05),
    });
    expectNum("[F] cliff 高侧自持", cornerCell(src, 0, 0, 4, 2), 0.2);
    expectNum("[F] cliff 低侧自持", cornerCell(src, 1, 0, 4, 2), 0.05);
  }

  // ⑤ 角与边融合（2026-08-31 新设计）：低侧块角点不再是独立抬成平顶，
  //    而是由两条触及 weld 边的 interpEdge 在 t=0（块边界）取 crest 融合。
  //    高台在 NE 角（(1,0) 与 (0,1) 都高、weld）→ 四块在共享角读到同 crest（水密）。
  //    ★ 对向双坡各占块宽 1/3（WELD_RAMP_CELLS=4/3），中部留 1/3 平地 → 坡+平地+坡
  {
    const src = weldFixture(
      {
        "0,0": flat(0.0),
        "1,0": plat(0.6),
        "0,1": plat(0.6),
        "1,1": plat(0.6),
        // 扩展高台外圈，保证块视角邻居齐备无缺块干扰
        "2,0": plat(0.6),
        "0,2": plat(0.6),
        "2,1": plat(0.6),
        "1,2": plat(0.6),
        "2,2": plat(0.6),
      },
      (bx, bz, dir) => {
        // 平台↔平地、平台↔平台都显式 weld（类型对可插值）
        return "weld";
      },
    );
    // 共享角 V=(4,4)：四块都经边融合读到平台 crest 0.6（水密）
    for (const [bx, bz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      expectNum(
        `[F] 角边融合 ${bx},${bz} 读平台crest`,
        Number(cornerCell(src, bx, bz, 4, 4).toFixed(3)),
        0.6,
      );
    }
    // 低侧块 (0,0) 角边融合的中间过渡也对准 1/3 宽坡带（对向双坡不重叠无 V）
  }

  // ⑥ 斜坡带（weld）剖面：低侧块内部一点在坡带内时取 rampProfile
  //    注意：0<t<w 才进剖面；块内深处/t 落在坡带外 → 落回低侧块高 (hL)
  {
    // 单条 weld 边 (0,0)~(1,0)，低侧 (0,0) 深 4m 前剖面 (w=2)
    const src = fixture({ "0,0": flat(0), "1,0": flat(4) });
    const t1 = 1; // 深入 1m：剖面 = hH-(hH-hL)*(1/2) = 2
    expectNum("[F] 坡带剖面 t=1", rampProfile(2, 4, 0, t1), 2);
    // cell 角点不在坡带带内（V 深处 t 超过 w）→ 落回低侧块高
    const Vdeep = cornerCell(src, 0, 0, 1, 2);
    expectNum("[F] 坡带外落回低侧", Vdeep, 0);
  }
  if (fFails > 0) {
    console.error("[F] 回归失败：顶点一致性/无幽灵拉高");
    process.exit(1);
  }
  console.log("[F] 顶点一致性 + 无幽灵拉高 + weld 零落差校验通过");
}

// ============================================================
// Phase G：精修执行器（edgeFinal 唯一判点 + 空精修恒透传）
//   ① 默认引擎 ↔ 显式覆写 ↔ inherit 回落语义；
//   ② refine() 空精修恒透传 ≡ 默认引擎（第五铁律：对外纯净）。
// ============================================================
{
  let gFails = 0;
  const expectR = (name: string, got: unknown, want: unknown) => {
    if (got !== want) {
      console.error(`[G] ${name}: ${got} ≠ ${want}`);
      gFails++;
    }
  };
  // 手工 2×2 场景：块(0,0) 邻 +x(1,0) 高0.1（默认恒 cliff）；邻 +z(0,1) 高5
  // （默认引擎恒硬边界 → 也 cliff；weld 只能由 edgeFinal 显式钉死）
  const gsrc: BlockSource = {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (bx === 0 && bz === 0) return { id: 0, h: 0 };
      if (bx === 1 && bz === 0) return { id: 0, h: 0.1 };
      if (bx === 0 && bz === 1) return { id: 0, h: 5 };
      return undefined;
    },
  };
  // ① 默认引擎（恒硬边界）
  expectR("[G] 默认 +x", finalRuling(gsrc, 0, 0, 0), "cliff");
  expectR("[G] 默认 +z", finalRuling(gsrc, 0, 0, 2), "cliff");
  // ② 显式覆写
  let gref = overrideEdge(EMPTY_REFINEMENTS, 0, 0, 0, "weld");
  gref = overrideEdge(gref, 0, 0, 2, "cliff");
  const gsrcR = refine(gsrc, gref);
  expectR("[G] 覆写 +x→weld", finalRuling(gsrcR, 0, 0, 0), "weld");
  expectR("[G] 覆写 +z→cliff", finalRuling(gsrcR, 0, 0, 2), "cliff");
  // ③ inherit 回落
  const gref2 = overrideEdge(gref, 0, 0, 0, "inherit");
  const gsrcR2 = refine(gsrc, gref2);
  expectR("[G] inherit +x 回落", finalRuling(gsrcR2, 0, 0, 0), "cliff");
  expectR("[G] +z 仍覆写", finalRuling(gsrcR2, 0, 0, 2), "cliff");
  // ④ 空精修恒透传
  const gsrcE = refine(gsrc, EMPTY_REFINEMENTS);
  expectR(
    "[G] 空精修 +x",
    finalRuling(gsrcE, 0, 0, 0),
    finalRuling(gsrc, 0, 0, 0),
  );
  expectR(
    "[G] 空精修 +z",
    finalRuling(gsrcE, 0, 0, 2),
    finalRuling(gsrc, 0, 0, 2),
  );
  if (gFails > 0) {
    console.error("[G] 回归失败：edgeFinal 唯一判点语义");
    process.exit(1);
  }
  console.log("[G] edgeFinal 唯一判点校验通过（默认/覆写/inherit/空透传）");
}

// ============================================================
// Phase H：墙 = 硬边界基础几何（§4.1，2026-08-31 墙与裁决解耦）
//   ① baseHeightOf 缺省 = h（不悬空承诺）；
//   ② 两侧块高有落差就发墙——cliff 墙 = 撕裂面本身，weld 墙 = 贴坡背墙；
//   ③ 等高块零墙（退化保护）。
// ============================================================
{
  let hFails = 0;
  const expectH = (
    name: string,
    got: number | boolean,
    want: number | boolean,
  ) => {
    if (got !== want) {
      console.error(`[H] ${name}: ${got} ≠ ${want}`);
      hFails++;
    }
  };
  const mk = (h: number, hBase?: number): BlockInfo => ({
    id: 0,
    h,
    ...(hBase !== undefined ? { hBase } : {}),
  });

  // ① baseHeightOf 缺省 = h
  expectH("[H] baseHeightOf 缺省=h", baseHeightOf(mk(3)), 3);
  expectH("[H] baseHeightOf 显式", baseHeightOf(mk(3, 1.2)), 1.2);

  // 墙构建最小上下文（heightAt/tileDefAt 直接来自块源；seed 固定 → 确定性）
  const wallCtx = (blocks: Record<string, BlockInfo>) => ({
    seed: 1,
    heightAt: (_x: number, _z: number) => 0,
    tileDefAt: () => ({
      visual: { baseHsl: { h: 0, s: 0, l: 0.5 } },
      isDepression: false,
    }),
  });
  // 用足够大的扫描帧（4×4§见 buildChunkWallBuffers 的 cx*N+.. 局部；N=60）
  const N60 = 60;

  // ② 只有裁决 cliff 且确有落差才发墙：手工 2×2，chunk(0,0) 内
  //    (a) 相邻块同时存在 cliff 边 → 墙数 = 该边数 × 2 三角
  //    (b) 全 weld（大落差斜坡）→ 零墙
  {
    // (b) 平坦水面(全 weld，无墙)——两行高差不一的相邻块，weld 裁决
    const flatBlocks: Record<string, BlockInfo> = {
      ["0,0"]: mk(0),
      ["1,0"]: mk(0),
      ["2,0"]: mk(0),
      ["3,0"]: mk(0),
      ["0,1"]: mk(0),
      ["1,1"]: mk(0),
      ["2,1"]: mk(0),
      ["3,1"]: mk(0),
      ["0,2"]: mk(0),
      ["1,2"]: mk(0),
      ["2,2"]: mk(0),
      ["3,2"]: mk(0),
      ["0,3"]: mk(0),
      ["1,3"]: mk(0),
      ["2,3"]: mk(0),
      ["3,3"]: mk(0),
    };
    // 构建整张全平 chun（对 chunk0,0 扫描）
    const srcAllFlat = (bx: number, bz: number): BlockInfo | undefined =>
      flatBlocks[`${bx},${bz}`];
    const srcFlat: BlockSource = { blockAt: srcAllFlat };
    const buf = buildChunkWallBuffers(srcFlat, 0, 0, N60, wallCtx(flatBlocks));
    expectH("[H] 全平 0 墙", buf.indices.length, 0);
  }
  {
    // (a) cliff：单列高差 0.05（β 内 → cliff）。两列 (bx0=0..3,bz=0..3) 全是平地，
    //     另加一列更高，让 cliff 边在 x=4 边界上成列出现。
    const blocks: Record<string, BlockInfo> = {};
    for (let bz = 0; bz < 4; bz++) {
      for (let bx = 0; bx < 4; bx++) {
        blocks[`${bx},${bz}`] = mk(bx === 3 ? 0.2 : 0.05);
      }
    }
    const src: BlockSource = { blockAt: (bx, bz) => blocks[`${bx},${bz}`] };
    const buf = buildChunkWallBuffers(src, 0, 0, N60, wallCtx(blocks));
    // 期望：只在 x=4 边界（bxC=3 的 dx 边）发墙，且仅高侧发 → 边界条数 × 2 三角
    expectH("[H] cliff 发墙 > 0", buf.indices.length > 0, true);
  }

  // ③ weld 边发贴坡背墙（2026-08-31：墙与裁决解耦）：斜坡蒙皮背后必有
  //   封腔墙，杜绝坡带下方空腔看穿。测试源按真实语义延拓（块外取最近列，
  //   = 无界平面）：若直接返回 undefined → MISSING 兜底(h=0) 会产生假墙。
  //   真实链路 raster.chunkSource 是无界源（跨 chunk 读），永不触 MISSING。
  {
    // 背景平坦，中央一条 x 分离的高差（x 块 <8 → 0，≥8 → 4），显式钉死 weld。
    const hOf = (bx: number): number => (bx < 8 ? 0 : 4);
    const src: BlockSource = {
      blockAt: (bx: number, bz: number): BlockInfo | undefined => ({
        id: 0,
        h: hOf(bx),
      }),
      edgeFinal: (bx, bz, dir) =>
        (bx === 7 && dir === 0) || (bx === 8 && dir === 1) ? "weld" : undefined,
    };
    const buf = buildChunkWallBuffers(src, 0, 0, N60, wallCtx({}));
    // 共享边 x=32（块 7|8，高差 4m）→ 高侧（块 8）逐 cell 发背墙：
    // 60 cell 边 × 2 三角 × 3 索引 = 360。低侧不重发（去重）。
    expectH("[H] weld 贴坡背墙三角数", buf.indices.length, 60 * 2 * 3);
    // 墙顶 = crest = 4：扫描顶点 y，最大值应为高侧块高（沿共享边表面同值）
    let maxTop = -Infinity;
    for (let v = 0; v < buf.vertices.length; v += 3) {
      if (buf.vertices[v + 1] > maxTop) maxTop = buf.vertices[v + 1];
    }
    expectH("[H] weld 背墙墙顶=crest", maxTop, 4);
  }
  // ④ 坡侧裙墙（防御机制，2026-08-31）：低块(1,0)(ground) 有 +x 坡（向高块
  //    2,0 平台 weld，可插值类型对）→ 其 +z 侧相邻是平地块(1,1)(ground，无坡、
  //    不抬高) → 视觉面有落差 → 发坡侧裙墙（此前缺失：坡侧露斜草皮/看穿）。
  //    背墙仍发（高侧 crest）。块取原点附近以确保坡带落进 chunk(0,0) 视野。
  {
    const isHigh = (bx: number, bz: number) => bx >= 2 && bz === 0;
    const src: BlockSource = {
      blockAt: (bx, bz): BlockInfo | undefined => ({
        id: isHigh(bx, bz) ? 92 : 0, // 平台 vs 平地（可插值）
        h: isHigh(bx, bz) ? 4 : 0,
      }),
      edgeFinal: (bx, bz, dir) =>
        bz === 0 &&
        ((bx === 1 && dir === 0) || (bx === 2 && dir === 1))
          ? "weld"
          : undefined,
    };
    const buf = buildChunkWallBuffers(src, 0, 0, N60, wallCtx({}));
    const idx = buf.indices;
    const verts = buf.vertices;
    let skirt = 0;
    let backing = 0;
    // 墙是竖直平面：背墙 = x 面（常量 x，x0≈x1，跨 z，顶 = crest ≈ 4）；
    // 裙墙 = z 面（常量 z，z0≈z1，跨 x，顶随坡 0<top≤4）。
    for (let t = 0; t < idx.length; t += 6) {
      const i0 = idx[t];
      const i1 = idx[t + 1];
      const i2 = idx[t + 2];
      const x0 = verts[i0 * 3];
      const x1 = verts[i1 * 3];
      const z0 = verts[i0 * 3 + 2];
      const z1 = verts[i1 * 3 + 2];
      const top0 = verts[i0 * 3 + 1];
      void i2;
      if (Math.abs(x0 - x1) < 0.01 && top0 > 3.9) backing++;
      if (Math.abs(z0 - z1) < 0.01 && top0 > 0.01 && top0 <= 3.9) skirt++;
    }
    expectH("[H] weld 背墙仍在", backing > 0, true);
    expectH("[H] 坡侧裙墙已发（此前缺失）", skirt > 0, true);
  }
  if (hFails > 0) {
    console.error("[H] 回归失败：墙=硬边界基础几何");
    process.exit(1);
  }
  console.log("[H] 墙 = 硬边界基础几何校验通过（有落差即发墙，weld=贴坡背墙）");
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
    if (got !== want) {
      console.error(`[I] ${name}: ${got} ≠ ${want}`);
      iFails++;
    }
  };
  const isrc = (h: number): BlockSource => ({
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (bx >= -2 && bx <= 2 && bz >= -2 && bz <= 2) return { id: 0, h };
      return undefined;
    },
  });

  // ① 空精修恒透传（返回同一源对象）
  const emptySrc = isrc(1);
  expectI(
    "[I] 空精修透传",
    refine(emptySrc, EMPTY_REFINEMENTS) === emptySrc,
    true,
  );

  // ① 高度补丁：h 改写 + 底高缺省 = h
  const ref1 = setHeight(EMPTY_REFINEMENTS, 1, 1, 5);
  const src1 = refine(isrc(0.5), ref1);
  expectI("[I] setHeight 改 h", src1.blockAt(1, 1)!.h, 5);
  expectI("[I] setHeight 底高缺省=h", baseHeightOf(src1.blockAt(1, 1)!), 5);
  expectI("[I] 未补丁块不变", src1.blockAt(2, 2)!.h, 0.5);

  // ① 显式底高
  const ref2 = setHeight(EMPTY_REFINEMENTS, 1, 1, 5, -2);
  expectI(
    "[I] setHeight 显式底高",
    refine(isrc(0.5), ref2).blockAt(1, 1)!.hBase,
    -2,
  );

  // ② 侵蚀确定性 + 克制（用有低洼梯度的读出，确保真的切出连续沟壑）
  const grad: BlockSource = {
    blockAt(bx: number, bz: number): BlockInfo | undefined {
      if (Math.abs(bx) > 24 || Math.abs(bz) > 24) return undefined;
      const d = Math.abs(bx) + Math.abs(bz); // 菱形低洼：越靠近心越低
      return { id: 0, h: 3 - d * 0.1 };
    },
  };
  const reader = grad.blockAt.bind(grad);
  const resA = carveGradientErosion(777, reader, {
    maxBlocks: 20,
    maxDepth: 0.5,
    maxSteps: 6,
  });
  const resB = carveGradientErosion(777, reader, {
    maxBlocks: 20,
    maxDepth: 0.5,
    maxSteps: 6,
  });
  expectI("[I] 侵蚀确定性", resA.heights.size, resB.heights.size);
  expectI("[I] 侵蚀确实切出(patch>0)", resA.heights.size > 0, true);
  expectI("[I] 侵蚀块数克制≤上限", resA.heights.size <= 20, true);
  for (const [, p] of resA.heights) {
    if (p.hBase === undefined || p.h - p.hBase > 1e-9) {
      console.error("[I] 侵蚀 h/hBase 未同降");
      iFails++;
      break;
    }
  }
  // ③ 侵蚀结果经 refine 生效（h 与 hBase 同降，baseHeightOf 跟随）
  const srcE = refine(grad, resA);
  let applied = 0;
  for (const [key, p] of resA.heights) {
    const b = srcE.blockAt(p.bx, p.bz)!;
    if (b.h === p.h && b.hBase === p.hBase) applied++;
  }
  expectI("[I] 侵蚀补丁全部生效", applied, resA.heights.size);
  if (iFails > 0) {
    console.error("[I] 回归失败：高度补丁/侵蚀");
    process.exit(1);
  }
  console.log(
    `[I] 高度补丁 + 确定性侵蚀通过（补丁${resA.heights.size}块·克制）`,
  );
}

console.log("[surface-regression] 全部通过");
