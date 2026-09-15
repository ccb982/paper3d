// ============================================================
// MapPanel.ts —— 世界地图面板（M 键；读持久小地图表）
// ============================================================
// 定位：左上角 Minimap 的"全屏版"——数据源同一张 minimapTable
//   （世界格 → 探索时采样的地表色），因此 chunk 被卸载后依旧可回放。
// ★ 与 Minimap **共用同一份探索记忆**（MapPanelMemory = Minimap.explored）：
//   抽卡页预加载的出生区探索圆盘（见 MinimapWarmup）在开面板那一刻就已生效，
//   无需任何展开动作；逐像素取色走 TileDef.packedRgb（地块级惰性缓存），
//   整屏 6.9 万像素的取色从"每像素重算 HSL"降到一次字段读。
// 交互：
//   · 滚轮缩放（px/米）、拖拽平移（拖动后停止跟随玩家）
//   · ★ 左键单击 = 放置标记点 / 点已有标记 = 删除它（拖动平移仍走拖拽，靠位移阈值区分）
//   · 「回到玩家」重新跟随、「清除标记」清空全部标记；M / Esc 关闭
// 标记：白=玩家 青=舰船（菱形+光环） 黄=NPC 红=敌人
//   ★ 玩家标记：颜色自选（顶部色板 = MARKER_PALETTE，避开蓝/灰白），
//     每个标记记住自己的颜色 → 小地图、场景提示 NavHints 同色显示。
//   ★ 玩家/舰船/标记用 mapIcons 统一形状（小地图 + 场景提示 NavHints 同源）：
//     出画布的目标贴到边框上画方位三角（+ 距离数字），不会被"看不见"吞掉。
//   ★ 敌人（2026-09-15）：只播报视野半径（LOD_MAX_DIST=90m = lod3 边界）内的；
//     超过即 lod3、实体不渲染 → 不留"记忆敌情"。与小地图完全一致。
//     ★ 舰船雷达：玩家视野外的敌人若在舰船独立开雾半径（MINIMAP_SHIP_VIEW_RADIUS）
//       内也播报（舰船不只亮地形，也亮敌情）。
//   ★ 敌情来源 = entities（35m 内已升格的实体）+ swarm 代理池（35m 外的远层敌人）；
//     只遍历 entities 会让 90m 规则形同虚设（实际只看得到 35m 内）。
// ============================================================

import type { EntityBase } from '../../entity/EntityBase';
import type { RasterMap } from '../../services/map/RasterMap';
import { CHUNK_SIZE } from '../../services/map/ChunkGenerator';
import { LOD_MAX_DIST } from '../../services/lod';
import { MINIMAP_SHIP_VIEW_RADIUS } from '../../services/ui/MinimapWarmup';
import { MapMarkers } from '../../services/ui/MapMarkers';
import {
  drawMarkerIcon,
  drawOffscreenIndicator,
  drawPlayerArrow,
  drawShipIcon,
  MARKER_COLOR,
  MARKER_PALETTE,
  SHIP_COLOR,
} from '../../services/ui/mapIcons';

/** 探索记忆（Minimap 实现；地形记录由 RasterMap 提供——地图不再自建彩色表） */
export interface MapPanelMemory {
  isExplored(x: number, z: number): boolean;
  readonly exploredCount: number;
}

const CANVAS_W = 1000;
const CANVAS_H = 620;
/** 未探索格背景 */
const DARK: [number, number, number] = [6, 9, 15];
const MIN_SCALE = 0.6;
const MAX_SCALE = 12;
/** 重绘节流（秒）：跟随玩家时按 ~8Hz 重绘即可（原先跟随每帧置 dirty → 节流被完全废掉） */
const REDRAW_SEC = 0.12;
/** ★ 采样预算（离屏像素数上限）：1 离屏像素 = step 米。
 *  原先离屏恒为 1px/1m，`vw×vh` 随缩小按平方爆炸（scale=0.6 → 1667×1034 = 172 万像素，
 *  每帧全采样）。超预算就降采样（step>1），`drawImage` 仍按用户缩放拉伸 →
 *  缩得很小时只是"1 像素代表几米"，视觉等价（画布本就是 image-rendering:pixelated）。
 *  默认 scale=3 → 334×207 = 6.9 万 < 预算 → step=1，观感零变化。 */
