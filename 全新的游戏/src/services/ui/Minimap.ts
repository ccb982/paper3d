// ============================================================
// Minimap —— 左上角小地图（展示层，架构 3.10）
// ============================================================
// ★ 无限地图适配：
//   - 不预构建全图——每帧按"玩家 ±windowHalf 窗口"实时采样地形色
//   - 黑雾 = 稀疏探索记忆（无限持久），窗口内未探索像素盖黑
//   - ★ 记忆灰雾（2026-08-23）：常驻掩码盖住所有已探明区域，
//     仅 LOD_MAX_DIST 圈内"挖孔"露全彩；偏暗=记忆观感。
//     敌人按【玩家视野半径 ∪ 舰船雷达半径】播报（不叠加地图记忆）；NPC 金点常显；我方道具始终显示
//   - ★ 敌情含【远层代理】：>35m 的敌人不是 EntityBase（在蜂群代理池里），
//     必须额外遍历 update 的 swarm 参数，否则地图实际只看得到 35m 内（2026-09-15 修）
//   - 玩家恒居中，箭头 = 摄像机朝向（准星方向）
//   - ★ 图标（2026-09-15）：玩家=白箭头；舰船=青菱形+呼吸光环（很显眼）；
//     标记点=橙黄菱形。舰船/标记**出窗后贴到画布边框**（三角朝外 + 距离数字），
//     形状与配色与大地图共用 `mapIcons`，场景提示 NavHints 同源。
// 窗口 ±90 米（180px → 1m/px，与 RasterMap 1 地块 = 1 像素对应）
// ★ 窗口与 viewRadius（= LOD_MAX_DIST = 90m）完全对齐 → 角色可见范围内的敌人全收
//   （2026-09-15：原为 160px / ±80m，会让 80~90m 这圈的敌人被窗口落位判定裁掉）
//
// ★ 预加载（2026-09-15）：探索记忆 / 底图 / LOD 边带索引三样都是纯函数
//   （探索圆盘与地形数据无关；地形色 = f(seed,x,z)，blockTypes 运行时不改），
//   故可在抽卡页算好（见 MinimapWarmup），进世界时交接 → 首帧**零成本**：
//   构造时就贴好底图，并把 lastCell/lastReveal 落在出生格 → 第一次 update 直接跳过
//   整段 reveal + rebuildBase。
// ============================================================

