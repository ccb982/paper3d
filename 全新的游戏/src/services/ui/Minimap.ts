// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// ★ 跟随式：玩家固定在小地图中心，玩家图标恒朝上（代表前进方向），
//   地形相对玩家滚动（窗口裁剪平移，不旋转）。
// 1 地块 = 1 像素（地形 canvas = 地图尺寸），窗口放大显示。
// 后续：实体点叠加、朝向旋转（如果改俯视角旋转模式）、LOD 可视化。

import { RasterMap } from '../map/RasterMap';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** 全图地形画布（1 地块 = 1 像素） */
  private terrain: HTMLCanvasElement;
  private size: number;
  private displaySize: number;
  /** 显示窗口半宽（世界米；±windowHalf → 2×windowHalf 地块） */
  private windowHalf: number;

  constructor(raster: RasterMap, displaySize = 128, windowHalf = 16) {
    this.size = raster.size;
    this.displaySize = displaySize;
    this.windowHalf = Math.min(windowHalf, this.size / 2);

    // 全图地形（构建一次；地形变化/阻挡更新时重建）
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.size;
    this.terrain.height = this.size;
    const tctx = this.terrain.getContext('2d');
    if (tctx) {
      const img = tctx.createImageData(this.size, this.size);
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
      tctx.putImageData(img, 0, 0);
    }

    // 显示画布（左上角）
    this.canvas = document.createElement('canvas');
    this.canvas.width = displaySize;
    this.canvas.height = displaySize;
    this.canvas.style.cssText =
      `position:fixed;top:8px;left:8px;width:${displaySize}px;height:${displaySize}px;` +
      'image-rendering:pixelated;z-index:998;pointer-events:none;' +
      'border:1px solid rgba(255,255,255,0.35);background:#000;';
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  /** ★ 每帧更新：玩家固定中心，地形相对滚动（窗口裁剪），玩家图标恒朝上 */
  update(px: number, pz: number): void {
    const ctx = this.ctx;
    const win = this.windowHalf * 2; // 窗口地块数
    // 地形源区域（1 地块 = 1 像素）：玩家中心 ± windowHalf，clamp 到地图内
    const sx = Math.max(0, Math.min(this.size - win, px - this.windowHalf));
    const sz = Math.max(0, Math.min(this.size - win, pz - this.windowHalf));
    // 玩家在窗口内的位置（像素；地图未滚到边界时恒为中心）
    const pxOff = px - sx;
    const pzOff = pz - sz;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.displaySize, this.displaySize);
    // 地形窗口 → 放大绘制
    ctx.drawImage(this.terrain, sx, sz, win, win, 0, 0, this.displaySize, this.displaySize);
    // ★ 玩家图标：中心，恒朝上（三角箭头）
    const cx = (pxOff / win) * this.displaySize;
    const cy = (pzOff / win) * this.displaySize;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** 小地图地块数 */
  get pixelSize(): number {
    return this.size;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
