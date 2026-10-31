// ============================================================
// TerrainSampler —— 统一地形采样缓存（4m 格；同域一次采样多处复用）
// ============================================================
// 动机（实测）：surfaceHeightAt/tileDefAt 单次 ~7µs，评分表全量重建 ~5.3k 次、
// HPA 建簇 64 次/簇 → 冷启动/换落点的主要成本。这里按**世界 4m 格**缓存 h/role：
//   · 地形静态（只有挖掘会改）→ 命中率极高、生命周期 = 一次出击；
//   · 挖掘 → `invalidateArea`（脏窗）失效；chunk 重载不必管（h/role 仍对）。
// 用法：`samplerFor(raster).heightAt(x,z)` / `.roleAt(x,z)`（惰性、零分配、无共享对象）。
// ============================================================

import type { RasterMap } from './RasterMap';

/** 4m 采样格（与表/寻路同网格） */
const CELL = 4;

interface Entry {
  h: number;
  role: string;
}

const _cache = new WeakMap<RasterMap, TerrainSampler>();

/** 取该 RasterMap 的采样器（惰性创建；随地图实例 GC） */
export function samplerFor(raster: RasterMap): TerrainSampler {
  let s = _cache.get(raster);
  if (!s) { s = new TerrainSampler(); _cache.set(raster, s); }
  return s;
}

export class TerrainSampler {
  private readonly map = new Map<number, Entry>();

  private static key(ix: number, iz: number): number {
    return ((ix + 32768) << 16) | ((iz + 32768) & 0xffff);
  }

  private get(raster: RasterMap, x: number, z: number): Entry {
    const ix = Math.floor(x / CELL);
    const iz = Math.floor(z / CELL);
    const k = TerrainSampler.key(ix, iz);
    let e = this.map.get(k);
    if (!e) {
      const cx = ix * CELL + CELL / 2;
      const cz = iz * CELL + CELL / 2;
      e = { h: raster.surfaceHeightAt(cx, cz), role: raster.tileDefAt(cx, cz).genRole };
      if (this.map.size > 400000) this.map.clear();   // 防御：超限清空（命中率会自然恢复）
      this.map.set(k, e);
    }
    return e;
  }

  heightAt(raster: RasterMap, x: number, z: number): number {
    return this.get(raster, x, z).h;
  }

  roleAt(raster: RasterMap, x: number, z: number): string {
    return this.get(raster, x, z).role;
  }

  /** 挖掘/地形改动 → 脏窗失效（4m 格） */
  invalidateArea(x: number, z: number, r: number): void {
    const ix0 = Math.floor((x - r) / CELL), ix1 = Math.floor((x + r) / CELL);
    const iz0 = Math.floor((z - r) / CELL), iz1 = Math.floor((z + r) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      const b = (ix + 32768) << 16;
      for (let iz = iz0; iz <= iz1; iz++) this.map.delete(b | ((iz + 32768) & 0xffff));
    }
  }

  clear(): void {
    this.map.clear();
  }
}
