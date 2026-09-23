// ============================================================
// SpawnSelect —— 开局小地图选点（阶段 A：只读 RasterMap 数据，不建 3D）
//   · 无迷雾：地形数据到哪画到哪（mapColorAt 全彩）
//   · 可拖动平移（拖到哪、数据就在哪按需生成：updateChunks 只生成数据）
//   · 滚轮缩放；单击 = 落点；Enter/按钮 = 确认
// ============================================================
import { RasterMap } from '../services/map/RasterMap';

const DARK: [number, number, number] = [10, 14, 22];

export class SpawnSelect {
  spawn: { x: number; z: number } | null = null;
  onConfirm: ((x: number, z: number) => void) | null = null;
  /** ★ 换种子（主入口负责 new RasterMap 后回调 setRaster） */
  onSeed: ((seed: number) => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly coordEl: HTMLDivElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly titleEl: HTMLDivElement;
  private readonly seedInput: HTMLInputElement;
  private raster: RasterMap;
  private readonly box: number;
  private readonly off = 320;                 // 离屏像素（固定；放大上屏）
  private readonly img: ImageData;
  private readonly offCanvas: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private cx = 0;                              // 视图中心（世界米）
  private cz = 0;
  private spanM = 480;                         // 画布横跨多少米（滚轮 120~1200）
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;
  private lastRender = 0;
  private destroyed = false;

  constructor(raster: RasterMap, _worldR = 240) {
    this.raster = raster;
    this.box = Math.min(innerHeight * 0.74, innerWidth * 0.74, 780);

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:10000', 'display:flex',
      'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:10px',
      'background:rgba(4,7,12,0.97)', 'color:#dce8f5', 'font:14px "Microsoft YaHei",sans-serif',
      'user-select:none',
    ].join(';');
    const title = document.createElement('div');
    this.titleEl = title;
    title.textContent = `选择出生点（种子 ${raster.worldSeed}）——拖动平移 · 滚轮缩放 · 单击落点`;
    title.style.cssText = 'font-size:16px;color:#8ac8ff;letter-spacing:2px;';

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.box; this.canvas.height = this.box;
    this.canvas.style.cssText = `width:${this.box}px;height:${this.box}px;image-rendering:pixelated;border:1px solid rgba(110,170,235,0.45);border-radius:8px;cursor:grab;`;
    this.ctx = this.canvas.getContext('2d')!;
    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = this.off; this.offCanvas.height = this.off;
    this.offCtx = this.offCanvas.getContext('2d')!;
    this.img = this.offCtx.createImageData(this.off, this.off);

    this.coordEl = document.createElement('div');
    this.coordEl.textContent = `视图中心 (0, 0) · ${Math.round(this.spanM)}m 幅面 · 未选点`;
    this.coordEl.style.cssText = 'font:13px ui-monospace,Consolas,monospace;color:#9fd0ff;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;';
    this.confirmBtn = document.createElement('button');
    this.confirmBtn.textContent = '确认出生点';
    this.confirmBtn.disabled = true;
    this.confirmBtn.style.cssText = 'padding:6px 22px;cursor:pointer;border-radius:6px;font:14px "Microsoft YaHei",sans-serif;color:#dff0ff;background:rgba(26,60,96,0.95);border:1px solid rgba(110,170,235,0.6);';
    this.confirmBtn.addEventListener('click', () => this.confirm());
    const home = document.createElement('button');
    home.textContent = '回原点';
    home.style.cssText = this.confirmBtn.style.cssText;
    home.addEventListener('click', () => { this.cx = 0; this.cz = 0; this.render(); });
    // ★ 种子输入 + 实时换图
    this.seedInput = document.createElement('input');
    this.seedInput.type = 'number';
    this.seedInput.value = String(raster.worldSeed);
    this.seedInput.style.cssText = 'width:96px;padding:5px 8px;border-radius:6px;border:1px solid rgba(110,170,235,0.5);background:rgba(12,22,34,0.95);color:#dff0ff;font:13px ui-monospace,Consolas,monospace;';
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { e.stopPropagation(); this.applySeed(); }
    });
    const seedBtn = document.createElement('button');
    seedBtn.textContent = '换图';
    seedBtn.style.cssText = this.confirmBtn.style.cssText;
    seedBtn.addEventListener('click', () => this.applySeed());
    bar.append(this.coordEl, home, this.seedInput, seedBtn, this.confirmBtn);
    this.root.append(title, this.canvas, bar);
    document.body.appendChild(this.root);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.moved = 0;
      this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      const mpp = this.spanM / this.box;
      this.cx -= dx * mpp; this.cz -= dy * mpp;
      this.renderThrottled();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.canvas.style.cursor = 'grab';
      if (this.moved < 6) {                       // 单击 = 落点
        const r = this.canvas.getBoundingClientRect();
        const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
        const mpp = this.spanM / this.box;
        this.pick(this.cx + (u - 0.5) * this.spanM, this.cz + (v - 0.5) * this.spanM);
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.spanM = Math.max(120, Math.min(1200, this.spanM * (1 + Math.sign(e.deltaY) * 0.15)));
      this.render();
    }, { passive: false });
    addEventListener('keydown', this.onKey);
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => { if (e.code === 'Enter') this.confirm(); };

  /** ★ 换图：取输入框种子 → 交给主入口（new RasterMap）→ setRaster 重绘 */
  applySeed(): void {
    const s = Number(this.seedInput.value);
    if (!Number.isFinite(s)) return;
    this.onSeed?.(s);
  }

  /** ★ 主入口换好新 RasterMap 后回调：重置视图/选点，实时重绘 */
  setRaster(r: RasterMap): void {
    this.raster = r;
    this.cx = 0; this.cz = 0; this.spanM = 480;
    this.spawn = null;
    this.confirmBtn.disabled = true;
    this.titleEl.textContent = `选择出生点（种子 ${r.worldSeed}）——拖动平移 · 滚轮缩放 · 单击落点`;
    this.render();
  }

  private renderThrottled(): void {
    const now = performance.now();
    if (now - this.lastRender < 90) return;
    this.render();
  }

  /** 视图渲染：按窗口生成数据（只数据）→ 逐像素取色 → 上屏 + 网格 + 标记 */
  private render(): void {
    if (this.destroyed) return;
    this.lastRender = performance.now();
    const halfM = this.spanM / 2;
    const needR = Math.ceil(halfM / 60) + 1;
    for (let i = 0; i < 600; i++) {
      const added = this.raster.updateChunks(this.cx, this.cz, needR);
      if (added.length === 0 && i > 1) break;
    }
    const d = this.img.data;
    const mpp = this.spanM / this.off;
    const x0 = this.cx - halfM, z0 = this.cz - halfM;
    for (let iz = 0; iz < this.off; iz++) {
      const wz = z0 + (iz + 0.5) * mpp;
      for (let ix = 0; ix < this.off; ix++) {
        const wx = x0 + (ix + 0.5) * mpp;
        const packed = this.raster.mapColorAt(wx, wz);
        const i = (iz * this.off + ix) * 4;
        d[i] = (packed >> 16) & 255;
        d[i + 1] = (packed >> 8) & 255;
        d[i + 2] = packed & 255;
        d[i + 3] = 255;
      }
    }
    this.offCtx.putImageData(this.img, 0, 0);
    const g = this.ctx;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.offCanvas, 0, 0, this.box, this.box);
    // 60m 网格 + 原点轴
    g.strokeStyle = 'rgba(140,190,240,0.18)';
    g.lineWidth = 1;
    const gridStep = 60 / mpp;
    const ox = ((0 - x0) / this.spanM) * this.box, oz = ((0 - z0) / this.spanM) * this.box;
    if (gridStep > 6) {
      for (let t = ox % gridStep; t < this.box; t += gridStep) { g.beginPath(); g.moveTo(t, 0); g.lineTo(t, this.box); g.stroke(); }
      for (let t = oz % gridStep; t < this.box; t += gridStep) { g.beginPath(); g.moveTo(0, t); g.lineTo(this.box, t); g.stroke(); }
    }
    g.strokeStyle = 'rgba(255,220,120,0.35)';
    g.beginPath(); g.moveTo(ox, 0); g.lineTo(ox, this.box); g.moveTo(0, oz); g.lineTo(this.box, oz); g.stroke();
    if (this.spawn) {
      const t = ((this.spawn.x - x0) / this.spanM) * this.box;
      const u = ((this.spawn.z - z0) / this.spanM) * this.box;
      g.strokeStyle = '#ffd24a';
      g.lineWidth = 2;
      g.beginPath(); g.arc(t, u, 9, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(t - 16, u); g.lineTo(t + 16, u); g.moveTo(t, u - 16); g.lineTo(t, u + 16); g.stroke();
    }
    this.coordEl.textContent = `视图中心 (${this.cx.toFixed(0)}, ${this.cz.toFixed(0)}) · ${Math.round(this.spanM)}m 幅面 · ` +
      (this.spawn ? `出生点 (${this.spawn.x.toFixed(0)}, ${this.spawn.z.toFixed(0)})` : '未选点');
  }

  pick(wx: number, wz: number): void {
    this.spawn = { x: wx, z: wz };
    this.confirmBtn.disabled = false;
    this.render();
  }

  /** 探针：平移视图并渲染 */
  setCenter(x: number, z: number): void { this.cx = x; this.cz = z; this.render(); }

  confirmAt(x: number, z: number): void { this.pick(x, z); this.confirm(); }

  confirm(): void {
    if (this.destroyed || !this.spawn) return;
    const { x, z } = this.spawn;
    this.destroy();
    this.onConfirm?.(x, z);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
