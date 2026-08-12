// ============================================================
// RasterMap —— 光栅化地图（静态地形数据层，架构 3.10）
// ============================================================
// 把地图光栅化为 1×1 地块网格（1 地块 = 1 cell）：
//   - 只处理静态地形（高度采样，1×1 分辨率）
//   - 后续扩展：blockHeight（阻挡）/ 水域 / 可通行标记（双通道同源）
// 数据源：MapQuery（高度图）；消费方：Minimap（渲染）、Targeting（射线阻挡）

import type { MapQuery } from './MapQuery';

export class RasterMap {
  readonly size: number;
  /** 地块高度网格（cell 中心采样，size×size） */
  private heights: Float32Array;

  constructor(map: MapQuery) {
    this.size = map.size;
    this.heights = new Float32Array(this.size * this.size);
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        // 1×1 地块 → cell 中心采样高度
        this.heights[z * this.size + x] = map.getHeight(x + 0.5, z + 0.5);
      }
    }
  }

  /** 地块高度（x/z = 地块坐标 0..size-1） */
  heightAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return 0;
    return this.heights[z * this.size + x];
  }

  /** ★ 地形颜色（高度 → 颜色映射；平地绿，越高越亮/褐色）
   *   后续扩展：阻挡深色、水域蓝色、可通行标记 */
  terrainColorAt(x: number, z: number): [number, number, number] {
    const h = this.heightAt(x, z);
    // 平地基准绿（与 MapRender 一致 0x2d5a27）；高度 → 越亮越偏黄（地形感）
    const t = Math.max(0, Math.min(1, h / 8));
    const r = Math.round(45 + (150 - 45) * t);
    const g = Math.round(90 + (140 - 90) * t);
    const b = Math.round(39 + (60 - 39) * t);
    return [r, g, b];
  }
}
