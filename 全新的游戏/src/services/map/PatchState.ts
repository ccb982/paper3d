// ============================================================
// PatchState —— 补丁覆盖的全局状态（渲染/物理/查询同源单一真源）
// ============================================================
// 拥有者语义：ChunkManager 是唯一写者（playBulletImpact 标记）；
// RasterMap.surfaceHeightAt（角色脚底/贴地/clamp）与破坏几何共享同一
// 张掩码 → 坑洞同时作用于渲染、rapier trimesh 与玩法高度采样。
//
// ★ 数组原地增长（mark 只置 1），PatchOverlay 闭包按引用读数组 → 缓存不失效。
// ★ key 编码与 RasterMap.chunkKeyOf 一致（(cx+4096)*8192+(cz+4096)）——
//   为避免 import 环（RasterMap → PatchState → FaceBuild → …）此处内联同式，
//   若 RasterMap.chunkKeyOf 变更须同步。
// ============================================================

import { buildPatchOverlay, type PatchOverlay } from "./FaceBuild";

const CH = 60;
const keyOf = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

const masks = new Map<number, Uint8Array>();
const overlays = new Map<number, PatchOverlay>();

/** 世界坐标所在 chunk 的掩码（未标记 → undefined） */
export function maskOf(cx: number, cz: number): Uint8Array | undefined {
  return masks.get(keyOf(cx, cz));
}

/** 标记一个 coarse cell（幂等）；返回是否为新标记 */
export function markCell(cx: number, cz: number, lx: number, lz: number): boolean {
  const key = keyOf(cx, cz);
  let arr = masks.get(key);
  if (!arr) {
    arr = new Uint8Array(CH * CH);
    masks.set(key, arr);
  }
  const idx = lz * CH + lx;
  if (arr[idx] === 1) return false;
  arr[idx] = 1;
  return true;
}

/** 世界坐标是否已是补丁 cell */
export function isPatchedAt(x: number, z: number): boolean {
  const cx = Math.floor(x / CH);
  const cz = Math.floor(z / CH);
  const arr = maskOf(cx, cz);
  if (!arr) return false;
  const lx = Math.min(CH - 1, Math.max(0, Math.floor(x - cx * CH)));
  const lz = Math.min(CH - 1, Math.max(0, Math.floor(z - cz * CH)));
  return arr[lz * CH + lx] === 1;
}

/** 世界坐标补丁深度（m；与渲染几何同函数 depthOf，含坑缘 1m smoothstep 坡降） */
export function depthAtWorld(x: number, z: number): number {
  const cx = Math.floor(x / CH);
  const cz = Math.floor(z / CH);
  const key = keyOf(cx, cz);
  const arr = masks.get(key);
  if (!arr) return 0;
  let ov = overlays.get(key);
  if (!ov) {
    ov = buildPatchOverlay(arr, cx, cz);
    overlays.set(key, ov);
  }
  return ov.depthOf(x, z);
}

/** 世界重置（ChunkManager 构造/回收时调用；与 raster.clearAll 同生命周期） */
export function clearAll(): void {
  masks.clear();
  overlays.clear();
}
