// ============================================================
// terrainBake.worker —— 地形烘焙 Worker 入口
// ============================================================
// 收快照（chunk 原始数组拷贝）→ 纯像素计算（bakeCompute）→
// 回传可转移 RGBA 缓冲（零拷贝 transfer，主线程组装成 CanvasTexture）。
// 本文件不 import three——保持 Worker 依赖最小。
// 微信小游戏：TerrainBaker 会尝试 module Worker，失败自动回退主线程；
// 后续接入 wx.createWorker 时替换本文件的加载方式即可（计算层不变）。
// ============================================================

import { makeSnapshotSource, computeChunkMapsRGBA, type BakeSnapshot } from './bakeCompute';

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { type: string; id: number; snap: BakeSnapshot };
  if (msg.type !== 'bake') return;
  const out = computeChunkMapsRGBA(makeSnapshotSource(msg.snap), msg.snap.cx, msg.snap.cz);
  ctx.postMessage(
    { type: 'result', id: msg.id, albedo: out.albedo.buffer, light: out.light.buffer },
    [out.albedo.buffer, out.light.buffer],
  );
};