const MAX_SAMPLE_PX = 120_000;
/** ★ 视野半径平方（= LOD_MAX_DIST 的平方，与 Minimap.viewRadius 同源）：
 *  两图统一 —— 只播报 ≤90m（lod3 边界以内）的敌人，超过即 lod3、实体本就不渲染。 */
const SIGHT_R_SQ = LOD_MAX_DIST * LOD_MAX_DIST;
/** ★ 舰船雷达半径平方（= 舰船独立开雾半径）：玩家视野外的敌人若在舰船雷达圈内仍播报
 *  （舰船不只点亮地形，也点亮敌情；半径与小地图/开雾同一真源）。 */
const SHIP_R_SQ = MINIMAP_SHIP_VIEW_RADIUS * MINIMAP_SHIP_VIEW_RADIUS;
/** ★ 单击判定阈值（CSS 像素）：按下→松手位移小于它 = 单击（放置/删除标记），否则算平移 */
const DRAG_SLOP_PX = 4;
/** ★ 单击命中已有标记的屏幕半径（CSS 像素；换算成世界米要除以 scale） */
const MARKER_HIT_PX = 16;
/** 出画布目标的贴边三角留白（像素） */
const EDGE_PAD = 16;

export class MapPanel {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gate: HTMLDivElement;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private infoEl: HTMLDivElement;

  private open_ = false;
  private onClose: (() => void) | null = null;

