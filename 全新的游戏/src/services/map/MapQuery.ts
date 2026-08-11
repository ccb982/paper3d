// ============================================================
// MapQuery —— 地图查询接口（游戏逻辑的唯一入口）
// ============================================================
// 所有"外界"（主角移动/敌人 AI/物理桥/未来系统）只查 MapQuery，
// 不直接碰 MapData 内部结构。换实现（格子→多边形）不影响调用方。

import type { MapData } from './MapData';

export class MapQuery {
  constructor(private data: MapData) {}

  get size(): number {
    return this.data.size;
  }

  /** 地图世界边界（正方形 min..max） */
  getBounds(): { min: number; max: number } {
    return { min: 0, max: this.data.size };
  }

  /**
   * 可通行查询（占位版：全图可走）。
   * 未来：查通行矩阵，支持障碍/地形。
   */
  isWalkable(x: number, z: number): boolean {
    const { min, max } = this.getBounds();
    return x >= min && x < max && z >= min && z < max;
  }

  /**
   * ★ 地形高度查询（双线性插值）——外界（角色站立/AI 寻路）查地形高度。
   * 当前平地恒 0；地形起伏后按 heightmap 采样。
   */
  getHeight(x: number, z: number): number {
    const size = this.data.size;
    const hm = this.data.heightmap;
    if (x < 0 || z < 0 || x > size - 1 || z > size - 1) return 0;
    // 双线性插值（heightmap 索引：z * size + x）
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(size - 1, x0 + 1);
    const z1 = Math.min(size - 1, z0 + 1);
    const fx = x - x0;
    const fz = z - z0;
    const h00 = hm[z0 * size + x0];
    const h10 = hm[z0 * size + x1];
    const h01 = hm[z1 * size + x0];
    const h11 = hm[z1 * size + x1];
    return (
      (h00 * (1 - fx) + h10 * fx) * (1 - fz) +
      (h01 * (1 - fx) + h11 * fx) * fz
    );
  }
}
