// ============================================================
// WaterSolve —— 水体【专用】异步求解服务（2026-09-16 破坏/水体解耦）
// ============================================================
// 定位：把「水面几何」从坑洞几何的关键路径上摘下来。
//   · 破坏重建（terrainPatch）走 waterMode:'none' → 坑洞 top/wall/物理先出先装配；
//   · 水面交给本服务在【独立 worker】上慢慢算，算完主线程只换水网格。
//
// ★ 为什么是单 worker 而不是池：
//   WaterSurface 的 waterStates 是模块级增量状态（occ/连通分量/边界探针/床面点阵）。
//   同 chunk 在不同 worker 间漂移 → 状态丢失 → 每次 initSolve 全量重解（更慢）。
//   单 worker = 状态亲缘稳定 = 连打同一 chunk 走 updateSolve 增量路径。
//
// ★ 每 chunk 终态收敛（与 ChunkManager.patchRebuilds 同构）：
//   连射时同一 chunk 会连来好几个水请求 → 只保留【最新】那个（dirty 取并集），
//   在途的算完后如果有新请求再算一次。旧请求立刻以 null 结清（不悬挂 promise）。
//   → 水面允许"迟到"，但绝不允许堆积成队列把 worker 拖死。
//
// 数据面：3×3 邻域 heights/blockTypes/levels 拷贝 → transfer（与 terrainPatch 同款，
//   拷贝而非转移活数组所有权 —— 主线程 chunk 数据仍在被消费）。
// 失败语义：worker 创建失败 / 运行异常 → 主线程同步 computeWaterOnly（同函数同字节）。
// ============================================================

import { computeWaterOnly, incrementalDropCache, dropPatchSourceCache } from "./PatchCompute";
import type { WaterSurfaceRaw } from "./WaterSurface";
import type { ChunkDataLite } from "./Refinements";
import type { LevelAtWorld } from "./FaceBuild";
import { CHUNK_SIZE } from "./ChunkGenerator";

const NEI = [-1, 0, 1];

interface WaterJob {
  key: string;
  seed: number;
  cx: number;
  cz: number;
  levels: Uint8Array | undefined;
  dirty: number[] | null;
  readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined;
  resolve: (w: WaterSurfaceRaw | null) => void;
}

/** 3×3 邻域 levels → 世界 cell 层数查询（与 TerrainPatch.makeLevelAt 同构） */
function makeLevelAt(chunks: { ccx: number; ccz: number; levels?: Uint8Array }[]): LevelAtWorld {
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

class WaterSolveService {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private pending = new Map<number, (w: WaterSurfaceRaw | null) => void>();

  /** 每 chunk 最新请求（覆盖式；在途算完再取） */
  private latest = new Map<string, WaterJob>();
  /** 串行 drain 中（保证同一时刻只有一个水任务在 worker 上） */
  private running = false;

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken) return null;
    try {
      const w = new Worker(new URL("./waterSolve.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number; water?: WaterSurfaceRaw };
        if (msg.type !== "result") return;
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (cb) cb(msg.water ?? null);
      };
      w.onerror = () => {
        console.warn("[WaterSolve] Worker 异常终止，水面回退主线程同步计算");
        this.broken = true;
        this.worker = null;
        const cbs = [...this.pending.values()];
        this.pending.clear();
        for (const cb of cbs) cb(null);
      };
      this.worker = w;
      return w;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** 清空增量缓存（切风格/dispose 元数据换代） */
  clearCaches(): void {
    incrementalDropCache();
    dropPatchSourceCache();
    this.worker?.postMessage({ type: "clearCache" });
  }

  /**
   * 异步求水面（每 chunk 终态收敛；旧请求立即以 null 结清）。
   * @returns 水面几何；求解失败 → null（调用方保持旧水面，下次重建自然覆盖）
   */
  compute(
    req: { seed: number; cx: number; cz: number; levels: Uint8Array | undefined; dirty?: number[] | null },
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): Promise<WaterSurfaceRaw | null> {
    const key = `${req.cx},${req.cz}`;
    return new Promise<WaterSurfaceRaw | null>((resolve) => {
      const prev = this.latest.get(key);
      if (prev) {
        // ★ 合并到新请求：dirty 取并集（增量探针失效面只会变大），旧 promise 结清
        const merged = new Set<number>(prev.dirty ?? []);
        for (const d of req.dirty ?? []) merged.add(d);
        req = { ...req, dirty: merged.size > 0 ? [...merged] : null };
        prev.resolve(null);
      }
      this.latest.set(key, { key, seed: req.seed, cx: req.cx, cz: req.cz, levels: req.levels, dirty: req.dirty ?? null, readChunk, resolve });
      void this.drain();
    });
  }

  /** 串行排空：一次只投一个任务（worker 内部本就串行，这里保证不重复投） */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.latest.size > 0) {
        const it = this.latest.values().next().value as WaterJob | undefined;
        if (!it) break;
        this.latest.delete(it.key);
        let out: WaterSurfaceRaw | null = null;
        try {
          out = await this.runOne(it);
        } catch (e) {
          console.warn(`[WaterSolve] chunk(${it.cx},${it.cz}) 水面求解失败`, e);
        }
        it.resolve(out);
      }
    } finally {
      this.running = false;
    }
  }

  private runOne(job: WaterJob): Promise<WaterSurfaceRaw | null> {
    // 3×3 邻域拷贝（不转移活数组所有权）
    const chunks: { ccx: number; ccz: number; heights: Float32Array; blockTypes: Uint8Array; levels?: Uint8Array }[] = [];
    for (const dz of NEI) {
      for (const dx of NEI) {
        const ccx = job.cx + dx, ccz = job.cz + dz;
        const d = job.readChunk(ccx, ccz);
        if (!d) continue;
        chunks.push({
          ccx, ccz,
          heights: new Float32Array(d.heights),
          blockTypes: new Uint8Array(d.blockTypes),
          levels: d.levels ? new Uint8Array(d.levels) : undefined,
        });
      }
    }
    const w = this.ensure();
    if (!w) {
      // 主线程同步回退：同一纯函数（readChunk 闭包直接用）
      return Promise.resolve(
        computeWaterOnly(job.readChunk, job.seed, job.cx, job.cz, job.levels, job.dirty, makeLevelAt(chunks)),
      );
    }
    const id = this.nextId++;
    return new Promise<WaterSurfaceRaw | null>((resolve) => {
      this.pending.set(id, resolve);
      const transfer: ArrayBuffer[] = [];
      for (const c of chunks) {
        transfer.push(c.heights.buffer, c.blockTypes.buffer);
        if (c.levels) transfer.push(c.levels.buffer);
      }
      if (job.levels) transfer.push(job.levels.buffer);
      w.postMessage(
        {
          type: "waterSolve",
          id,
          seed: job.seed,
          cx: job.cx,
          cz: job.cz,
          levels: job.levels ?? new Uint8Array(0),
          dirty: job.dirty ?? null,
          chunks,
        },
        transfer,
      );
    });
  }
}

/** 全局唯一实例（单 worker 串行；水面慢算专用） */
export const waterSolve = new WaterSolveService();
