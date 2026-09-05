// ============================================================
// terrainPatch.worker —— 地块破坏（R+P）几何 Worker 入口
// ============================================================
// 收 chunk 邻域数组拷贝 + 补丁掩码 → 纯表驱动几何生成（computeTableGeometry）→
// 回传可转移 typed arrays（零拷贝 transfer）。主线程只做 BufferGeometry/材质/物理装配。
// 本文件不 import three。失败语义由 TerrainPatch 服务管理（onerror → 主线程回退）。
// 微信小游戏：与 terrainBake.worker 同适配点。
// ============================================================

import { computeTableGeometry, type PatchGeomResult } from "./PatchCompute";

interface PatchChunkMsg {
  type: "patchBuild";
  id: number;
  seed: number;
  cx: number;
  cz: number;
  mask: Uint8Array;
  chunks: {
    ccx: number;
    ccz: number;
    heights: Float32Array;
    blockTypes: Uint8Array;
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
  push(r.top.colors); push(r.top.indices);
  push(r.wall.vertices); push(r.wall.normals); push(r.wall.uvs);
  push(r.wall.colors); push(r.wall.shade); push(r.wall.indices);
  return out;
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as PatchChunkMsg;
  if (msg.type !== "patchBuild") return;
  const chunks = new Map<string, { heights: Float32Array; blockTypes: Uint8Array }>();
  for (const c of msg.chunks) chunks.set(`${c.ccx},${c.ccz}`, c);
  const mask = msg.mask && msg.mask.length > 0 ? msg.mask : undefined;
  const out = computeTableGeometry(
    (ccx, ccz) => chunks.get(`${ccx},${ccz}`),
    msg.seed,
    msg.cx,
    msg.cz,
    mask,
  );
  ctx.postMessage(
    { type: "result", id: msg.id, ...out },
    transferOf(out),
  );
};
