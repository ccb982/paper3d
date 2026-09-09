// ============================================================
// OceanBaker —— 海况场（FFT）烘焙异步服务（Worker 后台 + 主线程同步回退）
// ============================================================
// 职责：把启动期一次性整场海况烘焙（WaterFFT.bakeOceanField，3 层 × 2 变体，
//   每层 3 次 2D-IFFT + 位移/法线推导）移出主线程。WaterMaterial 是唯一消费方。
//
// 流程：
//   bake(seed)
//     ├─ 有 Worker → postMessage(seed) → transfer Float32Array 缓冲 → resolve(tiles)
//     └─ 无 Worker / onerror → resolve(null) → 调用方走 bakeOceanField 同步回退
//
// ★ 失败语义：resolve(null) 一律表示「请回退同步」，不 reject——
//   调用方只需一条回退路径。onerror 后本服务标记 broken，不再重试。
// ★ 微信小游戏适配点：ensure() 里换 wx.createWorker(...) 即可。
// ============================================================

import { type OceanTile } from "./WaterFFT";

class OceanBakerService {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private pending = new Map<number, (tiles: OceanTile[][] | null) => void>();

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.broken) return null;
    try {
      const w = new Worker(new URL("./oceanBake.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number; layers?: OceanTile[][] };
        if (msg.type !== "oceanResult") return;
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!cb || !msg.layers) return;
        cb(msg.layers);
      };
      w.onerror = () => {
        console.warn("[OceanBaker] Worker 异常终止，海况烘焙回退主线程同步");
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
   * 请求异步烘焙整场海况。
   * @param seed 确定性种子（与旧版同步烘焙同源 → 字节一致，无视觉变化）
   * @returns resolve(null) = Worker 不可用/失败，调用方走主线程同步回退
   */
  bake(seed: number): Promise<OceanTile[][] | null> {
    const w = this.ensure();
    if (!w) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      w.postMessage({ type: "oceanBake", id, seed });
    });
  }
}

/** 全局唯一实例（与 renderManager/eventBus 同款单例风格） */
export const oceanBaker = new OceanBakerService();