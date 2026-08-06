// ============================================================
// BFS 区域检测 Worker Pool（单例）
// ============================================================
// 职责：
//   1. 懒创建 Worker（失败则永久降级到主线程同步执行）
//   2. taskId 管理：新任务到来时 abort 旧任务（reject 旧 Promise + 发 abort 消息）
//   3. 过期响应丢弃：onmessage 时比对 taskId，不匹配则丢弃
//   4. 降级 fallbackMain：Worker 不可用时主线程同步执行（保持 await 语义，仅主线程卡顿）
//
// 使用：const resp = await regionWorkerPool.detect(req);

import type { RegionDetectionRequest, RegionDetectionResponse } from '../types/regionWorker';
import { computeRegionsAndGrid } from '../utils/regionDetectionExact';

class RegionWorkerPool {
  private worker: Worker | null = null;
  /** Worker 创建失败标记（true = 永久降级，不再尝试创建） */
  private workerInitFailed = false;
  /** 当前 pending 任务 ID（null = 无 pending） */
  private pendingTaskId: string | null = null;
  private pendingResolver: ((r: RegionDetectionResponse) => void) | null = null;
  private pendingRejecter: ((e: unknown) => void) | null = null;

  /** 懒创建 Worker，失败返回 null（触发降级） */
  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerInitFailed) return null;
    try {
      const worker = new Worker(
        new URL('../utils/regionDetection.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<RegionDetectionResponse>) => {
        const resp = e.data;
        // ★ 仅当 taskId 匹配当前 pending 时 resolve（过期响应丢弃）
        if (resp.taskId === this.pendingTaskId && this.pendingResolver) {
          const resolver = this.pendingResolver;
          this.pendingTaskId = null;
          this.pendingResolver = null;
          this.pendingRejecter = null;
          resolver(resp);
        }
      };
      worker.onerror = (e) => {
        console.warn('[regionWorker] Worker 运行错误，降级到主线程', e);
        this.workerInitFailed = true;
        this.worker = null;
        if (this.pendingRejecter) {
          this.pendingRejecter(new Error('worker runtime error'));
          this.pendingTaskId = null;
          this.pendingResolver = null;
          this.pendingRejecter = null;
        }
      };
      this.worker = worker;
      console.log('[regionWorker] ✅ Worker 创建成功');
      return worker;
    } catch (e) {
      console.warn('[regionWorker] Worker 创建失败，降级到主线程同步执行', e);
      this.workerInitFailed = true;
      return null;
    }
  }

  /**
   * 提交检测任务。新任务到来会 abort 旧任务（reject 旧 Promise）。
   * Worker 不可用时走 fallbackMain（主线程同步，包成 resolved Promise）。
   */
  async detect(req: RegionDetectionRequest): Promise<RegionDetectionResponse> {
    // 1. 中止旧任务（如果有 pending）
    if (this.pendingTaskId !== null) {
      if (this.worker) {
        this.worker.postMessage({ type: 'abort', taskId: this.pendingTaskId });
      }
      // 旧任务 reject —— 调用方（refreshRegionCache）需 try/catch
      if (this.pendingRejecter) {
        this.pendingRejecter(new Error('aborted'));
      }
      this.pendingTaskId = null;
      this.pendingResolver = null;
      this.pendingRejecter = null;
    }

    // 2. 确保 Worker（降级则同步执行）
    const worker = this.ensureWorker();
    if (!worker) {
      return this.fallbackMain(req);
    }

    // 3. 正常路径：Worker 异步执行
    return new Promise<RegionDetectionResponse>((resolve, reject) => {
      this.pendingTaskId = req.taskId;
      this.pendingResolver = resolve;
      this.pendingRejecter = reject;
      worker.postMessage(req);
    });
  }

  /**
   * 降级：主线程同步执行 computeRegionsAndGrid + 扁平化。
   * 返回 RegionDetectionResponse（同步），detect 包成 resolved Promise，调用方 await 无感。
   * ★ 与 worker 保持一致：flatRegionGrid 已重映射为 i+1（与旧 generateRegionIdTexture 方案一致）。
   */
  private fallbackMain(req: RegionDetectionRequest): RegionDetectionResponse {
    const t0 = performance.now();
    const { regions, gridData, regionGridIds } = computeRegionsAndGrid(
      req.shapes, req.worldBounds, req.resolution, req.excludeColor,
    );
    // ★ 重映射 gridId → i+1（与 worker 一致）
    const gridIdToRegionId = new Map<number, number>();
    for (let i = 0; i < regionGridIds.length; i++) {
      gridIdToRegionId.set(regionGridIds[i], i + 1);
    }
    const { regionIdGrid, stepX, stepY, xMin, yMin, resolution } = gridData;
    const gridHeight = regionIdGrid.length;
    const gridWidth = gridHeight > 0 ? regionIdGrid[0].length : 0;
    const flatRegionGrid = new Int32Array(gridWidth * gridHeight);
    let wallPixelCount = 0;
    for (let gy = 0; gy < gridHeight; gy++) {
      const row = regionIdGrid[gy];
      const base = gy * gridWidth;
      for (let gx = 0; gx < gridWidth; gx++) {
        const rawId = row[gx];
        if (rawId < 0) {
          wallPixelCount++;
          flatRegionGrid[base + gx] = 0;
        } else if (rawId > 0) {
          flatRegionGrid[base + gx] = gridIdToRegionId.get(rawId) ?? 0;
        } else {
          flatRegionGrid[base + gx] = 0;
        }
      }
    }
    return {
      taskId: req.taskId,
      layerId: req.layerId,
      regions,
      flatRegionGrid,
      gridWidth,
      gridHeight,
      stepX, stepY, xMin, yMin, resolution,
      stats: {
        regionCount: regions.length,
        wallPixelCount,
        elapsedMs: performance.now() - t0,
      },
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pendingTaskId = null;
    this.pendingResolver = null;
    this.pendingRejecter = null;
  }
}

/** 单例 */
export const regionWorkerPool = new RegionWorkerPool();
