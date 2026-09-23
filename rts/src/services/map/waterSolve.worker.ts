// ============================================================
// waterSolve.worker —— 水体【专用】异步 Worker（2026-09-16 破坏/水体解耦）
// ============================================================
// 背景：原先水体求解（buildWaterSurface）与坑洞几何串行在同一个 terrainPatch
//   worker 调用内 → 打「有水 chunk」时，initSolve/updateSolve + 5cm 边界探针点阵
//   采样这一跳把整个几何返回拖慢 → 坑洞更新肉眼可见地卡。
//
// 本 worker 只做一件事：**慢慢算水面**，不参与坑洞几何的关键路径。
//   · 破坏重建走 waterMode:'none' → 坑洞几何（top/wall/物理）先出、先行装配；
//   · 水面随后由本 worker 补算，主线程收到后【只换水网格】（applyWaterResult）；
//   · 单 worker 串行队列 → 水永远不抢几何的核，也不阻塞坑洞。
//
// ★ 必须是【单个】worker（不可像 terrainPatch 那样开 3 个池）：
//   WaterSurface 的 waterStates 是模块级 Map（每 worker 一份增量状态：
//   occ/连通分量/边界探针/床面点阵缓存）。同一 chunk 若在不同 worker 间漂移，
//   状态会丢失 → 每次退化为 initSolve 全量重解，反而更慢。
//   单 worker = 状态亲缘稳定 = 连打同一 chunk 走 updateSolve 增量路径。
//
// ★ 与 terrainPatch worker 的缓存关系：两者各有自己的 patchSourceCache
//   （getRefinedSource 静态缓存）。本 worker 首次算某 chunk 需重跑精修源 +
//   buildFaceTable，之后命中自身缓存 —— 这与"慢慢算"的定位相容。
//
// 本文件不 import three。失败语义由 WaterSolve 服务管理（onerror → 主线程回退）。
// 微信小游戏：与 terrainPatch.worker 同适配点（wx.createWorker）。
// ============================================================

import { computeWaterOnly, incrementalDropCache, dropPatchSourceCache } from "./PatchCompute";
import type { WaterSurfaceRaw } from "./WaterSurface";
import { CHUNK_SIZE } from "./ChunkGenerator";

interface WaterSolveMsg {
  type: "waterSolve";
  id: number;
  seed: number;
  cx: number;
  cz: number;
  levels: Uint8Array;
  /** 本次 dig 直接挖到的世界 4m 块 key；null = 全量重解 */
  dirty: number[] | null;
  chunks: {
    ccx: number;
    ccz: number;
    heights: Float32Array;
    blockTypes: Uint8Array;
    levels?: Uint8Array;
  }[];
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

function transferOf(w: WaterSurfaceRaw): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const push = (a: ArrayBuffer | ArrayBufferView | null) => {
    if (a && (a as ArrayBufferView).buffer !== undefined) {
      out.push((a as ArrayBufferView).buffer as ArrayBuffer);
    } else if (a) out.push(a as ArrayBuffer);
  };
  push(w.vertices); push(w.normals); push(w.uvs);
  push(w.deep); push(w.spin); push(w.indices);
  return out;
}

ctx.onmessage = (ev: MessageEvent) => {
  if ((ev.data as { type?: string }).type === "clearCache") {
    incrementalDropCache();
    dropPatchSourceCache();
    return;
  }
  const msg = ev.data as WaterSolveMsg;
  if (msg.type !== "waterSolve") return;
  const chunks = new Map<string, { heights: Float32Array; blockTypes: Uint8Array; levels?: Uint8Array }>();
  for (const c of msg.chunks) chunks.set(`${c.ccx},${c.ccz}`, c);
  // ★ 跨 chunk 层数查询（世界 1m cell 下标 → 层数；未加载 = 0）
  const levelAt = (wx: number, wz: number): number => {
    const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
    const c = chunks.get(`${ccx},${ccz}`);
    if (!c?.levels) return 0;
    const lx = wx - ccx * CHUNK_SIZE, lz = wz - ccz * CHUNK_SIZE;
    return c.levels[lz * CHUNK_SIZE + lx] ?? 0;
  };
  const levels = msg.levels && msg.levels.length > 0 ? msg.levels : undefined;
  const water = computeWaterOnly(
    (ccx, ccz) => chunks.get(`${ccx},${ccz}`),
    msg.seed,
    msg.cx,
    msg.cz,
    levels,
    msg.dirty ?? null,
    levelAt,
  );
  ctx.postMessage({ type: "result", id: msg.id, water }, transferOf(water));
};
