// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// ★ 无限地图适配：
//   - 不预构建全图——每帧按"玩家 ±windowHalf 窗口"实时采样地形色
//   - 黑雾 = 稀疏 visited（无限持久），窗口内未探索像素盖黑
//   - ★ 记忆灰雾（2026-08-23）：常驻掩码盖住所有已探明区域，
//     仅 LOD_MAX_DIST 圈内"挖孔"露全彩；偏暗=记忆观感。
//     敌人只在【已探索 且 LOD 圈内】显示；我方道具始终显示
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

  /** ★ 记忆灰雾：常驻掩码，盖住【所有】已探明区域；仅 LOD 圈内不绘制（挖孔露全彩）。
   *  偏暗 = "记忆中"的观感；未探明区仍是纯黑，三种状态一眼可分 */
  private static readonly MIST_R = 64;
  private static readonly MIST_G = 66;
  private static readonly MIST_B = 72;
  private static readonly MIST_STRENGTH = 0.85;

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

    // 地形 + 双层雾（窗口内逐像素）：
    //   未探索 = 雾黑 | 已探明 = 记忆灰雾（常驻掩码）| LOD 圈内 = 挖孔露全彩
    // ★ 屏幕对齐映射：canvas 上 = 3D 屏幕上方（-z，玩家初始朝向）、
    //   canvas 右 = 3D 屏幕右（+x）→ 右方物体在箭头右手边（符合直觉）
    const rSq = this.viewRadius * this.viewRadius;
    const M = Minimap;
    const img = ctx.createImageData(ds, ds);
    for (let iy = 0; iy < ds; iy++) {
      const wz = z0 + iy;
      for (let ix = 0; ix < ds; ix++) {
        const wx = x0 + ix;
        const i = (iy * ds + ix) * 4;
        if (this.visited.has(cellKeyOf(wx, wz))) {
          let [r, g, b] = this.raster.terrainColorAt(wx, wz);
          // ★ 灰雾是常驻掩码：圈外一律覆盖（无渐变带，像素风格硬边）
          const ddx = wx + 0.5 - px;
          const ddz = wz + 0.5 - pz;
          if (ddx * ddx + ddz * ddz > rSq) {
            r += (M.MIST_R - r) * M.MIST_STRENGTH;
            g += (M.MIST_G - g) * M.MIST_STRENGTH;
            b += (M.MIST_B - b) * M.MIST_STRENGTH;
          }
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

    // 实体点（世界 → 窗口像素）：
    //   敌人：仅【已探索 且 LOD 圈内】绘制（圈外探明区有灰雾=记忆区，敌人不显示）
    //   物品：静止的始终绘制（我方道具不受灰雾影响）
    for (const e of entities) {
      const ex = Math.floor(e.position.x);
      const ez = Math.floor(e.position.z);
      const info = e.minimapInfo;
      if (info.kind === 'enemy') {
        const edx = ex - px;
        const edz = ez - pz;
        const explored = this.visited.has(cellKeyOf(ex, ez));
        const inLod = edx * edx + edz * edz <= rSq;
        if (!explored || !inLod) continue;
      }
      if (info.kind === 'item' && info.moving) continue;
      const pxw = ex - x0;
      const pzw = ez - z0;
      if (pxw < 0 || pzw < 0 || pxw >= ds || pzw >= ds) continue;
      const color = info.kind === 'player' ? '#ffffff' : info.kind === 'enemy' ? '#ff4444' : '#ffdd55';
      ctx.fillStyle = color;
      ctx.fillRect(pxw - 1, pzw - 1, 3, 3);
    }

    // ★ 玩家箭头：居中，方向 = 摄像机朝向（世界角 θ → canvas 旋转角 = π - θ；
    //   世界 +z → canvas 下方 → (sinθ,cosθ) → canvas (sinθ,+cosθ)）
    const cx = ds / 2;
    const cy = ds / 2;
    const phi = Math.PI - playerYaw;
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
