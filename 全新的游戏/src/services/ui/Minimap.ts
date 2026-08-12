// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// 1 地块 = 1 像素（canvas 尺寸 = 地图尺寸），CSS 放大显示。
// 当前：静态地形渲染（构建一次）。
// 后续：实体点叠加（update 每帧同步）、玩家朝向、阻挡层。

import { RasterMap } from '../map/RasterMap';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private size: number;

  constructor(raster: RasterMap, displaySize = 128) {
    this.size = raster.size;
    const canvas = document.createElement('canvas');
    canvas.width = this.size;   // ★ 1 地块 = 1 像素
    canvas.height = this.size;
    canvas.style.cssText =
      `position:fixed;top:8px;left:8px;width:${displaySize}px;height:${displaySize}px;` +
      'image-rendering:pixelated;z-index:998;pointer-events:none;' +
      'border:1px solid rgba(255,255,255,0.35);background:#000;';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // 静态地形 → ImageData（构建一次；地形变化/阻挡更新时重建）
      const img = ctx.createImageData(this.size, this.size);
      for (let z = 0; z < this.size; z++) {
        for (let x = 0; x < this.size; x++) {
          const [r, g, b] = raster.terrainColorAt(x, z);
          const i = (z * this.size + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    document.body.appendChild(canvas);
    this.canvas = canvas;
  }

  /** 小地图地块数 */
  get pixelSize(): number {
    return this.size;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
