// ============================================================
// BFS 区域检测 Worker
// ============================================================
// 在 Worker 线程执行 computeRegionsAndGrid（光栅化 → 洪水填充 → BFS → 边界点 → 环拼接），
// 把主线程从 800×800 BFS 的数百毫秒阻塞中解放出来。
//
// 通信契约见 src/types/regionWorker.ts。
// flatRegionGrid (Int32Array) 走 transferList 零拷贝移交主线程。

/// <reference lib="webworker" />

import { computeRegionsAndGrid } from './regionDetectionExact';
import type {
  RegionWorkerInbound,
  RegionDetectionRequest,
  RegionDetectionResponse,
} from '../types/regionWorker';

/** 当前任务是否应中止（主线程发 abort 消息时置 true） */
let shouldAbort = false;
/** 当前正在执行的任务 ID（用于 abort 消息匹配） */
let currentTaskId: string | null = null;

self.onmessage = (e: MessageEvent<RegionWorkerInbound>) => {
  const msg = e.data;

  // ===== abort 消息 =====
  if ('type' in msg && msg.type === 'abort') {
    if (msg.taskId === currentTaskId) {
      shouldAbort = true;
    }
    return;
  }

  // ===== 检测请求 =====
  const req = msg as RegionDetectionRequest;
  currentTaskId = req.taskId;
  shouldAbort = false;

  const t0 = performance.now();

  // ★ BFS 开始前检查 abort（BFS 单次 <1s，开始前检查足够）
  if (shouldAbort) return;

  // ★ 一次 BFS 同时产出 regions + gridData + regionGridIds（避免重复计算）
  const { regions, gridData, regionGridIds } = computeRegionsAndGrid(
    req.shapes,
    req.worldBounds,
    req.resolution,
    req.excludeColor,
  );

  // BFS 完成后再次检查（若期间收到 abort，丢弃结果不发）
  if (shouldAbort) return;

  // ===== 扁平化 regionIdGrid (number[][]) → Int32Array（transferable） =====
  // ★ 重映射：原始 BFS gridId → i+1（regionGridIds[i] 对应 regions[i]）。
  //   这样主线程降采样得到的 regionIdTexture 与旧 generateRegionIdTexture 的 i+1 方案完全一致，
  //   保证 regionPixelsMap 键、colorExtractRegionId 比较不回归。
  //   未保留的 region（touchEdge / 太小 / 未成环）gridId 不在 regionGridIds 中 → 映射为 0。
  const gridIdToRegionId = new Map<number, number>();
  for (let i = 0; i < regionGridIds.length; i++) {
    gridIdToRegionId.set(regionGridIds[i], i + 1); // 1-based，与旧 generateRegionTexture 一致
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
        wallPixelCount++; // 负值 = 墙区域（统计用，不写入纹理）
        flatRegionGrid[base + gx] = 0;
      } else if (rawId > 0) {
        // 正值 = BFS region，重映射为 i+1（保留 region）或 0（被过滤掉的 region）
        flatRegionGrid[base + gx] = gridIdToRegionId.get(rawId) ?? 0;
      } else {
        flatRegionGrid[base + gx] = 0; // 0 = 空
      }
    }
  }

  const elapsedMs = performance.now() - t0;

  const resp: RegionDetectionResponse = {
    taskId: req.taskId,
    layerId: req.layerId,
    regions,
    flatRegionGrid,
    gridWidth,
    gridHeight,
    stepX,
    stepY,
    xMin,
    yMin,
    resolution,
    stats: {
      regionCount: regions.length,
      wallPixelCount,
      elapsedMs,
    },
  };

  // ★ transferList：flatRegionGrid.buffer 零拷贝移交，Worker 端自动释放
  (self as unknown as Worker).postMessage(resp, [flatRegionGrid.buffer]);
};
