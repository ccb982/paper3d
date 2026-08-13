// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// ★ 无限地图适配：
//   - 不预构建全图——每帧按"玩家 ±windowHalf 窗口"实时采样地形色
//   - 黑雾 = 稀疏 visited（无限持久），窗口内未探索像素盖黑
//   - 实体点：世界坐标 → 窗口像素（敌人只显示已探索的；物品只显示静止的）
//   - 玩家恒居中，箭头 = 摄像机朝向（准星方向）
// 窗口 ±80 米（160px → 1m/px，与 RasterMap 1 地块 = 1 像素对应）
// 开雾范围 = LOD_MAX_DIST（< 窗口 → 可见雾边界）

import { RasterMap, cellKeyOf } from '../map/RasterMap';
import type { EntityBase } from '../../entity/EntityBase';
import { LOD_MAX_DIST } from '../lod';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raster: RasterMap;
  private displaySize: number;
  private windowHalf: number;
  private viewRadius: number;
  /** ★ 稀疏探索状态（无限持久） */
  private visited = new Map<number, boolean>();

  constructor(raster: RasterMap, displaySize = 160, windowHalf = 80, viewRadius = LOD_MAX_DIST) {
    this.raster = raster;
    this.displaySize = displaySize;
    this.windowHalf = windowHalf;
    this.viewRadius = viewRadius;
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

  /** ★ 每帧更新：地形+黑雾（一次 ImageData）→ 实体点 → 玩家箭头（居中，= 摄像机朝向） */
  update(px: number, pz: number, playerYaw: number, entities: EntityBase[]): void {
    this.reveal(px, pz);
    const ctx = this.ctx;
    const ds = this.displaySize;
    const x0 = Math.floor(px - this.windowHalf);
    const z0 = Math.floor(pz - this.windowHalf);

    // 地形 + 黑雾（窗口内逐像素：已探索 = 地形色，未探索 = 雾黑）
    // ★ z 轴翻转：canvas y 向下 = 世界 z 减小（canvas 上方 = 北 +z，与 3D 俯视一致）
    const img = ctx.createImageData(ds, ds);
    for (let iy = 0; iy < ds; iy++) {
      const wz = z0 + ds - 1 - iy;
      for (let ix = 0; ix < ds; ix++) {
        const wx = x0 + ix;
        const i = (iy * ds + ix) * 4;
        if (this.visited.has(cellKeyOf(wx, wz))) {
          const [r, g, b] = this.raster.terrainColorAt(wx, wz);
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
        } else {
          img.data[i] = 4;
          img.data[i + 1] = 4;
          img.data[i + 2] = 8;
        }
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 实体点（世界 → 窗口像素；过滤：敌人只显示已探索的，物品只显示静止的）
    for (const e of entities) {
      const ex = Math.floor(e.position.x);
      const ez = Math.floor(e.position.z);
      const info = e.minimapInfo;
      if (info.kind === 'enemy' && !this.visited.has(cellKeyOf(ex, ez))) continue;
      if (info.kind === 'item' && info.moving) continue;
      const pxw = ex - x0;
      const pzw = ds - 1 - (ez - z0);
      if (pxw < 0 || pzw < 0 || pxw >= ds || pzw >= ds) continue;
      const color = info.kind === 'player' ? '#ffffff' : info.kind === 'enemy' ? '#ff4444' : '#ffdd55';
      ctx.fillStyle = color;
      ctx.fillRect(pxw - 1, pzw - 1, 3, 3);
    }

    // ★ 玩家箭头：居中，方向 = 摄像机朝向（世界角 θ → canvas 旋转角 = θ；
    //   世界方向 (sinθ,cosθ) → canvas (sinθ,-cosθ)（canvas 上=+z 北））
    const cx = ds / 2;
    const cy = ds / 2;
    const phi = playerYaw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phi);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(-4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** ★ 探索点亮：玩家周围 viewRadius 内标记已见（稀疏持久） */
  private reveal(px: number, pz: number): void {
    const r = this.viewRadius;
    for (let z = Math.floor(pz - r); z <= Math.floor(pz + r); z++) {
      for (let x = Math.floor(px - r); x <= Math.floor(px + r); x++) {
        const dx = x + 0.5 - px;
        const dz = z + 0.5 - pz;
        if (dx * dx + dz * dz <= r * r) {
          const key = cellKeyOf(x, z);
          if (!this.visited.has(key)) this.visited.set(key, true);
        }
      }
    }
  }

  dispose(): void {
    this.canvas.remove();
    this.visited.clear();
  }
}
