// ============================================================
// TerrainPatch —— 地块破坏（R+P）几何异步服务（多 Worker 后台 + 主线程同步回退）
// ============================================================
// 职责：把「表 + 双 builder」的整 chunk 几何生成移出主线程（命中地面时的最大
// 单帧成本）。数据面 = 3×3 邻域 chunk 的 heights/blockTypes 拷贝（每份 ~135KB，
// memcpy 微秒级）→ postMessage(transfer) → Worker 纯计算 → 零拷贝回传。
//
// ★ 坑洞优先 / 水体解耦（2026-09-16）：本池【不再求解水体】——调用方（ChunkManager
//   .patchRebuildChunk）恒传 waterMode:'none'，几何只出 top/wall/物理分区。
//   水面转由 ./WaterSolve 的专用单 worker 异步慢算，算完只换水网格。
//   背景：水体求解（initSolve/updateSolve + 5cm 边界探针点阵采样）原先与几何串行
//   在同一调用内，打「有水 chunk」时把坑洞整体拖慢；解耦后实测水体不再卡。
//
// ★ 多 Worker（2026-09-08）：WORKER_COUNT=3，**按 chunk 坐标粘性归属** →
//   · 不同 chunk 的破坏重建并行（3 核分摊）；同 chunk 已被 flushPatchRebuilds
//     节流串行化，不会并发双算同一 chunk。
//   · ★ 粘性路由（2026-11-14「跨天复用精细渲染 chunk」，见 workerForChunk）：
//     hash(cx,cz) 固定归属 ⇒ 同一 chunk 恒落同一台 Worker ⇒ 那台模块作用域里的
//     基座缓存（IncrementalGeometry.baseCache）跨天仍在 ⇒ 回访只重放补丁增量。
//     旧方案「选排队最短」会换人 ⇒ 新 Worker 无基座 ⇒ 白跑一次全量构建。
//     pickLeastBusy 仅作归属 Worker 不可用时的兜底。
//   · 缓存内存由 baseCache / patchSourceCache 各自的 LRU 条数 + 字节上限封顶。
//   · ★ 水体增量状态（WaterSurface 探针/分量）自 2026-09-16 起已不在本池持有。
//
// 流程：
//   compute({seed, cx, cz, mask, waterMode}, readChunk)
//     ├─ 主线程：拷 3×3 邻域数组（不转移活数组所有权）
//     ├─ 按 chunk 坐标选归属 worker（不可用 → pickLeastBusy 兜底）→ postMessage(transfer)
//     │    → worker 内 computeTableGeometry → resolve(几何字节；water 可能为 null)
//     ├─ worker 断裂/不存在 → 主线程同步 computeTableGeometry（同函数同字节）
//     └─ 计算失败 → resolve(null)（调用方走既有 requestStandardBake 兜底）
//
// ★ 字节一致由构造保证：Worker 用 makeChunkSource(拷贝闭包) + refineChunkSource
//   （seed,cx,cz），与主线程 RasterMap.chunkSource 同一函数同一输入 → 逐位一致
//   （验收 ⑧ 用"拷贝闭包 vs 活闭包"锁字节）。
// ★ 微信小游戏适配点：ensure 里换 wx.createWorker —— 微信限制部分平台 worker 数，
//   可降为 1（WORKER_COUNT 常量调整即可）。
// ============================================================

import { computeTableGeometry, incrementalDropCache, dropPatchSourceCache, type PatchGeomResult } from "./PatchCompute";
import { computeIncrementalMasks, setGeometryCacheWindow } from "./IncrementalGeometry";
import type { ChunkDataLite } from "./Refinements";
import type { LevelAtWorld } from "./FaceBuild";
import { FINE_S_NEAR } from "./FaceBuild";
import { CHUNK_SIZE } from "./ChunkGenerator";

interface PatchChunkData {
  ccx: number;
  ccz: number;
  heights: Float32Array;
  blockTypes: Uint8Array;
  /** ★ 补丁层数表（跨 chunk 包络场查询用；随 payload 拷贝进 Worker） */
  levels?: Uint8Array;
}

const NEI = [-1, 0, 1];

