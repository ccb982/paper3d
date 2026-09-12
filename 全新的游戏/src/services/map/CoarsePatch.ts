// ============================================================
// CoarsePatch —— 粗块几何异步服务（地图构建两级：【粗加载】）
// ============================================================
// 与 TerrainPatch（细化）分池：粗块只出硬边几何 + 纯色顶点色，
// 无烘焙/水面/装饰/物理 → 单块成本远低于细化；飞行期大半径铺粗块。
// 细化阶段在粗块基础上全量重建（首版），完成后粗块退场（ChunkManager 管）。

import { computeTableGeometry, dropPatchSourceCache, type PatchGeomResult } from "./PatchCompute";
import type { ChunkDataLite } from "./Refinements";

const NEI = [-1, 0, 1];

interface CoarseChunkData {
  ccx: number;
  ccz: number;
  heights: Float32Array;
  blockTypes: Uint8Array;
}

class CoarsePatchService {
  /** 粗块 Worker 数（纯几何、无烘焙 → 可并行多枚） */
  private static readonly WORKER_COUNT = 2;

  private workers: (Worker | null)[] = [];
  private brokenStates: boolean[] = [];
  private nextIds: number[] = [];
  private pendings: Map<number, (r: PatchGeomResult | null) => void>[] = [];

  private ensure(i: number): Worker | null {
    if (this.workers[i]) return this.workers[i];
    if (this.brokenStates[i]) return null;
    try {
      const w = new Worker(new URL("./coarsePatch.worker.ts", import.meta.url), { type: "module" });
      const pending = this.pendings[i] ?? new Map<number, (r: PatchGeomResult | null) => void>();
      this.pendings[i] = pending;
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number } & PatchGeomResult;
        if (msg.type !== "result") return;
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb?.(msg);
      };
      w.onerror = () => {
        console.warn(`[CoarsePatch] Worker#${i} 异常终止，该归属 chunk 回退主线程同步`);
        this.brokenStates[i] = true;
        this.workers[i] = null;
        const cbs = [...pending.values()];
        pending.clear();
        for (const cb of cbs) cb(null);
      };
      this.workers[i] = w;
      return w;
    } catch {
      this.brokenStates[i] = true;
      return null;
    }
  }

  private ensureAll(): void {
    for (let i = 0; i < CoarsePatchService.WORKER_COUNT; i++) this.ensure(i);
  }

  /** ★ 清空粗池静态源缓存（切风格/dispose 元数据换代时调用；主线程回退与 worker 同清） */
  clearCaches(): void {
    dropPatchSourceCache();
    for (let i = 0; i < CoarsePatchService.WORKER_COUNT; i++) {
      this.workers[i]?.postMessage({ type: "clearCache" });
    }
  }

  private pickLeastBusy(): number {
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < CoarsePatchService.WORKER_COUNT; i++) {
      if (!this.workers[i]) continue;
      const cost = this.pendings[i]?.size ?? 0;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  /** ★ 请求粗块几何（3×3 邻域拷贝 → worker/主线程同函数 coarse=true） */
  compute(
    req: { seed: number; cx: number; cz: number },
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): Promise<PatchGeomResult | null> {
    const { seed, cx, cz } = req;
    const chunks: CoarseChunkData[] = [];
    for (const dz of NEI) {
      for (const dx of NEI) {
        const d = readChunk(cx + dx, cz + dz);
        if (!d) continue;
        chunks.push({
          ccx: cx + dx, ccz: cz + dz,
          heights: new Float32Array(d.heights),
          blockTypes: new Uint8Array(d.blockTypes),
        });
      }
    }
    this.ensureAll();
    const i = this.pickLeastBusy();
    const w = i >= 0 ? this.workers[i] : null;
    if (!w) {
      // 主线程回退：同一纯函数（粗模式）
      return Promise.resolve(
        computeTableGeometry(readChunk, seed, cx, cz, undefined, null, null, undefined, true),
      );
    }
    const id = this.nextIds[i] = (this.nextIds[i] ?? 0) + 1;
    return new Promise((resolve) => {
      const pending = this.pendings[i] ?? new Map<number, (r: PatchGeomResult | null) => void>();
      this.pendings[i] = pending;
      pending.set(id, resolve);
      const transfer: ArrayBuffer[] = [];
      for (const c of chunks) transfer.push(c.heights.buffer, c.blockTypes.buffer);
      w.postMessage({ type: "coarseBuild", id, seed, cx, cz, chunks }, transfer);
    });
  }
}

/** 全局唯一实例（与 terrainPatch 同款单例风格；独立 worker 池） */
export const coarsePatch = new CoarsePatchService();
