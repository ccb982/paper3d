// ============================================================
// entity/base/RasterProbe —— 两载体共用地形探针（重写 P1）
// ============================================================
// L2 代理与 L3 实体共用同一份地形访问语义（raster 直读 + 表桥 weld）：
// 一处修改、两载体同变（用户定：地形/爬坡是每个实体都有的基础方法）。
// `hintY()` 返回当前实体脚底高（选层用；调用方每拍刷新）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { finalRuling } from '../../services/map/Refinements';
import { getSteerTable } from '../SteerPick';
import { BLOCK_SIZE, BLOCKS_PER_SIDE } from '../../services/map/ChunkGenerator';
import type { TerrainProbe } from './CharacterCore';

export function createRasterProbe(hintY: () => number): TerrainProbe {
  const weldAt = (x: number, z: number, dx: number, dz: number): boolean => {
    const raster = RasterMap.current;
    if (!raster) return false;
    const bx = Math.floor(x / BLOCK_SIZE);
    const bz = Math.floor(z / BLOCK_SIZE);
    const dIdx = (Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3)) as 0 | 1 | 2 | 3;
    const src = raster.chunkSource(Math.floor(bx / BLOCKS_PER_SIDE), Math.floor(bz / BLOCKS_PER_SIDE));
    return finalRuling(src, bx, bz, dIdx) === 'weld';
  };
  return {
    heightAt: (x, z, y) => RasterMap.current?.surfaceHeightAtFor(x, z, y) ?? 0,
    layerAt: (x, z, y) => RasterMap.current?.surfaceHeightAtFor(x, z, y) ?? 0,   // ★ H2：层高单源
    wetAt: (x, z) => RasterMap.current?.tileDefAt(x, z).genRole === 'liquid',
    slopeGradAt: (x, z) => {
      const raster = RasterMap.current;
      if (!raster) return null;
      const y = hintY();
      const hx0 = raster.surfaceHeightAtFor(x - 1, z, y);
      const hx1 = raster.surfaceHeightAtFor(x + 1, z, y);
      const hz0 = raster.surfaceHeightAtFor(x, z - 1, y);
      const hz1 = raster.surfaceHeightAtFor(x, z + 1, y);
      const gx = (hx1 - hx0) * 0.5;
      const gz = (hz1 - hz0) * 0.5;
      return { gx, gz, mag: Math.hypot(gx, gz) };
    },
    isWeldEdge: (x, z, dx, dz) => weldAt(x, z, dx, dz),
    /** ★ 顶层地表（脱埋用；直读顶层，不做 y 感知选层） */
    topAt: (x, z) => RasterMap.current?.surfaceHeightAt(x, z) ?? NaN,
    climbPoint: (x, z, dx, dz) => getSteerTable()?.climbRunAt?.(x, z, dx, dz) ?? null,
    canStep: (x, z, dx, dz) => getSteerTable()?.canStep?.(x, z, dx, dz) ?? true,
  };
}
