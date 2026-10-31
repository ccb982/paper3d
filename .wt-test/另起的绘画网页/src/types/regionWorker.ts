import type { Point, Shape } from './index';

// ============================================================
// BFS 区域检测 Worker 通信契约（主线程 ↔ regionDetection.worker.ts）
// ============================================================
// regionDetectionExact.ts 是纯数学（无 DOM/Canvas/earcut），可直接在 Worker 内执行。
// 主线程发送请求 → Worker 执行 computeRegionsAndGrid（一次 BFS）→ 返回 regions + 扁平化 grid。
// flatRegionGrid 走 transferList 零拷贝（Int32Array.buffer）。

/** 主线程 → Worker：检测请求 */
export interface RegionDetectionRequest {
  /** 唯一任务 ID，用于识别过期返回（主线程快速连续触发时丢弃旧任务） */
  taskId: string;
  /** 图层 ID（响应原样回传，便于主线程定位缓存） */
  layerId: string;
  /** BFS 网格分辨率（如 800，范围 200~3000） */
  resolution: number;
  /** 该图层的所有形状（Shape 全是可克隆原始字段，直接 structuredClone） */
  shapes: Shape[];
  /** BFS 世界边界（固定 BFS_WORLD_BOUNDS） */
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** 排除的颜色（'#ffaa00' = 虚线，不参与实线区域检测） */
  excludeColor: string;
}

/** Worker → 主线程：检测响应 */
export interface RegionDetectionResponse {
  taskId: string;
  layerId: string;
  /** 区域多边形（外环 + 内环），走 structuredClone（数据量小） */
  regions: Point[][][];
  /** ★ 扁平化 regionIdGrid（一维 Int32Array，transferable 零拷贝） */
  flatRegionGrid: Int32Array;
  /** 网格宽度（= resolution） */
  gridWidth: number;
  /** 网格高度（= resolution） */
  gridHeight: number;
  /** gridData 元信息（主线程降采样到 512×512 regionIdTexture 用） */
  stepX: number;
  stepY: number;
  xMin: number;
  yMin: number;
  resolution: number;
  /** 可选调试统计 */
  stats?: {
    regionCount: number;
    wallPixelCount: number;
    elapsedMs: number;
  };
}

/** 主线程 → Worker：中止当前任务（Worker 在 BFS 开始前检查 abort 标志） */
export interface RegionDetectionAbortMessage {
  type: 'abort';
  taskId: string;
}

/** Worker 收到的消息联合类型 */
export type RegionWorkerInbound = RegionDetectionRequest | RegionDetectionAbortMessage;
