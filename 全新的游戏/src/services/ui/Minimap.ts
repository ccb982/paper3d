// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// ★ 三层结构（地面 → 实体 → 黑雾，从下到上合成）：
//   ① 地面层：RasterMap 光栅化地形（1 地块 = 1 像素，静态构建一次）
//   ② 实体层：玩家/敌人/物品点（每帧绘制，世界坐标 → 窗口像素）
//   ③ 黑雾掩码层：未探索区域全黑、已探索可见（玩家周围半径持续点亮，
//      历史探索状态持久）
// 跟随式：玩家固定中心，地图相对滚动（窗口裁剪平移，不旋转）。
// 玩家图标恒朝上（代表前进方向）。

import { RasterMap } from '../map/RasterMap';
import type { EntityBase } from '../../entity/EntityBase';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** ① 地面层（1 地块 = 1 像素） */
  private terrain: HTMLCanvasElement;
  /** ② 实体层（地图像素坐标系） */
  private entityLayer: HTMLCanvasElement;
  /** ③ 黑雾掩码层（地图像素坐标系） */
  private fog: HTMLCanvasElement;
  /** 探索状态（1 = 已探索可见） */
  private visited: Uint8Array;
  private size: number;
  private displaySize: number;
  private windowHalf: number;
  /** 可见半径（米）：玩家周围点亮黑雾 */
  private viewRadius: number;

  constructor(raster: RasterMap, displaySize = 128, windowHalf = 16, viewRadius = 10) {
    this.size = raster.size;
    this.displaySize = displaySize;
    this.windowHalf = Math.min(windowHalf, this.size / 2);
    this.viewRadius = viewRadius;
    this.visited = new Uint8Array(this.size * this.size);

    // ① 地面层（静态，构建一次）
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

    // ② 实体层（地图像素坐标，每帧重绘）
    this.entityLayer = document.createElement('canvas');
    this.entityLayer.width = this.size;
    this.entityLayer.height = this.size;

    // ③ 黑雾掩码层（初始全黑 = 未探索）
    this.fog = document.createElement('canvas');
    this.fog.width = this.size;
    this.fog.height = this.size;
    const fctx = this.fog.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#000';
      fctx.fillRect(0, 0, this.size, this.size);
    }

    // 合成显示（左上角）
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

  /** ★ 每帧更新：探索点亮黑雾 → 实体层重绘 → 三层合成（玩家中心，地图滚动）
   *   实体 = 实体基类实例（直接消费 position + minimapInfo 属性） */
  update(px: number, pz: number, entities: EntityBase[]): void {
    // ③ 黑雾：玩家周围半径点亮（持久探索）
    this.reveal(px, pz);

    // ② 实体层：清空重绘（世界坐标 → 地图像素）
    //   ★ 过滤：敌人只显示已探索（黑雾内）的；物品只显示静止的
    const ectx = this.entityLayer.getContext('2d')!;
    ectx.clearRect(0, 0, this.size, this.size);
    for (const e of entities) {
      const ex = Math.floor(e.position.x);
      const ez = Math.floor(e.position.z);
      const info = e.minimapInfo;
      if (info.kind === 'enemy' && !this.visited[ez * this.size + ex]) continue;
      if (info.kind === 'item' && info.moving) continue;
      const color = info.kind === 'player' ? '#ffffff' : info.kind === 'enemy' ? '#ff4444' : '#ffdd55';
      ectx.fillStyle = color;
      ectx.fillRect(ex - 1, ez - 1, 3, 3);
    }

    // 合成（玩家中心窗口 + 地形滚动）
    const ctx = this.ctx;
    const win = this.windowHalf * 2;
    const sx = Math.max(0, Math.min(this.size - win, px - this.windowHalf));
    const sz = Math.max(0, Math.min(this.size - win, pz - this.windowHalf));
    const pxOff = px - sx;
    const pzOff = pz - sz;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.displaySize, this.displaySize);
    ctx.drawImage(this.terrain, sx, sz, win, win, 0, 0, this.displaySize, this.displaySize);
    ctx.drawImage(this.entityLayer, sx, sz, win, win, 0, 0, this.displaySize, this.displaySize);
    ctx.drawImage(this.fog, sx, sz, win, win, 0, 0, this.displaySize, this.displaySize);

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

  /** ★ 探索点亮：玩家周围 viewRadius 内的地块标记已见 */
  private reveal(px: number, pz: number): void {
    const r = this.viewRadius;
    const x0 = Math.max(0, Math.floor(px - r));
    const x1 = Math.min(this.size - 1, Math.floor(px + r));
    const z0 = Math.max(0, Math.floor(pz - r));
    const z1 = Math.min(this.size - 1, Math.floor(pz + r));
    let changed = false;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - px;
        const dz = z + 0.5 - pz;
        if (dx * dx + dz * dz <= r * r) {
          const i = z * this.size + x;
          if (!this.visited[i]) {
            this.visited[i] = 1;
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
    // 黑雾层重绘（已探索 = 透明）
    const fctx = this.fog.getContext('2d')!;
    const img = fctx.createImageData(this.size, this.size);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i + 3] = this.visited[i / 4] ? 0 : 255;
    }
    fctx.putImageData(img, 0, 0);
  }

  /** 小地图地块数 */
  get pixelSize(): number {
    return this.size;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