  /** 视图：中心世界坐标 + 像素/米 */
  private centerX = 0;
  private centerZ = 0;
  private scale = 3;
  /** 跟随玩家（拖动后关闭；「回到玩家」恢复） */
  private follow = true;
  private dragging = false;
  /** ★ 本次按下是否已越过拖拽阈值（决定"松手 = 单击放置标记"还是"平移结束"） */
  private dragMoved = false;
  private dragDown = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };
  /** ★ 上一帧 render 的视口原点 + 缩放（单击 → 世界坐标反算用；与画面严格一致） */
  private lastX0 = 0;
  private lastZ0 = 0;
  /** ★ 新建标记用的颜色（顶部色板；避开蓝与灰白，见 MARKER_PALETTE） */
  private activeColor: string = MARKER_COLOR;
  private swatches: { el: HTMLButtonElement; color: string }[] = [];
  /** ★ 临时提示（如"标记已满"）——覆盖信息行，几秒后自动恢复 */
  private warnText: string | null = null;
  private warnTimer: number | undefined;
  private redrawAccum = 0;
  private dirty = true;

  constructor(
    private readonly raster: RasterMap,
    private readonly memory: MapPanelMemory,
    /** ★ 玩家标记点（与 Minimap / NavHints 共用同一份实例） */
    private readonly markers: MapMarkers,
    parent: HTMLElement = document.body,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'width:min(1040px,92vw)', 'box-sizing:border-box', 'padding:12px 14px',
      'display:none', 'flex-direction:column', 'gap:8px',
      'background:rgba(8,13,22,0.97)', 'border:1px solid rgba(110,170,235,0.45)',
      'border-radius:12px', 'box-shadow:0 10px 40px rgba(0,0,0,0.6)',
      'color:#e8f0fa', 'font:14px "Microsoft YaHei",sans-serif', 'user-select:none',
    ].join(';');

    // 标题栏
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const title = document.createElement('div');
    title.textContent = '世界地图';
    title.style.cssText = 'font-size:16px;font-weight:bold;color:#8ac8ff;letter-spacing:2px;';
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1 1 auto;';
    const mkBtn = (label: string, cb: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = [
        'padding:5px 14px', 'cursor:pointer', 'border-radius:6px',
        'font:13px "Microsoft YaHei",sans-serif', 'color:#cfe8ff',
        'background:rgba(26,44,68,0.9)', 'border:1px solid rgba(110,170,235,0.45)',
      ].join(';');
      b.addEventListener('click', cb);
      return b;
    };
    const recenter = mkBtn('回到玩家', () => { this.follow = true; this.dirty = true; });
    // ★ 清除标记走"再点一次确认"：一发误点删掉二十几个玩家放的点，比多点一次难受得多
    let clearArmed = false;
    const clearMarks = mkBtn('清除标记', () => {
      if (!clearArmed) {
        clearArmed = true;
        clearMarks.textContent = '再点一次确认';
        this.showWarn(`再点一次「清除标记」将删除全部 ${this.markers.count} 个标记`);
        window.setTimeout(() => {
          clearArmed = false;
          clearMarks.textContent = '清除标记';
        }, 3000);
        return;
      }
      clearArmed = false;
      clearMarks.textContent = '清除标记';
      this.markers.clear();
      this.dirty = true;
    });
    const close = mkBtn('关闭 (M)', () => this.onClose?.());
    // ★ 标记色板（选中的颜色 = 之后放置的标记色；每个标记记住自己的颜色）
    head.append(title, this.buildPalette(), spacer, recenter, clearMarks, close);

    // 画布
    const box = document.createElement('div');
    box.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;border:1px solid rgba(70,110,160,0.4);';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.style.cssText = [
      'display:block', 'width:100%', 'height:auto', 'cursor:grab',
      'image-rendering:pixelated', 'background:#04060a', 'touch-action:none',
    ].join(';');
    this.ctx = this.canvas.getContext('2d')!;
    this.gate = document.createElement('div');
    box.append(this.canvas, this.gate);

    // 底部信息
    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = 'font-size:12px;color:#7fa8cd;line-height:1.6;';

    this.root.append(head, box, this.infoEl);

    // 离屏（1 像素 = 1 米；放大绘制）
    this.off = document.createElement('canvas');
    this.off.width = 1;
    this.off.height = 1;
    this.offCtx = this.off.getContext('2d')!;

    // ---- 交互 ----
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * f));
      this.dirty = true;
    }, { passive: false });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // 只认左键（拖拽平移 + 单击标记）
      this.dragging = true;
      this.dragMoved = false;
      this.dragDown = { x: e.clientX, y: e.clientY };
      this.dragLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    // ★ 位移阈值：越过才进入"平移"（同时关闭跟随）；没越过 → 松手算单击（放置/删除标记）。
    //   原实现在 mousedown 就 follow=false → 单纯点一下也会把跟随关掉。
    const onMove = (e: MouseEvent): void => {
      if (!this.dragging) return;
      if (!this.dragMoved) {
        const far = Math.abs(e.clientX - this.dragDown.x) + Math.abs(e.clientY - this.dragDown.y);
        if (far < DRAG_SLOP_PX) return;
        this.dragMoved = true;
        this.follow = false;
        this.dragLast = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
      }
      const rect = this.canvas.getBoundingClientRect();
      const k = CANVAS_W / Math.max(1, rect.width);
      this.centerX -= (e.clientX - this.dragLast.x) * k / this.scale;
      this.centerZ -= (e.clientY - this.dragLast.y) * k / this.scale;
      this.dragLast = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    };
    const onUp = (e: MouseEvent): void => {
      if (!this.dragging) return;
      const moved = this.dragMoved;
      this.dragging = false;
      this.dragMoved = false;
      this.canvas.style.cursor = 'grab';
      if (!moved && this.open_ && e.button === 0) this.handleClick(e);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this._onMove = onMove;
    this._onUp = onUp;

    parent.appendChild(this.root);
  }

  private _onMove: (e: MouseEvent) => void;
  private _onUp: (e: MouseEvent) => void;

  get isOpen(): boolean {
    return this.open_;
  }

  open(onClose: () => void): void {
    this.onClose = onClose;
    this.open_ = true;
    this.follow = true;
    this.dirty = true;
    this.root.style.display = 'flex';
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.onClose = null;
    this.dragging = false;
    this.dragMoved = false;
    this.root.style.display = 'none';
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    this.close();
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    this.root.remove();
  }

  /** ★ 每帧驱动（打开时；重绘节流 ~8Hz，拖拽/缩放/标记立即）
   *  `swarm` = 蜂群代理池（远层敌人；可空）：>35m 的敌人不是 EntityBase，
   *  只遍历 entities 会让大地图实际只看得到 35m 内（2026-09-15 用户反馈修复）。 */
  update(
    dt: number,
    px: number,
    pz: number,
    yaw: number,
    entities: EntityBase[],
    swarm?: { readonly x: Float32Array; readonly z: Float32Array; readonly count: number } | null,
  ): void {
    if (!this.open_) return;
    if (this.follow) {
      // ★ 跟随：只更新中心，**不再每帧置 dirty** —— 原先这里每帧 dirty=true，
      //   把下面的 0.12s 节流完全废掉，整幅重绘以 60Hz 空转（大地图掉到十几帧的主因）。
      //   跟随由节流按 ~8Hz 驱动足够（地图不是实时仪表），拖拽/缩放仍走 dirty 立即重绘。
      this.centerX = px;
      this.centerZ = pz;
    }
    this.redrawAccum += dt;
    if (this.dirty || this.redrawAccum >= REDRAW_SEC) {
      this.redrawAccum = 0;
      this.dirty = false;
      this.render(px, pz, yaw, entities, swarm);
    }
  }

  // ============================================================
  // 渲染
  // ============================================================

  /**
   * ★ 单击（未拖动）：点在图上的已有标记上 → 删除它；否则在该处放置新标记。
   * 反算用上一帧 render 存下的 lastX0/lastZ0/scale → 与画面所见严格一致
   * （不用「当前 center」重算：节流期间 center 可能已前进半帧，会偏几米）。
   */
  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const k = CANVAS_W / rect.width;
    const cx = (e.clientX - rect.left) * k;
    const cy = (e.clientY - rect.top) * k;
    if (cx < 0 || cy < 0 || cx > CANVAS_W || cy > CANVAS_H) return;
    const wx = this.lastX0 + cx / this.scale;
    const wz = this.lastZ0 + cy / this.scale;
    // 命中已有标记（屏幕半径换算成米）→ 删除；否则放置（用色板当前颜色）
    const hitR = MARKER_HIT_PX / this.scale;
    if (this.markers.removeNear(wx, wz, hitR)) {
      this.dirty = true;
      return;
    }
    // ★ 兜底：上限已放宽到 int max（实际不可达）。真触到也明确提示，绝不静默丢标记
    if (this.markers.add(wx, wz, this.activeColor) === null) {
      this.showWarn('标记数量已达上限，点已有标记可删除，或用「清除标记」');
    }
    this.dirty = true;
  }

  /** 临时提示（覆盖信息行 + 变红，几秒后自动恢复；节流重绘期间也保持可见） */
  private showWarn(msg: string): void {
    this.warnText = msg;
    clearTimeout(this.warnTimer);
    this.warnTimer = window.setTimeout(() => {
      this.warnText = null;
      this.dirty = true;
    }, 3000);
    this.dirty = true;
  }

  /** ★ 标记色板（标题右侧一排小色块；点击切换"新建标记"的颜色） */
  private buildPalette(): HTMLDivElement {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;align-items:center;gap:5px;';
    const label = document.createElement('span');
    label.textContent = '标记颜色';
    label.style.cssText = 'font-size:12px;color:#7fa8cd;';
    box.appendChild(label);
    for (const c of MARKER_PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = `新建标记用 ${c}`;
      b.style.cssText = `width:18px;height:18px;padding:0;border-radius:4px;cursor:pointer;background:${c};`;
      b.addEventListener('click', () => {
        this.activeColor = c;
        this.syncSwatches();
      });
      this.swatches.push({ el: b, color: c });
      box.appendChild(b);
    }
    this.syncSwatches();
    return box;
  }

  /** 色板选中态（选中 = 白描边 + 同色外发光 + 微放大） */
  private syncSwatches(): void {
    for (const s of this.swatches) {
      const on = s.color === this.activeColor;
      s.el.style.border = on ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.3)';
      s.el.style.boxShadow = on ? `0 0 8px ${s.color}` : 'none';
      s.el.style.transform = on ? 'scale(1.12)' : 'none';
    }
  }

  private render(
    px: number,
    pz: number,
    yaw: number,
    entities: EntityBase[],
    swarm?: { readonly x: Float32Array; readonly z: Float32Array; readonly count: number } | null,
  ): void {
    const vw = Math.max(8, Math.ceil(CANVAS_W / this.scale));
    const vh = Math.max(8, Math.ceil(CANVAS_H / this.scale));
    // ★ 采样预算闸门：vw*vh 超上限 → 1 个离屏像素代表 step 米（防缩小时像素数平方爆炸）
    const step = Math.max(1, Math.ceil(Math.sqrt((vw * vh) / MAX_SAMPLE_PX)));
    const ow = Math.max(8, Math.ceil(vw / step));
    const oh = Math.max(8, Math.ceil(vh / step));
    const x0 = Math.floor(this.centerX - vw / 2);
    const z0 = Math.floor(this.centerZ - vh / 2);
    // ★ 单击反算基准（与画面所见严格一致；见 handleClick）
    this.lastX0 = x0;
    this.lastZ0 = z0;

    // 离屏底图（1 离屏像素 = step 米；持久表取色，无记录 = 未探索暗色）
    if (this.off.width !== ow || this.off.height !== oh) {
      this.off.width = ow;
      this.off.height = oh;
      this.img = null;
    }
    if (!this.img) this.img = this.offCtx.createImageData(ow, oh);
    const img = this.img;
    const d = img.data;
    // 采样点取 step×step 块中心（step=1 时 = +0，与原先逐格一致）
    const half = step >> 1;
    for (let iz = 0; iz < oh; iz++) {
      const wz = z0 + iz * step + half;
      for (let ix = 0; ix < ow; ix++) {
        const wx = x0 + ix * step + half;
        const i = (iz * ow + ix) * 4;
        if (this.memory.isExplored(wx, wz)) {
          // ★ 地形记录取色（实时 chunk 优先，卸载回放 blockTypes 快照）
          const packed = this.raster.mapColorAt(wx, wz);
          d[i] = (packed >> 16) & 255;
          d[i + 1] = (packed >> 8) & 255;
          d[i + 2] = packed & 255;
        } else {
          d[i] = DARK[0];
          d[i + 1] = DARK[1];
          d[i + 2] = DARK[2];
        }
        d[i + 3] = 255;
      }
    }
    this.offCtx.putImageData(img, 0, 0);

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.off, 0, 0, ow, oh, 0, 0, vw * this.scale, vh * this.scale);

    // 区块网格（60m；淡线）
    ctx.strokeStyle = 'rgba(120,170,220,0.12)';
    ctx.lineWidth = 1;
    const gx0 = Math.ceil(x0 / CHUNK_SIZE) * CHUNK_SIZE;
    for (let wx = gx0; wx < x0 + vw; wx += CHUNK_SIZE) {
      const sx = Math.round((wx - x0) * this.scale) + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, CANVAS_H); ctx.stroke();
    }
    const gz0 = Math.ceil(z0 / CHUNK_SIZE) * CHUNK_SIZE;
    for (let wz = gz0; wz < z0 + vh; wz += CHUNK_SIZE) {
      const sy = Math.round((wz - z0) * this.scale) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(CANVAS_W, sy); ctx.stroke();
    }

    // 实体标记（玩家/舰船单独画：见下面 mapIcons 那段）
    const toX = (wx: number): number => (wx - x0) * this.scale;
    const toY = (wz: number): number => (wz - z0) * this.scale;
    // ★ 先取舰船坐标：敌人播报 = 玩家视野 ∪ 舰船雷达（同循环内顺序不定，必须预扫）
    let shipX = NaN;
    let shipZ = NaN;
    for (const e of entities) {
      if (e.minimapInfo.kind !== 'ship') continue;
      shipX = e.position.x;
      shipZ = e.position.z;
      break;
    }
    for (const e of entities) {
      const info = e.minimapInfo;
      if (info.kind === 'player' || info.kind === 'decoration') continue;
      const ex = e.position.x;
      const ez = e.position.z;
      if (info.kind === 'ship') continue;
      if (info.kind === 'item' && info.moving) continue;
      if (info.kind === 'enemy') {
        // ★ 只播报（玩家视野半径）或（舰船雷达半径）内的敌人 —— 与小地图同一条规则
        const edx = ex - px;
        const edz = ez - pz;
        if (edx * edx + edz * edz > SIGHT_R_SQ) {
          if (Number.isNaN(shipX)) continue;
          const sdx = ex - shipX;
          const sdz = ez - shipZ;
          if (sdx * sdx + sdz * sdz > SHIP_R_SQ) continue;
        }
      }
      const sx = toX(ex);
      const sy = toY(ez);
      if (sx < -6 || sy < -6 || sx > CANVAS_W + 6 || sy > CANVAS_H + 6) continue;
      ctx.fillStyle = info.kind === 'enemy' ? '#ff4444'
        : info.kind === 'ship' ? '#66e0ff'
        : info.kind === 'npc' ? '#ffd75e'
        : '#ffdd55';
      const s = info.kind === 'npc' ? 5 : 3;
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }

    // ★ 远层代理（>35m 敌人）：同一半径规则（玩家视野 ∪ 舰船雷达）与同一配色
    if (swarm) {
      ctx.fillStyle = '#ff4444';
      for (let i = 0; i < swarm.count; i++) {
        const ex = swarm.x[i];
        const ez = swarm.z[i];
        const edx = ex - px;
        const edz = ez - pz;
        if (edx * edx + edz * edz > SIGHT_R_SQ) {
          if (Number.isNaN(shipX)) continue;
          const sdx = ex - shipX;
          const sdz = ez - shipZ;
          if (sdx * sdx + sdz * sdz > SHIP_R_SQ) continue;
        }
        const sx = toX(ex);
        const sy = toY(ez);
        if (sx < -6 || sy < -6 || sx > CANVAS_W + 6 || sy > CANVAS_H + 6) continue;
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }

    // ★ 舰船 / 标记点 / 出屏方位：与 Minimap 共用 mapIcons（形状、配色、呼吸一致）
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0035);
    const hw = CANVAS_W / 2 - EDGE_PAD;
    const hh = CANVAS_H / 2 - EDGE_PAD;
    const midX = CANVAS_W / 2;
    const midY = CANVAS_H / 2;
    if (!Number.isNaN(shipX)) {
      const dPx = (shipX - this.centerX) * this.scale;
      const dPy = (shipZ - this.centerZ) * this.scale;
      if (Math.abs(dPx) <= hw && Math.abs(dPy) <= hh) {
        drawShipIcon(ctx, midX + dPx, midY + dPy, 6, pulse);
        this.drawLabel(ctx, '舰船', midX + dPx, midY + dPy + 17, SHIP_COLOR);
        this.drawLabel(
          ctx, `${Math.round(Math.hypot(shipX - px, shipZ - pz))}m`,
          midX + dPx, midY + dPy - 17, SHIP_COLOR,
        );
      } else {
        drawOffscreenIndicator(
          ctx, midX, midY, dPx, dPy, hw, hh, SHIP_COLOR, pulse,
          Math.hypot(shipX - px, shipZ - pz),
        );
      }
    }
    for (let i = 0; i < this.markers.count; i++) {
      const m = this.markers.items[i];
      const dPx = (m.x - this.centerX) * this.scale;
      const dPy = (m.z - this.centerZ) * this.scale;
      const dist = Math.hypot(m.x - px, m.z - pz);
      if (Math.abs(dPx) <= hw && Math.abs(dPy) <= hh) {
        drawMarkerIcon(ctx, midX + dPx, midY + dPy, 5, m.color, pulse);
        this.drawLabel(ctx, m.label, midX + dPx, midY + dPy + 16, m.color);
      } else {
        drawOffscreenIndicator(ctx, midX, midY, dPx, dPy, hw, hh, m.color, pulse, dist);
      }
    }
    // 玩家箭头（屏幕朝向 = 相机偏航；与 Minimap 同款旋转 → mapIcons 同款形状）
    drawPlayerArrow(ctx, toX(px), toY(pz), 9, Math.PI - yaw);

    // 信息行（临时提示优先：变红盖住一整行）
    if (this.warnText) {
      this.infoEl.textContent = `⚠ ${this.warnText}`;
      this.infoEl.style.color = '#ff9a9a';
      return;
    }
    this.infoEl.style.color = '#7fa8cd';
    const fmt = (v: number): string => v.toFixed(1);
    this.infoEl.textContent =
      `已探索 ${this.memory.exploredCount} 格　·　视野中心 (${fmt(this.centerX)}, ${fmt(this.centerZ)})`
      + `${this.follow ? '（跟随玩家）' : '（拖拽定位）'}　·　缩放 ${this.scale.toFixed(1)} 像素/米`
      + `　·　标记 ${this.markers.count} 个`
      + '　·　左键点击=放置/删除标记（颜色取上方色块）　·　白=玩家 青=舰船 黄=NPC 红=敌人';
  }

  /** 地图上的小标签（深色描边保证压在任何地表色上都能读） */
  private drawLabel(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string,
  ): void {
    ctx.font = 'bold 12px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(4,8,12,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open_) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.onClose?.();
    }
  };
}