/** ★ 3×3 邻域 levels 拷贝 → 世界 cell 层数查询（主线程回退/Worker 同构） */
function makeLevelAt(chunks: PatchChunkData[]): LevelAtWorld {
  const map = new Map<string, Uint8Array>();
  for (const c of chunks) if (c.levels) map.set(`${c.ccx},${c.ccz}`, c.levels);
  return (wx: number, wz: number): number => {
    const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
    const lv = map.get(`${ccx},${ccz}`);
    if (!lv) return 0;
    const lx = wx - ccx * CHUNK_SIZE, lz = wz - ccz * CHUNK_SIZE;
    return lv[lz * CHUNK_SIZE + lx] ?? 0;
  };
}

class TerrainPatchService {
  /** 破坏几何 Worker 数（平行 chunk 重建）；微信端可降为 1 */
  private static readonly WORKER_COUNT = 3;

  private workers: (Worker | null)[] = [];
  private brokenStates: boolean[] = [];
  private nextIds: number[] = [];
  private pendings: Map<number, (r: PatchGeomResult | null) => void>[] = [];
  /** ★ 当前缓存窗口（玩家所在 chunk + 半径）：新 Worker 就绪时补发一次 */
  private cacheWindow: { cx: number; cz: number; radius: number } | null = null;
  /** ★ 出生点基座预热在途（同拍只发一块；消息都是排队执行，不并发） */
  private warmBusy = false;
  private warmIds = 0;

  /**
   * ★ 缓存窗口（2026-11-14 用户定调「只存舰船周围的 chunk」）：
   *   主线程广播给每台 Worker —— 窗口内才缓存、平移时双缓冲保留上一窗口、
   *   更早的整体裁掉。主线程回退那份模块缓存同口径（setGeometryCacheWindow）。
   *   中心不变不重复广播（由 ChunkManager 在跨 chunk 时调用）。
   */
  setCacheWindow(cx: number, cz: number, radius: number): void {
    const w = this.cacheWindow;
    if (w && w.cx === cx && w.cz === cz && w.radius === radius) return;
    this.cacheWindow = { cx, cz, radius };
    setGeometryCacheWindow(cx, cz, radius);
    for (const worker of this.workers) {
      worker?.postMessage({ type: "cacheWindow", cx, cz, radius });
    }
  }

  /** 全量保障：3 个 worker 惰性就绪（首次 compute 齐备，之后热用） */
  private ensureAll(): void {
    for (let i = 0; i < TerrainPatchService.WORKER_COUNT; i++) this.ensure(i);
  }

