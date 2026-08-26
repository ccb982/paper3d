// ============================================================
// TerrainBaker —— 地形烘焙异步服务（Worker 后台 + 主线程同步回退）
// ============================================================
// 职责：把双纹理烘焙的重计算（raymarch 阴影 / AO / 像素循环）
//   移出主线程。WorldMode 是唯一消费方。
//
// 流程：
//   request(getChunk, seed, cx, cz)
//     ├─ 主线程：buildSnapshotFromChunks（拷 chunk 原始数组，亚毫秒）
//     ├─ 有 Worker → postMessage(transfer) → resolve(RGBA 缓冲)
//     └─ 无 Worker / onerror → resolve(null) → 调用方走 bakeChunkMaps 同步回退
//
// ★ 失败语义：resolve(null) 一律表示「请回退同步」，不 reject——
//   调用方只需一条回退路径。onerror 后本服务标记 broken，
//   本进程内不再重试（避免每次请求都撞同一堵墙）。
//
// ★ 微信小游戏适配点：ensure() 里换 wx.createWorker(...) 即可
//   （worker 源码需入分包；计算层 bakeCompute 不用动）。
// ============================================================

import { buildSnapshotFromChunks, type ChunkDataLite } from './bakeCompute';

/** 烘焙结果（RGBA 像素；来自 Worker 的视图，零拷贝） */
export interface BakeResult {
  albedo: Uint8ClampedArray;
  light: Uint8ClampedArray;
}

class TerrainBakerService {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private pending = new Map<number, (r: BakeResult | null) => void>();

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken) return null;
    try {
      // ★ 微信小游戏适配点：替换为 wx.createWorker('workers/terrainBake.js')
      const w = new Worker(new URL('./terrainBake.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number; albedo?: ArrayBuffer; light?: ArrayBuffer };
        if (msg.type !== 'result') return;
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!cb || !msg.albedo || !msg.light) return;
        cb({
          albedo: new Uint8ClampedArray(msg.albedo),
          light: new Uint8ClampedArray(msg.light),
        });
      };
      w.onerror = () => {
        // 脚本加载失败等致命错误：全部挂起请求转同步回退
        console.warn('[TerrainBaker] Worker 异常终止，后续烘焙回退主线程同步');
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
   * 请求异步烘焙一个 chunk。
   * @param getChunk 取 chunk 原始数据（RasterMap.getChunkData 天然满足；
   *                 快照只读不写，跨天 clearAll 后由调用方重新请求即可）
   * @returns resolve(null) = Worker 不可用/失败，调用方走主线程同步回退
   */
  request(
    getChunk: (cx: number, cz: number) => ChunkDataLite | undefined,
    seed: number,
    cx: number,
    cz: number,
  ): Promise<BakeResult | null> {
    const snap = buildSnapshotFromChunks(seed, cx, cz, getChunk);
    const w = this.ensure();
    if (!w) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      // vHeights/blockIds 缓冲转移所有权（零拷贝；snap 对象此后不可复用）
      w.postMessage(
        { type: 'bake', id, snap },
        [snap.vHeights.buffer, snap.blockIds.buffer],
      );
    });
  }
}

/** 全局唯一实例（与 renderManager/eventBus 同款单例风格；跨模式存活保温） */
export const terrainBaker = new TerrainBakerService();
