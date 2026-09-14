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
  /** ★ 底图层（可见；仅跨格时"滚动 + 补边条"更新，不再每帧全量 putImageData） */
  private baseCanvas!: HTMLCanvasElement;
  private baseCtx!: CanvasRenderingContext2D;
  /** ★ 标记层（可见·上层；每帧 clear + 实体点 + 箭头；小画布、零回读） */
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  /** ★ 显隐（舰内房间：隐藏世界小地图；隐藏期间 update 直接返回，零开销） */
  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
    this.baseCanvas.style.display = v ? 'block' : 'none';
  }
  private visible = true;
  private raster: RasterMap;
  private displaySize: number;
  private windowHalf: number;
  private viewRadius: number;
  /** ★ 稀疏探索状态（无限持久：run 内不回退；地表色由 raster 地形记录派生） */
  private visited = new Map<number, boolean>();
  /** ★ 复用的地表底图（地形+雾；仅玩家跨格时滚动 + 补新边条） */
  private baseImg: ImageData | null = null;
  /** ★ 底图窗口原点（世界格坐标；滚动差量用） */
  private baseOX = 0;
  private baseOZ = 0;
  private lastCellX = NaN;
  private lastCellZ = NaN;

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
    const posCss =
      `position:fixed;top:8px;left:8px;width:${displaySize}px;height:${displaySize}px;` +
      'image-rendering:pixelated;pointer-events:none;';
    // ★ 底图层（黑底 + 边框；仅跨格滚动时更新 → 每帧不再上传 25600 像素）
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = displaySize;
    this.baseCanvas.height = displaySize;
    this.baseCanvas.style.cssText = posCss +
      'z-index:998;border:1px solid rgba(255,255,255,0.35);background:#000;';
    this.baseCtx = this.baseCanvas.getContext('2d')!;
    document.body.appendChild(this.baseCanvas);
    // ★ 标记层（透明；每帧实体点/箭头 → clearRect 小画布，无 GPU 回读/合成停顿）
    this.canvas = document.createElement('canvas');
    this.canvas.width = displaySize;
    this.canvas.height = displaySize;
    this.canvas.style.cssText = posCss + 'z-index:999;';
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  /** ★ 每帧更新：地表底图仅跨格重建 → 其余帧重贴底图 + 实体点 + 玩家箭头（居中，= 摄像机朝向） */
  update(px: number, pz: number, playerYaw: number, entities: EntityBase[]): void {
    if (!this.visible) return; // ★ 隐藏期间零开销（舰内房间）
    const ctx = this.ctx;
    const ds = this.displaySize;

    // ★ 重算门：只有玩家跨格（或首帧）才动底图（滚动 + 仅补新进窗口的条带像素）
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    if (!this.baseImg || cx !== this.lastCellX || cz !== this.lastCellZ) {
      this.lastCellX = cx;
      this.lastCellZ = cz;
      this.reveal(px, pz);
      // ★ 雾圈中心用【玩家格中心】：跨格才变 → 与增量重绘节奏完全对齐（无亚像素漂移差异）
      this.rebuildBase(cx + 0.5, cz + 0.5);
      this.baseCtx.putImageData(this.baseImg!, 0, 0);
    }

    // ★ 标记层：每帧只清小画布 + 画少量点/箭头（无 putImageData、无整幅上传）
    ctx.clearRect(0, 0, ds, ds);

    // 实体点（世界 → 窗口像素）：
    //   敌人：仅【已探索 且 LOD 圈内】绘制（圈外探明区有灰雾=记忆区，敌人不显示）
    //   物品：静止的始终绘制（我方道具不受灰雾影响）
    const x0 = Math.floor(px - this.windowHalf);
    const z0 = Math.floor(pz - this.windowHalf);
    const rSq = this.viewRadius * this.viewRadius;
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
      const color = info.kind === 'player' ? '#ffffff'
        : info.kind === 'enemy' ? '#ff4444'
        : info.kind === 'ship' ? '#66e0ff'
        : '#ffdd55';
      ctx.fillStyle = color;
      ctx.fillRect(pxw - 1, pzw - 1, 3, 3);
    }

    // ★ 玩家箭头：居中，方向 = 摄像机朝向（世界角 θ → canvas 旋转角 = π - θ；
    //   世界 +z → canvas 下方 → (sinθ,cosθ) → canvas (sinθ,+cosθ)）
    const acx = ds / 2;
    const acy = ds / 2;
    const phi = Math.PI - playerYaw;
    ctx.save();
    ctx.translate(acx, acy);
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

  /** ★ 重建地表底图（地形 + 双层雾）：首帧全量；之后仅【滚动已有像素 + 补新边条】。
   *  未探索 = 雾黑 | 已探明 = 记忆灰雾（常驻掩码）| LOD 圈内 = 挖孔露全彩
   *  ★ 屏幕对齐映射：canvas 上 = 3D 屏幕上方（-z）、canvas 右 = 3D 屏幕右（+x） */
  private rebuildBase(px: number, pz: number): void {
    const ds = this.displaySize;
    const x0 = Math.floor(px - this.windowHalf);
    const z0 = Math.floor(pz - this.windowHalf);
    const rSq = this.viewRadius * this.viewRadius;
    if (!this.baseImg) {
      // 首帧全量
      this.baseImg = this.baseCtx.createImageData(ds, ds);
      this.baseOX = x0;
      this.baseOZ = z0;
      for (let iy = 0; iy < ds; iy++) {
        for (let ix = 0; ix < ds; ix++) {
          this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
        }
      }
      return;
    }
    const dx = x0 - this.baseOX;
    const dz = z0 - this.baseOZ;
    if (dx === 0 && dz === 0) return;
    // ★ 滚动路径只适用于逐格行走（|d| ≤ 4px）；大位移（停靠/传送/快速载具）走全量——
    //   否则 reveal 新点亮的"窗口中部"像素不在任何新条带里（残留暗点）
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4) {
      // 位移过大（传送）→ 全量重画
      this.baseOX = x0;
      this.baseOZ = z0;
      for (let iy = 0; iy < ds; iy++) {
        for (let ix = 0; ix < ds; ix++) {
          this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
        }
      }
      return;
    }
    const data = this.baseImg.data;
    const rowBytes = ds * 4;
    // ① 滚动：已有像素搬到新窗口位置（copyWithin，行内覆盖安全）
    if (dz > 0) data.copyWithin(0, dz * rowBytes, ds * rowBytes);
    else if (dz < 0) data.copyWithin(-dz * rowBytes, 0, (ds + dz) * rowBytes);
    if (dx !== 0) {
      for (let iy = 0; iy < ds; iy++) {
        const base = iy * rowBytes;
        if (dx > 0) data.copyWithin(base, base + dx * 4, base + rowBytes);
        else data.copyWithin(base - dx * 4, base, base + (ds + dx) * 4);
      }
    }
    this.baseOX = x0;
    this.baseOZ = z0;
    // ② 补新边条（只算刚进入窗口的竖条 |dx| 列 + 横条 |dz| 行；正常跨格 ≈ 320 像素）
    const colStart = dx > 0 ? ds - dx : 0;
    for (let c = 0; c < Math.abs(dx); c++) {
      const ix = colStart + c;
      for (let iy = 0; iy < ds; iy++) {
        this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
      }
    }
    const rowStart = dz > 0 ? ds - dz : 0;
    for (let r = 0; r < Math.abs(dz); r++) {
      const iy = rowStart + r;
      for (let ix = 0; ix < ds; ix++) {
        this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
      }
    }
    // ③ 补"点亮圈边带"：reveal 半径(viewRadius=90m) > 窗口半宽(80m) → 四角区域
    //    存在"窗口内但当初未点亮、后被点亮"的像素（不在新条带里）；同时已点亮像素
    //    越过雾圈后要转灰雾。两者都只发生在 |d-r| ≲ 跨格位移处 → 重画该边带。
    const band = 4.0; // 覆盖跨格位移 + reveal 浮点/量化中心偏差（±~0.7m）
    for (let iy = 0; iy < ds; iy++) {
      const ddz = z0 + iy + 0.5 - pz;
      for (let ix = 0; ix < ds; ix++) {
        const ddx = x0 + ix + 0.5 - px;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > this.viewRadius - band && d < this.viewRadius + band) {
          this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
        }
      }
    }
  }

  /** 单像素落色（地形色 + 探索雾 + LOD 挖孔；rebuildBase 的共用叶子） */
  private paintPixel(
    img: ImageData, i: number,
    wx: number, wz: number,
    px: number, pz: number, rSq: number,
  ): void {
    if (this.visited.has(cellKeyOf(wx, wz))) {
      // ★ 颜色来自地形记录（raster.mapColorAt：实时 chunk 优先，卸载回放快照）
      const packed = this.raster.mapColorAt(wx, wz);
      let r = (packed >> 16) & 255;
      let g = (packed >> 8) & 255;
      let b = packed & 255;
      // ★ 灰雾是常驻掩码：圈外一律覆盖（无渐变带，像素风格硬边）
      const ddx = wx + 0.5 - px;
      const ddz = wz + 0.5 - pz;
      if (ddx * ddx + ddz * ddz > rSq) {
        r += (Minimap.MIST_R - r) * Minimap.MIST_STRENGTH;
        g += (Minimap.MIST_G - g) * Minimap.MIST_STRENGTH;
        b += (Minimap.MIST_B - b) * Minimap.MIST_STRENGTH;
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

  /** ★ 探索判定出口（大地图面板共用同一探索记忆） */
  isExplored(x: number, z: number): boolean {
    return this.visited.has(cellKeyOf(Math.floor(x), Math.floor(z)));
  }

  /** 已探索格数（面板信息行） */
  get exploredCount(): number {
    return this.visited.size;
  }

  dispose(): void {
    this.canvas.remove();
    this.baseCanvas.remove();
    this.visited.clear();
  }
}