  /** 选排队最短（pending 最少）的可用 worker；全不可用 → -1 */
  private pickLeastBusy(): number {
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < TerrainPatchService.WORKER_COUNT; i++) {
      if (!this.workers[i]) continue;
      const cost = this.pendings[i]?.size ?? 0;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  /**
   * ★★ 按 chunk **粘性**选 worker（2026-11-14「跨天复用精细渲染 chunk」）：
   *   基座缓存（IncrementalGeometry.baseCache，无补丁全量几何）存在**每台 worker
   *   各自的模块作用域**里 ⇒ 同一个 chunk 只有落到**同一台 worker** 才能命中它的
   *   基座；按队列长度派活则跨天/跨次可能换人 ⇒ 那台 worker 没基座 ⇒ 白跑一次
   *   全量基座构建（实测冷 1393ms/块、热 922ms/块 —— 基座构建就是大头）。
   *   ⇒ 改为「按 chunk 坐标哈希」**固定归属**：同一 chunk 恒定落同一 worker
   *     ⇒ 跨天回来时基座仍在 ⇒ 只在基座上重放挖坑补丁（增量）即可。
   *
   * ★ 负载不均的顾虑：空间相邻的 chunk 哈希后分散到各 worker（雪崩式哈希
   *   无空间局部性，但正因如此反而**不会**出现"一整片都压在一台上"）；
   *   同一 chunk 的重建天然串行（ChunkManager 侧同 chunk 已有节流）。
   * ★ 固定哈希（非随机）：保证**跨天**同一 chunk 落到同一 worker（随机化会漂）。
   */
  private workerForChunk(cx: number, cz: number): number {
    let h = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    const want = h % TerrainPatchService.WORKER_COUNT;
    // 归属 worker 不可用（未创建/已损坏）→ 退回动态挑选
    if (this.workers[want] && !this.brokenStates[want]) return want;
    return this.pickLeastBusy();
  }

  private ensure(i: number): Worker | null {
    if (this.workers[i]) return this.workers[i];
    if (this.brokenStates[i]) return null;
    try {
      const w = new Worker(new URL("./terrainPatch.worker.ts", import.meta.url), { type: "module" });
      const pending = this.pendings[i] ?? new Map<number, (r: PatchGeomResult | null) => void>();
      this.pendings[i] = pending;
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number } & PatchGeomResult;
        if (msg.type === "warmResult") { this.warmBusy = false; return; }
        if (msg.type !== "result") return;
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        if (!cb) return;
        cb(msg);
      };
      w.onerror = () => {
        console.warn(`[TerrainPatch] Worker#${i} 异常终止，该归属 chunk 回退主线程同步`);
        this.brokenStates[i] = true;
        this.workers[i] = null;
        this.warmBusy = false;
        const cbs = [...pending.values()];
        pending.clear();
        for (const cb of cbs) cb(null);
      };
      this.workers[i] = w;
      // ★ 新 Worker 模块缓存为空，但窗口口径要先对齐（否则会缓存窗口外的块）
      if (this.cacheWindow) w.postMessage({ type: "cacheWindow", ...this.cacheWindow });
      return w;
    } catch {
      this.brokenStates[i] = true;
      return null;
    }
  }

  /** ★ 3×3 邻域快照（拷贝后随消息 transfer；缺失邻块直接跳过，由调用方判定完整性） */
  private snapshotNeighborhood(
    cx: number, cz: number,
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): PatchChunkData[] {
    const chunks: PatchChunkData[] = [];
    for (const dz of NEI) {
      for (const dx of NEI) {
        const ccx = cx + dx, ccz = cz + dz;
        const d = readChunk(ccx, ccz);
        if (!d) continue; // 缺失邻域：Worker/主线程同为 undefined → 同兜底，字节仍一致
        // ★ 拷贝后再 transfer（不能转移活数组所有权——主线程 chunk 数据仍被消费）
        chunks.push({
          ccx, ccz,
          heights: new Float32Array(d.heights),
          blockTypes: new Uint8Array(d.blockTypes),
          levels: d.levels ? new Uint8Array(d.levels) : undefined,
        });
      }
    }
    return chunks;
  }

  /**
   * ★ 是否空闲（没有几何请求在途；出生点预热让路用 —— 挖坑/重建永远优先）。
   */
  isIdle(): boolean {
    if (this.warmBusy) return false;
    for (const p of this.pendings) if (p && p.size > 0) return false;
    return true;
  }

  /**
   * ★ 出生点基座预热（2026-11-14 用户定调「缓存只缓存出生点附近，
   *   不要和渲染放一起，1 秒一个 chunk 足够」）：
   *   只让归属 Worker 构建一块**无补丁基座**并写入它的模块缓存，
   *   不回传几何、不调色、不算水面/物理 —— 与首建/破坏路径完全解耦。
   *   ★ 绝不回退主线程（单块基座约 0.5~1s，占主线程就是卡死）。
   * @returns true = 已投递；false = 在途/Worker 不可用/邻域未就绪（调用方稍后重试）
   */
  warmBase(
    seed: number, cx: number, cz: number,
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): boolean {
    if (this.warmBusy) return false;
    const i = this.workerForChunk(cx, cz);
    const w = i >= 0 ? this.ensure(i) : null;
    if (!w) return false;
    const chunks = this.snapshotNeighborhood(cx, cz, readChunk);
    if (chunks.length !== NEI.length * NEI.length) return false; // 邻域未就绪
    this.warmBusy = true;
    const id = ++this.warmIds;
    const transfer: ArrayBuffer[] = [];
    for (const c of chunks) {
      transfer.push(c.heights.buffer, c.blockTypes.buffer);
      if (c.levels) transfer.push(c.levels.buffer);
    }
    w.postMessage({ type: "warmBase", id, seed, cx, cz, fineS: FINE_S_NEAR, chunks }, transfer);
    return true;
  }

  /**
   * ★ 清空增量基座缓存（切风格/dispose 元数据换代时调用）：主线程回退缓存直接
   * 清；存量 Worker 广播 clearCache（新 Worker 首次 compute 时模块缓存本就为空）。
   */
  clearCaches(): void {
    incrementalDropCache();
    dropPatchSourceCache();
    this.warmBusy = false;
    for (let i = 0; i < TerrainPatchService.WORKER_COUNT; i++) {
      if (this.workers[i]) {
        this.workers[i]!.postMessage({ type: "clearCache" });
      }
    }
  }

  /**
   * 计算带补丁层数表的 chunk 几何（并行：不同 chunk 由不同 worker 处理）。
   * @param req.dirty 本次 dig 直接挖到的世界 4m 块 key 列表；缺省 = 全量。
   *   ★ 2026-09-16：waterMode:'none' 时几何侧【不消费】dirty（不求解水体）；
   *     dirty 由调用方（ChunkManager）另行转发给 WaterSolve 做异步水体增量。
   *     waterMode:'full'（首建）时仍按原语义传给 buildWaterSurface。
   * @returns 几何字节（waterMode:'none' 时 result.water === null）；
   *   所用 Worker 断裂/计算失败 → resolve(null)，调用方走标准烘焙兜底。
   */
  compute(
    req: {
      seed: number; cx: number; cz: number;
      levels: Uint8Array | undefined; dirty?: number[] | null;
      /** ★ 构建档位（8=0.125m / 4=0.25m；缺省 = FINE_S_NEAR） */
      fineS?: number;
      /** ★ 水面求解档：'none' = 跳过水体（坑洞优先；水面由 WaterSolve 异步补算） */
      waterMode?: 'full' | 'none';
    },
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): Promise<PatchGeomResult | null> {
    const { seed, cx, cz } = req;
    const chunks = this.snapshotNeighborhood(cx, cz, readChunk);
    this.ensureAll(); // 3 worker 惰性就绪（首次 compute 齐备；之后热用）
    // ★ CPU 侧（主线程）预计算受影响掩码：纯 (levels,cx,cz)，随消息传给 Worker，
    //   Worker 不再重复扫掩码 → 几何装配直接消费（字节一致由同函数保证）。
    const masks = req.levels && req.levels.length > 0
      ? computeIncrementalMasks(req.levels, cx, cz)
      : null;
    const i = this.workerForChunk(cx, cz);
    const w = i >= 0 ? this.workers[i] : null;
    if (!w) {
      // 主线程同步回退：同一纯函数（readChunk 闭包直接用）
      return Promise.resolve(
        computeTableGeometry(
          readChunk, seed, cx, cz, req.levels, req.dirty, masks, makeLevelAt(chunks),
          false, undefined, req.fineS, req.waterMode ?? 'full',
        ),
      );
    }
    const id = this.nextIds[i] = (this.nextIds[i] ?? 0) + 1;
    return new Promise((resolve) => {
      const pending = this.pendings[i] ?? new Map<number, (r: PatchGeomResult | null) => void>();
      this.pendings[i] = pending;
      pending.set(id, resolve);
      const transfer: ArrayBuffer[] = [];
      for (const c of chunks) {
        transfer.push(c.heights.buffer, c.blockTypes.buffer);
        if (c.levels) transfer.push(c.levels.buffer);
      }
      if (req.levels) transfer.push(req.levels.buffer);
      // 层数表所有权转移：调用方必须传拷贝（ChunkManager 已拷贝，本体在 chunk 数据）
      w.postMessage(
        {
          type: "patchBuild",
          id,
          seed,
          cx,
          cz,
          levels: req.levels ?? new Uint8Array(0),
          dirty: req.dirty ?? null,
          masks,
          fineS: req.fineS ?? 8,
          waterMode: req.waterMode ?? 'full',
          chunks,
        },
        transfer,
      );
    });
  }
}

/** 全局唯一实例（多 Worker 并行；与 terrainBaker 同款单例风格） */
export const terrainPatch = new TerrainPatchService();