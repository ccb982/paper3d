// ============================================================
// oceanBake.worker —— 预计算 FFT 海况场 Worker 入口
// ============================================================
// 启动期的整场海况烘焙（3 层 × 2 变体，每层 3 次 2D-IFFT）是主线程一次明显
// 卡顿源（在 WaterMaterial 模块首次导入时同步触发）。该计算为纯 Float32Array
// 运算（WaterFFT 无 three 依赖），完整挪进 Worker；主线程只做 DataTexture 打包。
// 失败语义由 OceanBaker 服务管理（onerror → 主线程同步 bakeOceanField 回退）。
// 微信小游戏：与 terrainBake.worker 同适配点。
// ============================================================

import { bakeOceanField, defaultOceanParams, type OceanTile } from "./WaterFFT";

interface OceanBakeMsg {
  type: "oceanBake";
  id: number;
  seed: number;
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as OceanBakeMsg;
  if (msg.type !== "oceanBake") return;
  const tileLayers = bakeOceanField(defaultOceanParams(msg.seed));
  // 结构拷贝（层 × 变体；typed array 本体零拷贝 transfer）
  const layers = tileLayers.map((layer) =>
    layer.map((tile) => ({ h: tile.h, d: tile.d, n: tile.n })),
  ) as OceanTile[][];
  const transfer: ArrayBuffer[] = [];
  for (const layer of layers) {
    for (const t of layer) {
      transfer.push(t.h.buffer, t.d.buffer, t.n.buffer);
    }
  }
  ctx.postMessage({ type: "oceanResult", id: msg.id, layers }, transfer);
};