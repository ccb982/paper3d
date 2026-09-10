// ============================================================
// terrainPatch.worker —— 地块破坏（R+P）几何 Worker 入口
// ============================================================
// 收 chunk 邻域数组拷贝 + 补丁掩码 → 纯表驱动几何生成（computeTableGeometry）→
// 回传可转移 typed arrays（零拷贝 transfer）。主线程只做 BufferGeometry/材质/物理装配。
// 本文件不 import three。失败语义由 TerrainPatch 服务管理（onerror → 主线程回退）。
// 微信小游戏：与 terrainBake.worker 同适配点。
// ============================================================

import { computeTableGeometry, incrementalDropCache, type PatchGeomResult } from "./PatchCompute";
import { CHUNK_SIZE } from "./ChunkGenerator";

interface PatchChunkMsg {
  type: "patchBuild";
  id: number;
  seed: number;
  cx: number;
  cz: number;
  levels: Uint8Array;
  /** 本次 dig 直接挖到的世界 4m 块 key（水体重建增量）；null = 全量 */
  dirty: number[] | null;
  /** ★ 主线程（CPU 侧）预算的受影响掩码（top+side）；缺省 = Worker 就地算 */
  masks: { top: Uint8Array; side: Uint8Array } | null;
  chunks: {
    ccx: number;
    ccz: number;
    heights: Float32Array;
    blockTypes: Uint8Array;
    /** ★ 补丁层数表（跨 chunk 包络场查询用） */
    levels?: Uint8Array;
  }[];
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

function transferOf(r: PatchGeomResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const push = (a: ArrayBuffer | ArrayBufferView | null) => {
    if (a && (a as ArrayBufferView).buffer !== undefined) {
      out.push((a as ArrayBufferView).buffer as ArrayBuffer);
    } else if (a) out.push(a as ArrayBuffer);
  };
  push(r.top.vertices); push(r.top.normals); push(r.top.uvs);
  push(r.top.colors); push(r.top.patchW); push(r.top.indices);
  push(r.wall.vertices); push(r.wall.normals); push(r.wall.uvs);
  push(r.wall.colors); push(r.wall.shade); push(r.wall.patchW); push(r.wall.indices);
  push(r.water.vertices); push(r.water.normals); push(r.water.uvs);
  push(r.water.deep); push(r.water.spin); push(r.water.indices);
  for (const c of r.cells) { push(c.vertices); push(c.indices); } // ★ 物理分区
  return out;
}

ctx.onmessage = (ev: MessageEvent) => {
  if ((ev.data as { type?: string }).type === "clearCache") {
    incrementalDropCache();
    return;
  }
  const msg = ev.data as PatchChunkMsg;
  if (msg.type !== "patchBuild") return;
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
  const out = computeTableGeometry(
    (ccx, ccz) => chunks.get(`${ccx},${ccz}`),
    msg.seed,
    msg.cx,
    msg.cz,
    levels,
    msg.dirty ?? null,
    msg.masks,
    levelAt,
  );
  ctx.postMessage(
    { type: "result", id: msg.id, ...out },
    transferOf(out),
  );
};
