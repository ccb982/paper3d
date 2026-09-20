// ============================================================
// TerrainRay —— 解析地形射线（物理兜底）
// ============================================================
// 背景：地形碰撞体是"分区 cells"且**帧预算/懒建**（远处 chunk 只先建 1/9 分区），
//   未建分区处物理射线打空 → 子弹/准星穿地（水地最明显，因为多半在远处 chunk）。
// 本模块用高度场 + 采样缓存做**解析 march** 补齐：粗步 2m（走 TerrainSampler 缓存）
//   + 命中后二分细化；只在"已加载 chunk"判定，未加载区不拦。
// ============================================================

import { RasterMap, chunkKeyOf } from '../map/RasterMap';
import { samplerFor } from '../map/TerrainSampler';
import { CHUNK_SIZE } from '../map/ChunkGenerator';

/** 地面高度（未加载 → null；pit 也返回高度，子弹应打到坑底/坑壁） */
function groundAt(raster: RasterMap, smp: ReturnType<typeof samplerFor>, x: number, z: number): number | null {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  if (!raster.getChunkData(cx, cz)) return null;
  void chunkKeyOf;
  return smp.heightAt(raster, x, z);
}

/** ★ 解析地形射线距离（米）；null = 不命中（含向上射线/未加载区） */
export function terrainRayDist(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): number | null {
  const raster = RasterMap.current;
  if (!raster) return null;
  if (dy > 0.2) return null;                       // 明显向上 → 不判地形
  const smp = samplerFor(raster);
  const h0 = groundAt(raster, smp, ox, oz);
  if (h0 !== null && oy < h0 - 0.05) return null;  // 起点已在地下（枪口贴地）→ 不判
  const STEP = 2;
  let prevT = 0;
  for (let t = STEP; t <= maxDist; t += STEP) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const h = groundAt(raster, smp, x, z);
    if (h === null) { prevT = t; continue; }       // 未加载区：跳过（不拦）
    if (y <= h) {
      // 二分细化（4 次，直采）
      let lo = prevT, hi = t;
      for (let k = 0; k < 4; k++) {
        const mid = (lo + hi) * 0.5;
        const mh = groundAt(raster, smp, ox + dx * mid, oz + dz * mid);
        const my = oy + dy * mid;
        if (mh !== null && my <= mh) hi = mid; else lo = mid;
      }
      return hi;
    }
    prevT = t;
  }
  return null;
}
