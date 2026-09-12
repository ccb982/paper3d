// ============================================================
// coarsePatch.worker —— 粗块几何 Worker（地图构建两级的第一级）
// ============================================================
// 收 3×3 邻域数据拷贝 → 纯表驱动几何（computeTableGeometry coarse=true：
// 硬边、纯色顶点色、无 fine/弧边/水面/物理）→ 零拷贝回传。
// 与 terrainPatch.worker（细化）分池，互不抢队列。

import { computeTableGeometry, dropPatchSourceCache, type PatchGeomResult } from "./PatchCompute";

interface CoarseChunkMsg {
  type: "coarseBuild";
  id: number;
  seed: number;
  cx: number;
  cz: number;
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
  push(r.top.colors); push(r.top.patchW); push(r.top.indices);
  push(r.wall.vertices); push(r.wall.normals); push(r.wall.uvs);
  push(r.wall.colors); push(r.wall.shade); push(r.wall.patchW); push(r.wall.indices);
  return out;
}

ctx.onmessage = (ev: MessageEvent) => {
  if ((ev.data as { type?: string }).type === "clearCache") {
    dropPatchSourceCache();
    return;
  }
  const msg = ev.data as CoarseChunkMsg;
  if (msg.type !== "coarseBuild") return;
  const chunks = new Map<string, { heights: Float32Array; blockTypes: Uint8Array }>();
  for (const c of msg.chunks) chunks.set(`${c.ccx},${c.ccz}`, c);
  const out = computeTableGeometry(
    (ccx, ccz) => chunks.get(`${ccx},${ccz}`),
    msg.seed,
    msg.cx,
    msg.cz,
    undefined,
    null,
    null,
    undefined,
    true,
  );
  ctx.postMessage({ type: "result", id: msg.id, ...out }, transferOf(out));
};
