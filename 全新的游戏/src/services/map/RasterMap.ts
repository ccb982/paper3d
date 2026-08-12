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
  /** ★ 装饰噪点（1 = 亮点 cell；确定性随机，验证小地图算法用） */
  private decor: Uint8Array;

  constructor(map: MapQuery, seed = 12345) {
    this.size = map.size;
    this.heights = new Float32Array(this.size * this.size);
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        // 1×1 地块 → cell 中心采样高度
        this.heights[z * this.size + x] = map.getHeight(x + 0.5, z + 0.5);
      }
    }
    // ★ 确定性噪点（同 seed 同分布——3D 标记与小地图一一对应）
    this.decor = new Uint8Array(this.size * this.size);
    let s = seed;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const count = Math.floor(this.size * this.size * 0.05);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rnd() * this.size);
      const z = Math.floor(rnd() * this.size);
      this.decor[z * this.size + x] = 1;
    }
  }

  /** 地块高度（x/z = 地块坐标 0..size-1） */
  heightAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return 0;
    return this.heights[z * this.size + x];
  }

  /** 该地块是否装饰噪点（3D 标记同步生成用） */
  isDecor(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return false;
    return this.decor[z * this.size + x] === 1;
  }

  /** ★ 地形颜色（高度 → 颜色映射；平地绿，越高越亮/褐；噪点 = 黄色亮点） */
  terrainColorAt(x: number, z: number): [number, number, number] {
    if (this.isDecor(x, z)) return [255, 220, 90]; // ★ 噪点亮点
    const h = this.heightAt(x, z);
    // 平地基准绿（与 MapRender 一致 0x2d5a27）；高度 → 越亮越偏黄（地形感）
    const t = Math.max(0, Math.min(1, h / 8));
    const r = Math.round(45 + (150 - 45) * t);
    const g = Math.round(90 + (140 - 90) * t);
    const b = Math.round(39 + (60 - 39) * t);
    return [r, g, b];
  }
}
