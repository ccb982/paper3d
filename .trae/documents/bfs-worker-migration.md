# BFS 区域检测迁移到 Web Worker

## Context

`refreshRegionCache`（[useAppStore.ts:1088](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/stores/useAppStore.ts#L1088)）当前在主线程**同步**执行 BFS 区域检测，在 `bfsResolution=800`（默认，范围 200-3000）下会阻塞主线程数百毫秒到数秒。用户增删形状、撤销/重做、切换图层、擦除时都会触发，导致明显卡顿。

目标：把 `computeGridRegions` + `computeRegionsExact` 的全链路（光栅化 → 洪水填充 → BFS 主区域标记 → 小区域合并 → 边界点收集 → 环拼接简化）迁移到 Web Worker，主线程仅保留 regionIdTexture 降采样（512×512）和下游缓存刷新。

## 已确认的关键事实

- [regionDetectionExact.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/utils/regionDetectionExact.ts) **纯数学**，只 `import type { Point, Shape }`，无 DOM/Canvas/earcut，可直接搬入 Worker
- `computeRegionsExact`（第 961 行）内部第 967 行又调了 `computeGridRegions` → 当前 `refreshRegionCache` 实际跑了 **2 次** 800×800 BFS（第 1095 + 1097 行），是重大浪费
- `computeScanlineIntervals`（第 1263 行）是 no-op（返回 `{}`），可忽略
- `GridData.regionIdGrid` 是 `number[][]` 二维数组，Worker 返回需扁平化为 `Int32Array`（transferable 零拷贝）
- `refreshColorBlockCache`（[useAppStore.ts:1152](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/stores/useAppStore.ts#L1152)）和 `refreshRegionEntities`（[useAppStore.ts:1376](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/stores/useAppStore.ts#L1376)）都**同步读** `regionPolygonsCache[layerId]`，是异步化最大风险点
- Vite 4.x 原生支持 `new Worker(new URL(...), { type: 'module' })`，无需额外配置

## 架构设计

### 文件结构

```
src/
├─ utils/
│  └─ regionDetection.worker.ts      ← 新建：Worker 入口，import regionDetectionExact 的函数
├─ stores/
│  └─ regionWorkerPool.ts            ← 新建：单例 Worker 管理 + taskId + abort + 降级
└─ types/
   └─ regionWorker.ts                ← 新建：请求/响应类型契约（共享类型）
```

修改文件：
- [useAppStore.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/stores/useAppStore.ts)：`refreshRegionCache` 改异步
- [regionDetectionExact.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/utils/regionDetectionExact.ts)：新增 `computeRegionsAndGrid`（合并函数，避免重复 BFS）
- 4 处硬同步调用点（见风险章节）

### 通信协议

**请求**（主线程 → Worker）：
```typescript
interface RegionDetectionRequest {
  taskId: string;
  layerId: string;
  resolution: number;
  shapes: Array<{ id: string; type: string; color: string; points: Point[] }>;
  worldBounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  excludeColor: string;
}
```

**响应**（Worker → 主线程）：
```typescript
interface RegionDetectionResponse {
  taskId: string;
  layerId: string;
  regions: Point[][][];           // structuredClone（数据量小）
  flatRegionGrid: Int32Array;     // ★ transferable 零拷贝（resolution² × 4 字节）
  gridWidth: number;              // = resolution
  gridHeight: number;
  stepX: number; stepY: number; xMin: number; yMin: number; resolution: number;
  stats?: { regionCount: number; wallPixelCount: number; elapsedMs: number };
}
```

`postMessage` 时 `transferList = [flatRegionGrid.buffer]`。

### regionDetection.worker.ts 内部

1. `onmessage` 收到请求，先存 `currentTaskId`
2. 调用新增的 `computeRegionsAndGrid(shapes, worldBounds, resolution, excludeColor)` —— **一次** BFS 同时产出 regions + gridData
3. 把 `gridData.regionIdGrid`（number[][]）扁平化为 `Int32Array`（`flat[gy * gridWidth + gx] = regionIdGrid[gy][gx]`）
4. `postMessage` 响应 + transferList
5. abort 机制：主线程发 `{ type: 'abort', taskId }`，Worker 在 BFS 大循环开始前检查 `shouldAbort` 标志，若 true 则提前 return（不发响应）

### regionWorkerPool.ts 设计

```typescript
class RegionWorkerPool {
  private worker: Worker | null;
  private pendingTaskId: string | null = null;
  private pendingResolver: ((r: RegionDetectionResponse) => void) | null = null;
  private fallbackMain: (req) => RegionDetectionResponse;  // 降级同步执行

  async detect(req: RegionDetectionRequest): Promise<RegionDetectionResponse> {
    // 1. 旧任务 abort：发 abort 消息，丢弃旧 resolver
    // 2. 生成新 taskId，存 pendingTaskId
    // 3. 若 worker 为 null → 调 fallbackMain（同步，包成 Promise）
    // 4. worker.postMessage(req)
    // 5. 返回 Promise（onmessage 时比对 taskId，过期则丢弃）
  }
}
export const regionWorkerPool = new RegionWorkerPool();
```

- **单例**：全局一个 Worker（BFS 串行，避免并发抢内存）
- **降级**：Worker 创建失败（`new Worker` 抛错）→ `worker = null`，`detect()` 走 `fallbackMain`（直接同步调 `computeRegionsAndGrid` + 扁平化，主线程卡顿但功能正常）
- **超时**：可选 5s 超时 → 走降级（首版可不加，降级已够）

### computeRegionsAndGrid（新增合并函数）

在 [regionDetectionExact.ts](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/utils/regionDetectionExact.ts) 第 961 行 `computeRegionsExact` 旁新增：
```typescript
export function computeRegionsAndGrid(shapes, worldBounds, resolution, excludeColor): {
  regions: Point[][][];
  gridData: GridData;  // 复用，不重复 BFS
}
```
内部：调一次 `computeGridRegions` → gridData，再在**同一 gridData** 上做边界点收集 + 环拼接（提取 `computeRegionsExact` 第 967 行之后的逻辑），避免第二次 BFS。

### refreshRegionCache 异步化（核心）

改造成返回 `Promise<void>`，内部管线：
```typescript
refreshRegionCache: async (layerId, options?) => {
  const state = get();
  const shapes = extractSerializableShapes(state.shapes, layerId);
  const req: RegionDetectionRequest = { taskId: genId(), layerId, resolution: state.bfsResolution, shapes, worldBounds: BFS_WORLD_BOUNDS, excludeColor: '#ffaa00' };

  // clearPaintData 时机不变（Worker 计算前同步清，避免 Worker 返回前用户看到旧画笔）
  if (options?.clearPaintData !== false) {
    state.clearPaintBuffer(layerId);
    state.clearRegionPixels();
  }

  // ★ 检测期间标记 isComputing（UI 可选显示）
  set((s) => ({ isComputingRegions: { ...s.isComputingRegions, [layerId]: true } }));

  let resp: RegionDetectionResponse;
  try {
    resp = await regionWorkerPool.detect(req);
  } catch {
    // 降级失败兜底：静默返回，保持旧 cache
    set((s) => ({ isComputingRegions: { ...s.isComputingRegions, [layerId]: false } }));
    return;
  }

  // ★ taskId 过期检查（pool 已保证，双保险）
  if (resp.taskId !== req.taskId) return;

  // 主线程后续工作（全部同步，但 BFS 大头已卸载）
  // 1. 更新 regionPolygonsCache
  set((s) => ({ regionPolygonsCache: { ...s.regionPolygonsCache, [layerId]: resp.regions } }));

  // 2. 从 flatRegionGrid 降采样到 512×512 regionIdTexture
  const regionIdMap = downsampleRegionGrid(resp.flatRegionGrid, resp.gridWidth, resp.gridHeight, resp.stepX, resp.stepY, resp.xMin, resp.yMin, resp.resolution);
  set((s) => ({ regionIdTexture: new Map(s.regionIdTexture).set(layerId, regionIdMap) }));

  // 3. ★ 下游刷新纳入管线内部（解决同步依赖风险）
  get().refreshColorBlockCache(layerId);   // 读 regionPolygonsCache（已是新值）
  get().refreshRegionEntities(layerId);    // 同上

  // 4. 关闭 isComputing
  set((s) => ({ isComputingRegions: { ...s.isComputingRegions, [layerId]: false } }));
}
```

`downsampleRegionGrid` 即原第 1119-1138 行逻辑，改为从 `Int32Array`（`flat[gy * gridWidth + gx]`）读取。

## 风险与对策

### 风险 1：下游同步读 cache（最大风险）
`refreshColorBlockCache` / `refreshRegionEntities` 紧跟 `refreshRegionCache` 之后被外部调用，会读到旧 cache。
**对策**：把它们纳入 `refreshRegionCache` 异步管线**内部**（Worker 返回后按序调用）。外部冗余调用保持幂等（读最新 cache，无副作用）。5 处 `setTimeout(() => { refreshRegionCache; refreshColorBlockCache; refreshRegionEntities; })` 模式可简化为 `void refreshRegionCache(...)`。

### 风险 2：4 处硬同步调用方需 await
以下调用方在 `refreshRegionCache` 后立即读 cache/纹理，必须改 `await`：
- [MainCanvas.tsx:1699](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/components/MainCanvas.tsx#L1699) `syncRefreshRegion`：调 `refreshRegionCache` 后立即 `generateRegionIdTexture` → 改 `await refreshRegionCache(...)`，且 `generateRegionIdTexture` 可能冗余（refreshRegionCache 内部已生成 regionIdTexture），实施时确认是否可删
- [Toolbar.tsx:435](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/components/Toolbar.tsx#L435) 附近
- [MaskEffectPanel.tsx:405](file:///c:/Users/22641/Desktop/架构重置/另起的绘画网页/src/components/MaskEffectPanel.tsx#L405) 和 441 附近（读 `getState().regionEntities`）
- useAppStore undo/redo：依赖 `isRestoringHistory` 在所有 layer 完成后才清除 → 需 `await Promise.all(layers.map(refreshRegionCache))`

**对策**：逐一改 `await`。对无法 await 的回调（如 React 事件处理），用 `void refreshRegionCache(...).then(() => {...})`。

### 风险 3：空窗期（Worker 返回前）
Worker 计算期间 regionPolygonsCache 是旧值，用户可能看到旧区域边界。
**对策**：可接受（Worker 800×800 通常 <100ms）。若需严格，`isComputingRegions` 标记可让 UI 显示"计算中"。

### 风险 4：abort 机制
Worker 内 BFS 是紧密循环，无法中途打断。
**对策**：主线程 `pendingTaskId` 比对 —— 旧任务的响应到达时 `taskId !== pendingTaskId` 直接丢弃，Worker 内部 abort 标志在 BFS 阶段开始前检查（足够，BFS 单次 <1s）。

### 风险 5：内存
800×800 Int32Array = 2.5MB，transferable 零拷贝移交主线程，Worker 端自动释放。regions 数据量小（几十个多边形），structuredClone 开销可忽略。

## 实施步骤

1. **新增 `computeRegionsAndGrid`**（regionDetectionExact.ts）：从 `computeRegionsExact` 提取，一次 BFS 产 regions + gridData。可独立单测。
2. **新建 types/regionWorker.ts**：请求/响应类型契约。
3. **新建 regionDetection.worker.ts**：import `computeRegionsAndGrid`，扁平化 regionIdGrid，处理 abort 标志。
4. **新建 regionWorkerPool.ts**：单例 Worker + taskId 管理 + 降级。
5. **改造 refreshRegionCache**（useAppStore.ts:1088）：异步化 + 下游刷新纳入管线 + `downsampleRegionGrid` 改读 Int32Array。
6. **改 4 处硬同步调用点**：加 `await`。
7. **简化 5 处 setTimeout 模式**：`void refreshRegionCache(...)`（下游已纳入管线）。
8. **验证**。

## 验证

- **功能**：画虚线/实线 → 区域检测正确（与迁移前一致）；增删形状 → 区域实时更新；撤销/重做 → 区域恢复；切换图层 → 各图层区域独立
- **性能**：DevTools Performance 录制，800 分辨率下主线程不再有长 BFS 任务，Worker 线程承担；快速连续画线不卡顿（旧任务被丢弃）
- **降级**：临时让 `new Worker` 抛错（或 `worker = null`），确认 `fallbackMain` 同步执行，功能正常（仅主线程卡顿）
- **abort**：快速连续触发 5 次 refreshRegionCache，确认只采纳最后一次结果（console 打印 taskId 比对）
- **TS 编译**：`npx tsc --noEmit` 无新错误
- **边界**：空图层（无形状）→ Worker 返回空 regions + 全零 grid；全虚线（excludeColor 过滤）→ 空区域
