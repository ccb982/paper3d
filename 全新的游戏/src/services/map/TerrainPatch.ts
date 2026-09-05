// ============================================================
// TerrainPatch —— 地块破坏（R+P）几何异步服务（Worker 后台 + 主线程同步回退）
// ============================================================
// 职责：把「表 + 双 builder」的整 chunk 几何生成移出主线程（命中地面时的最大
// 单帧成本）。数据面 = 3×3 邻域 chunk 的 heights/blockTypes 拷贝（每份 ~135KB，
// memcpy 微秒级）→ postMessage(transfer) → Worker 纯计算 → 零拷贝回传。
//
// 流程：
//   compute({seed, cx, cz, mask}, readChunk)
//     ├─ 主线程：拷 3×3 邻域数组（不转移活数组所有权）
//     ├─ 有 Worker → postMessage(transfer) → resolve(几何字节)
//     ├─ Worker onerror/broken → 主线程同步 computeTableGeometry（同函数同字节）
//     └─ 计算失败 → resolve(null)（调用方走既有 requestStandardBake 兜底）
//
// ★ 字节一致由构造保证：Worker 用 makeChunkSource(拷贝闭包) + refineChunkSource
//   （seed,cx,cz），与主线程 RasterMap.chunkSource 同一函数同一输入 → 逐位一致
//   （验收 ⑧ 用"拷贝闭包 vs 活闭包"锁字节）。
// ★ 微信小游戏适配点：ensure() 换 wx.createWorker（与 TerrainBaker 相同）。
// ============================================================

import { computeTableGeometry, type PatchGeomResult } from "./PatchCompute";
import type { ChunkDataLite } from "./Refinements";

interface PatchChunkData {
  ccx: number;
  ccz: number;
  heights: Float32Array;
  blockTypes: Uint8Array;
}

const NEI = [-1, 0, 1];

class TerrainPatchService {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private pending = new Map<number, (r: PatchGeomResult | null) => void>();

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken) return null;
    try {
      const w = new Worker(new URL("./terrainPatch.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number } & PatchGeomResult;
        if (msg.type !== "result") return;
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!cb) return;
        cb(msg);
      };
      w.onerror = () => {
        console.warn("[TerrainPatch] Worker 异常终止，地块破坏几何回退主线程同步");
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

  /**
   * 计算带补丁掩码的 chunk 几何。
   * @returns 几何字节；Worker 失败 → resolve(null)，调用方走标准烘焙兜底。
   */
  compute(
    req: { seed: number; cx: number; cz: number; mask: Uint8Array | undefined },
    readChunk: (ccx: number, ccz: number) => ChunkDataLite | undefined,
  ): Promise<PatchGeomResult | null> {
    const { seed, cx, cz } = req;
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
        });
      }
    }
    const w = this.ensure();
    if (!w) {
      // 主线程同步回退：同一纯函数（readChunk 闭包直接用）
      return Promise.resolve(computeTableGeometry(readChunk, seed, cx, cz, req.mask));
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const transfer: ArrayBuffer[] = [];
      for (const c of chunks) {
        transfer.push(c.heights.buffer, c.blockTypes.buffer);
      }
      if (req.mask) transfer.push(req.mask.buffer);
      // 掩码所有权转移：调用方不得复用（ChunkManager 持有的是 patches 表本体，
      // 须传入拷贝——见 ChunkManager.patchRebuildChunk 的 mask 拷贝语义）
      w.postMessage(
        {
          type: "patchBuild",
          id,
          seed,
          cx,
          cz,
          mask: req.mask ?? new Uint8Array(0),
          chunks,
        },
        transfer,
      );
    });
  }
}

/** 全局唯一实例（与 terrainBaker 同款单例风格） */
export const terrainPatch = new TerrainPatchService();
