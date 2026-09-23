// ============================================================
// DockResolver —— 停靠落点安全判定（服务层）
// ============================================================
// 规则（用户定调 2026-09-12）：只拒绝"落在坑里"（genRole === 'pit'）；
// 水/水边/地面/高台全部合法（雪地、水里出生由入水管线正常处理）。
// 被拒 → 环带就近搜索第一个非坑点（1→24m、16 方向）；
// 全失败 → 原样返回（WorldMode 落位时还有二次兜底）。

import type { RasterMap } from '../map/RasterMap';
import travelConfig from '../../config/travel.json';

export interface DockSpawn {
  x: number;
  z: number;
  y: number;
  /** 是否被就近吸附（原选点在坑里） */
  nudged: boolean;
}

/** ★ 解析安全出生点：非坑原样返回；坑内就近吸附 */
export function resolveDockSpawn(raster: RasterMap, x: number, z: number): DockSpawn {
  const isPit = (px: number, pz: number): boolean => raster.tileDefAt(px, pz).genRole === 'pit';
  if (!isPit(x, z)) return { x, z, y: raster.surfaceHeightAt(x, z), nudged: false };
  const rings = travelConfig.dockSearchRings;
  const dirs = travelConfig.dockSearchDirs;
  for (const r of rings) {
    for (let i = 0; i < dirs; i++) {
      const a = (Math.PI * 2 * i) / dirs;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!isPit(px, pz)) return { x: px, z: pz, y: raster.surfaceHeightAt(px, pz), nudged: true };
    }
  }
  return { x, z, y: raster.surfaceHeightAt(x, z), nudged: false };
}