import { RasterMap } from '../map/RasterMap';
import { ExploredMask } from '../map/ExploredMask';
import type { EntityBase } from '../../entity/EntityBase';
import type { MapMarkers } from './MapMarkers';
import {
  drawMarkerIcon,
  drawOffscreenIndicator,
  drawPlayerArrow,
  drawShipIcon,
  SHIP_COLOR,
} from './mapIcons';
import {
  buildBandIdx,
  consumeMinimapWarmup,
  MINIMAP_SIZE,
  MINIMAP_SHIP_VIEW_RADIUS,
  MINIMAP_WINDOW_HALF,
  MINIMAP_VIEW_RADIUS,
  LOD_BAND,
  type MinimapWarmData,
} from './MinimapWarmup';

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
  /**
   * ★ 探索记忆（无限持久：run 内不回退；地表色由 raster 地形记录派生）
   * 稠密位图（出生区 181×181）+ 越界稀疏回退；可比 Map<cellKey> 快一个数量级。
   */
  private explored: ExploredMask;
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

  /**
   * ★ 上次 reveal 的玩家**位置**（浮点，= 上次点亮的那个圆盘的圆心）。
   *   NaN = 尚无 → 首次全量。★ 必须是浮点而不是格：增量环带的内径 = r − d，
   *   这里的 d 是两次圆心之间的**真实位移**，用格作基准会把 d 低估最多 1.4m
   *   （见 reveal 的推导）。
   */
  private lastRevealPX = NaN;
  private lastRevealPZ = NaN;
  /** ★ 舰船独立开雾（半径解耦）：上次点亮圆心（浮点）/上次所在格（跨格触发） */
  private shipViewRadius: number;
  private lastShipRevealPX = NaN;
  private lastShipRevealPZ = NaN;
  private lastShipCellX = NaN;
  private lastShipCellZ = NaN;
  /** ★ 舰船开雾"窗口内新增格"收集缓冲（只重绘这几百个像素；溢出 → 全量重绘兜底） */
  private newCellX = new Int32Array(2048);
  private newCellZ = new Int32Array(2048);
  private newCellCount = 0;
  private newCellOverflow = false;
  /** ★ LOD 圈边带像素索引（静态预计算） */
  private bandIdx: Uint32Array | null = null;
  private bandIdxReady = false;

  /** ★ 是否吃到预加载（调试/HUD 可读） */
  private warmed = false;

  constructor(
    raster: RasterMap,
    displaySize = MINIMAP_SIZE,
    windowHalf = MINIMAP_WINDOW_HALF,
    viewRadius = MINIMAP_VIEW_RADIUS,
    /** ★ 舰船独立开雾半径（米；与玩家视野解耦） */
    shipViewRadius = MINIMAP_SHIP_VIEW_RADIUS,
    /** ★ 预加载数据（缺省自动按 raster.worldSeed 取；传 null 显式走冷路径） */
    warm: MinimapWarmData | null | undefined = undefined,
  ) {
    this.raster = raster;
    this.displaySize = displaySize;
    this.windowHalf = windowHalf;
    this.viewRadius = viewRadius;
    this.shipViewRadius = shipViewRadius;
    this.explored = new ExploredMask(0, 0, 0, 0); // 默认全稀疏（= 旧行为）
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

    // ★ 预加载交接：整段"开局点亮"在抽卡页已经算完，这里只做两次字节拷贝
    const w = warm === undefined
      ? consumeMinimapWarmup(raster.worldSeed, displaySize, windowHalf, viewRadius)
      : warm;
    if (w) this.adoptWarm(w);
  }

  /** ★ 吃下预加载数据：底图即刻上屏 + 探索记忆/边带索引就位 + 首次 update 直接跳过 */
  private adoptWarm(w: MinimapWarmData): void {
    const ds = this.displaySize;
    if (w.size !== ds) return;
    this.explored = w.mask;
    const img = this.baseCtx.createImageData(ds, ds);
    img.data.set(w.baseImg);
    this.baseImg = img;
    this.baseOX = w.baseOX;
    this.baseOZ = w.baseOZ;
    // ★ 首次 update 的位置恰是出生格 → 让它直接命中"未跨格"分支（零 reveal / 零 rebuild）
    this.lastCellX = w.cellX;
    this.lastCellZ = w.cellZ;
    // ★ 预热圆盘的圆心（= 出生格中心）→ 后续增量环带以内径 r−d 从它量起（精确）
    this.lastRevealPX = w.cellX + 0.5;
    this.lastRevealPZ = w.cellZ + 0.5;
    this.bandIdx = w.bandIdx;
    this.bandIdxReady = true;
    this.baseCtx.putImageData(img, 0, 0);
    this.warmed = true;
  }

  /** ★ 是否吃到预加载（调试 HUD 用） */
  get isWarmed(): boolean {
    return this.warmed;
  }

  /** ★ 每帧更新：地表底图仅跨格重建 → 其余帧重贴底图 + 实体点 + 玩家箭头（居中，= 摄像机朝向）
   *  `swarm` = 蜂群代理池（远层敌人；可空）：35m 外的敌人不是 EntityBase，
   *  不遍历它的话地图就只能看到 35m 内的敌人（2026-09-15 用户反馈修复）。
   *  `markers` = 玩家标记点（大地图放置）：与舰船同一套"窗内图标 / 出窗贴边方位"处理。 */
  update(
    px: number,
    pz: number,
    playerYaw: number,
    entities: EntityBase[],
    swarm?: { readonly x: Float32Array; readonly z: Float32Array; readonly count: number } | null,
    markers?: MapMarkers | null,
    /** ★ 舰船世界坐标（独立开雾圆心 + 敌情雷达；null = 无舰船） */
    shipPosition?: { x: number; z: number } | null,
  ): void {
    if (!this.visible) return; // ★ 隐藏期间零开销（舰内房间）
    // ★ 舰船独立开雾：舰船跨格 → 点亮自身半径（与玩家视野解耦）
    if (shipPosition) this.revealShip(shipPosition.x, shipPosition.z, px, pz);
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
    //   敌人：仅【视野半径 viewRadius(=LOD_MAX_DIST=90m) 内】绘制（超出即 lod3 不渲染 → 不播报）
    //   物品：静止的始终绘制（我方道具不受视野影响）
    //   ★ 玩家/舰船不在这里画：玩家恒居中（由箭头代表）、舰船走 mapIcons 的大图标
    const x0 = Math.floor(px - this.windowHalf);
    const z0 = Math.floor(pz - this.windowHalf);
    const rSq = this.viewRadius * this.viewRadius;
    let shipX = NaN;
    let shipZ = NaN;
    for (const e of entities) {
      const ex = Math.floor(e.position.x);
      const ez = Math.floor(e.position.z);
      const info = e.minimapInfo;
      if (info.kind === 'ship') {
        shipX = ex;
        shipZ = ez;
        continue;
      }
      if (info.kind === 'player' || info.kind === 'decoration') continue;
      if (info.kind === 'enemy') {
        // ★ 只播报（玩家视野半径）或（舰船雷达半径）内的敌人：与大地图/舰船独立开雾同一规则
        const edx = ex - px;
        const edz = ez - pz;
        if (edx * edx + edz * edz > rSq) {
          if (!shipPosition) continue;
          const sdx = ex - shipPosition.x;
          const sdz = ez - shipPosition.z;
          const sr = this.shipViewRadius;
          if (sdx * sdx + sdz * sdz > sr * sr) continue;
        }
      }
      if (info.kind === 'item' && info.moving) continue;
      // ★ 强制隐藏（进舰/builder 消失的实体：本体还在实体表里但不该出现在地图上）
      if (info.hideOnMap) continue;
      const pxw = ex - x0;
      const pzw = ez - z0;
      if (pxw < 0 || pzw < 0 || pxw >= ds || pzw >= ds) continue;
      // ★ NPC（访客/事件角色）：金色大方点常显（与大地图同色同尺寸，一眼可辨）
      if (info.kind === 'npc') {
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(pxw - 2, pzw - 2, 5, 5);
        continue;
      }
      ctx.fillStyle = info.kind === 'enemy' ? '#ff4444' : '#ffdd55';
      ctx.fillRect(pxw - 1, pzw - 1, 3, 3);
    }

    // ★ 远层代理（35m 外敌人）：同一半径规则（≤ viewRadius），同色同尺寸
    if (swarm) {
      ctx.fillStyle = '#ff4444';
      for (let i = 0; i < swarm.count; i++) {
        const ex = Math.floor(swarm.x[i]);
        const ez = Math.floor(swarm.z[i]);
        const edx = ex - px;
        const edz = ez - pz;
        if (edx * edx + edz * edz > rSq) continue;
        const pxw = ex - x0;
        const pzw = ez - z0;
        if (pxw < 0 || pzw < 0 || pxw >= ds || pzw >= ds) continue;
        ctx.fillRect(pxw - 1, pzw - 1, 3, 3);
      }
    }

    // ★ 舰船 / 标记点：窗内画大图标，出窗 → 贴边方位三角（+距离）。
    //   与大地图共用 mapIcons 同一套形状/配色；"最近"优先画在最后（箭头之上）。
    //   pulse = 呼吸量（光环/三角随时间微缩放，远处也能一眼扫到）。
    const cxm = ds / 2;
    const cym = ds / 2;
    const halfIn = ds / 2 - 6; // 图标要完整落在画布内（贴边会被裁一半）
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0035);
    if (!Number.isNaN(shipX)) {
      const dx = shipX - px;
      const dz = shipZ - pz;
      const d = Math.hypot(dx, dz);
      if (Math.abs(dx) <= halfIn && Math.abs(dz) <= halfIn) {
        drawShipIcon(ctx, cxm + dx, cym + dz, 4.5, pulse);
      } else {
        drawOffscreenIndicator(ctx, cxm, cym, dx, dz, halfIn, halfIn, SHIP_COLOR, pulse, d);
      }
    }
    if (markers) {
      const items = markers.items;
      for (let i = 0; i < items.length; i++) {
        const m = items[i];
        const dx = m.x - px;
        const dz = m.z - pz;
        const d = Math.hypot(dx, dz);
        if (Math.abs(dx) <= halfIn && Math.abs(dz) <= halfIn) {
          drawMarkerIcon(ctx, cxm + dx, cym + dz, 3.4, m.color, pulse);
        } else {
          drawOffscreenIndicator(ctx, cxm, cym, dx, dz, halfIn, halfIn, m.color, pulse, d);
        }
      }
    }

    // ★ 玩家箭头：居中，方向 = 摄像机朝向（世界角 θ → canvas 旋转角 = π - θ；
    //   世界 +z → canvas 下方 → (sinθ,cosθ) → canvas (sinθ,+cosθ)）
    drawPlayerArrow(ctx, cxm, cym, 7, Math.PI - playerYaw);
  }

  /** ★ 重建地表底图（地形 + 双层雾）：首帧全量；之后仅【滚动已有像素 + 补新边条】。
   *  未探索 = 雾黑 | 已探明 = 记忆灰雾（常驻掩码）| LOD 圈内 = 挖孔露全彩
   *  ★ 屏幕对齐映射：canvas 上 = 3D 屏幕上方（-z）、canvas 右 = 3D 屏幕右（+x） */
  private rebuildBase(px: number, pz: number): void {
    const ds = this.displaySize;
    const rSq = this.viewRadius * this.viewRadius;
    const x0 = Math.floor(px - this.windowHalf);
    const z0 = Math.floor(pz - this.windowHalf);
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
    //   ★ 性能（2026-09-15）：px/pz 恒为"玩家格中心"（唯一调用点传 cx+0.5/cz+0.5），
    //     故每个像素到中心的距离在每次调用间**不变** → 索引表一次算好，之后只遍历
    //     命中的 ~1.1k 个像素（原实现每次跨格都扫全部 160²=25600 个并各算一次 hypot）。
    const idx = this.ensureBandIdx();
    if (idx) {
      const dsI = ds;
      for (let k = 0; k < idx.length; k++) {
        const p = idx[k];
        this.paintPixel(this.baseImg, p * 4, x0 + (p % dsI), z0 + ((p / dsI) | 0), px, pz, rSq);
      }
    } else {
      for (let iy = 0; iy < ds; iy++) {
        const ddz = z0 + iy + 0.5 - pz;
        for (let ix = 0; ix < ds; ix++) {
          const ddx = x0 + ix + 0.5 - px;
          const d = Math.sqrt(ddx * ddx + ddz * ddz);
          if (d > this.viewRadius - LOD_BAND && d < this.viewRadius + LOD_BAND) {
            this.paintPixel(this.baseImg, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
          }
        }
      }
    }
  }

  /** ★ LOD 圈边带像素索引（静态预计算；见 MinimapWarmup.buildBandIdx） */
  private ensureBandIdx(): Uint32Array | null {
    if (this.bandIdxReady) return this.bandIdx;
    this.bandIdxReady = true;
    this.bandIdx = buildBandIdx(this.displaySize, this.windowHalf, this.viewRadius, LOD_BAND);
    return this.bandIdx;
  }

  /** 单像素落色（地形色 + 探索雾 + LOD 挖孔；rebuildBase 的共用叶子） */
  private paintPixel(
    img: ImageData, i: number,
    wx: number, wz: number,
    px: number, pz: number, rSq: number,
  ): void {
    if (this.explored.has(wx, wz)) {
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

  /**
   * ★ 探索点亮：玩家周围 viewRadius 内标记已见（持久；mark 幂等，永不回退）
   *
   * ★ 增量扫描（2026-09-15 重写）：每跨 1 格全量扫 (2r+1)² = 32,761 格是"停靠/
   *   打坑/航行"冷帧里最大的单项 CPU（首次 ~27ms；远航时因稀疏回退反复触发，
   *   每次 3 万次 Map 查找 → 持续掉帧）。
   *
   *   关键性质：新点亮的区域恒等于【新圆盘 − 旧圆盘】。
   *   设两圆心位移 d = |新心 − 旧心|。若格 C 不在旧盘内（dist_old > r）而在新盘内，
   *   由三角不等式 dist_old ≤ dist_new + d 得
   *       dist_new > r − d
   *   → **crescent ⊆ 以新心为心、(r−d, r] 的环带**。
   *   环带外的旧盘部分早已标过（幂等），故"只扫这个环带"与全量扫描**逐格等价**。
   *
   *   ⚠ 为什么不能按"新矩形 − 旧矩形"取边缘条带（2026-09-15 踩坑）：
   *     那个 crescent 不是贴着位移方向的一小块，而是**沿新圆周张角近 180°、
   *     厚 ≈ d 的一段细月牙**（位移方向为正中央，两端厚度渐收为 0）。
   *     用"新边缘 |d| 列/行 + 固定内扩 12 格"只能覆盖月牙的**两个端点**，
   *     中间整段（如位移 (−1,−1) 时的 (−34,−34)）永久漏标 →
   *     表现为雾界上黑色斑点/黑块随移动不断累积（"黑雾清不掉"）。
   *     环带写法与张角无关，不存在这个盲区。
   *
   *   开销：d 为常规跨格位移（≤ ~2m）时环带 ≈ 2πr·d ≈ 1.1k 格，
   *        单次 ≈ 20µs（且只是 Uint8Array 写；远低于原 2.5 万次 Map 读写）。
   *        d ≥ r（停靠/传送/紧急迫降）时内径 ≤ 0 → 自动退化为全量，仍正确。
   */
  private reveal(px: number, pz: number): void {
    const ox = this.lastRevealPX;
    const oz = this.lastRevealPZ;
    this.lastRevealPX = px;
    this.lastRevealPZ = pz;
    if (!Number.isFinite(ox)) {
      this.markDisk(px, pz, this.viewRadius, -1); // 首次：全量
      return;
    }
    // ★ 内径 = r − d：d 越大环带越厚；d ≥ r 时 ≤ 0 → markDisk 视作全量
    this.markDisk(px, pz, this.viewRadius, this.viewRadius - Math.hypot(px - ox, pz - oz));
  }

  /** ★ 舰船独立开雾：以舰船为圆心、shipViewRadius 为半径点亮探索记忆
   *  （与玩家视野半径解耦；舰船跨格才动掩码，增量环带与玩家 reveal 同法）。
   *  舰船在窗口内 → 强制下帧重建底图，新点亮区域立即上屏
   *  （大地图逐帧读同一份掩码 isExplored，无需额外处理）。 */
  private revealShip(x: number, z: number, px: number, pz: number): void {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx === this.lastShipCellX && cz === this.lastShipCellZ) return;
    this.lastShipCellX = cx;
    this.lastShipCellZ = cz;
    const ox = this.lastShipRevealPX;
    const oz = this.lastShipRevealPZ;
    this.lastShipRevealPX = x;
    this.lastShipRevealPZ = z;
    const inner = Number.isFinite(ox)
      ? this.shipViewRadius - Math.hypot(x - ox, z - oz)
      : -1;
    const img = this.baseImg;
    if (!img) {
      this.markDisk(x, z, this.shipViewRadius, inner);
      return;
    }
    // ★ 只收集"落在底图窗口内"的新增格：盒外点亮只影响大地图（逐帧读同一份掩码），无需重绘
    this.newCellCount = 0;
    this.newCellOverflow = false;
    const added = this.markDisk(
      x, z, this.shipViewRadius, inner,
      this.baseOX, this.baseOZ, this.baseOX + this.displaySize - 1, this.baseOZ + this.displaySize - 1,
    );
    if (added <= 0) return;
    if (this.newCellOverflow) this.repaintBaseFull(px, pz);
    else this.paintCollectedCells();
  }

  /** ★ 重绘收集到的"窗口内新增格"并上屏（舰船开雾常态路径：几百像素，不整窗重绘） */
  private paintCollectedCells(): void {
    const img = this.baseImg;
    if (!img || this.newCellCount === 0) return;
    const ds = this.displaySize;
    const rSq = this.viewRadius * this.viewRadius;
    // 底图 LOD 圆心 = 玩家格中心（与 rebuildBase 的 cx+0.5 同口径）
    const px = this.baseOX + this.windowHalf + 0.5;
    const pz = this.baseOZ + this.windowHalf + 0.5;
    for (let k = 0; k < this.newCellCount; k++) {
      const wx = this.newCellX[k];
      const wz = this.newCellZ[k];
      const ix = wx - this.baseOX;
      const iy = wz - this.baseOZ;
      if (ix < 0 || iy < 0 || ix >= ds || iy >= ds) continue;
      this.paintPixel(img, (iy * ds + ix) * 4, wx, wz, px, pz, rSq);
    }
    this.baseCtx.putImageData(img, 0, 0);
  }

  /** ★ 底图全量重绘 + 上屏（新增格溢出收集缓冲的兜底；窗口原点不变） */
  private repaintBaseFull(px: number, pz: number): void {
    const img = this.baseImg;
    if (!img) return;
    const ds = this.displaySize;
    const rSq = this.viewRadius * this.viewRadius;
    const x0 = this.baseOX;
    const z0 = this.baseOZ;
    for (let iy = 0; iy < ds; iy++) {
      for (let ix = 0; ix < ds; ix++) {
        this.paintPixel(img, (iy * ds + ix) * 4, x0 + ix, z0 + iy, px, pz, rSq);
      }
    }
    this.baseCtx.putImageData(img, 0, 0);
  }

  /**
   * ★ 点亮"以 (px,pz) 为心、半径 r"的圆盘内所有整数格；`inner > 0` 时挖掉内盘，
   *   只标 dist ∈ (inner, r] 的环带。逐行求圆的 x 区间（无浪费的圆判定、无漏格）。
   *   格 x 在盘内 ⇔ |x + 0.5 − px| ≤ √(r² − dz²)（dz = z + 0.5 − pz）
   *            ⇔ px − h − 0.5 ≤ x ≤ px + h − 0.5
   *  @returns 新点亮格数；给了裁剪盒（clipX0 ≤ clipX1）时只统计盒内新增
   *           —— 舰船独立开雾据此判断是否需要重绘底图（盒外点亮只影响大地图）。
   */
  private markDisk(
    px: number, pz: number, r: number, inner: number,
    clipX0 = 0, clipZ0 = 0, clipX1 = -1, clipZ1 = -1,
  ): number {
    const mask = this.explored;
    const rSq = r * r;
    const innerSq = inner > 0 ? inner * inner : -1;
    const zA = Math.floor(pz - r);
    const zB = Math.floor(pz + r);
    const hasClip = clipX1 >= clipX0;
    let added = 0;
    for (let z = zA; z <= zB; z++) {
      const dz = z + 0.5 - pz;
      const dzSq = dz * dz;
      if (dzSq > rSq) continue; // 整行在圆外
      const hOut = Math.sqrt(rSq - dzSq);
      const xa = Math.ceil(px - hOut - 0.5);
      const xb = Math.floor(px + hOut - 0.5);
      const zInClip = hasClip && z >= clipZ0 && z <= clipZ1;
      if (innerSq > 0) {
        const inSq = innerSq - dzSq;
        if (inSq > 0) {
          // 内盘在本行占据 [ia, ib] → 只标左右两段
          const hIn = Math.sqrt(inSq);
          const ia = Math.ceil(px - hIn - 0.5);
          const ib = Math.floor(px + hIn - 0.5);
          for (let x = xa; x < ia; x++) {
            if (mask.mark(x, z) && this.countAdded(x, z, hasClip, zInClip, clipX0, clipX1)) added++;
          }
          for (let x = ib + 1; x <= xb; x++) {
            if (mask.mark(x, z) && this.countAdded(x, z, hasClip, zInClip, clipX0, clipX1)) added++;
          }
          continue;
        }
      }
      for (let x = xa; x <= xb; x++) {
        if (mask.mark(x, z) && this.countAdded(x, z, hasClip, zInClip, clipX0, clipX1)) added++;
      }
    }
    return added;
  }

  /** ★ 新增格统计/收集：无裁剪盒 = 全部计入；有裁剪盒 = 只计盒内并写入重绘缓冲
   *  （舰船开雾只重绘这几百个像素，避免整窗重绘）。 */
  private countAdded(
    x: number, z: number,
    hasClip: boolean, zInClip: boolean,
    clipX0: number, clipX1: number,
  ): boolean {
    if (!hasClip) return true;
    if (!zInClip || x < clipX0 || x > clipX1) return false;
    if (this.newCellCount < this.newCellX.length) {
      this.newCellX[this.newCellCount] = x;
      this.newCellZ[this.newCellCount] = z;
      this.newCellCount++;
    } else {
      this.newCellOverflow = true;
    }
    return true;
  }

  /** ★ 探索判定出口（大地图面板共用同一探索记忆） */
  isExplored(x: number, z: number): boolean {
    return this.explored.has(Math.floor(x), Math.floor(z));
  }

  /** 已探索格数（面板信息行） */
  get exploredCount(): number {
    return this.explored.size;
  }

  dispose(): void {
    this.canvas.remove();
    this.baseCanvas.remove();
    this.explored = new ExploredMask(0, 0, 0, 0);
    this.baseImg = null;
    this.lastCellX = NaN;
    this.lastCellZ = NaN;
    this.lastRevealPX = NaN;
    this.lastRevealPZ = NaN;
    this.lastShipRevealPX = NaN;
    this.lastShipRevealPZ = NaN;
    this.lastShipCellX = NaN;
    this.lastShipCellZ = NaN;
  }
}
