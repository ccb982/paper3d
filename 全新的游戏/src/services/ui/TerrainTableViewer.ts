// ============================================================
// TerrainTableViewer —— 地形表实时可视化（?l1view=1；读**当前这一局**）
// ============================================================
// 七联图（每格 4m、覆盖 ±144m）：
//   上排 = 新 L1 语义表（纯初始地形）：语义分类 / 坡向（迎红背蓝+箭头）/ 隐蔽
//   下排 = 创建时原始地形：地块本色 / 基准高度（阴影）/ genRole（+洋红=已挖改）
//   末 = 工事层·坑洞分热力（HoleTable：深×近，敌读；独立掩码 HoleMask 同源）
// 数据每次从当前世界重采样（1Hz）；挖地、换落点、掩体变化都会反映。
// DOM canvas 覆盖层（pointer-events 仅面板上开启）；无 flag 时不创建（零开销）。
// ============================================================

import type { RasterMap } from '../map/RasterMap';
import type { TerrainSemantics } from '../../systems/swarm/TerrainSemantics';
import type { HoleMask } from '../../systems/swarm/HoleMask';
import type { HoleTable } from '../../systems/swarm/HoleTable';

const SIDE = 73;
const CELL = 4;
const R = 144;
const N = SIDE * SIDE;
const SEM_NAMES = ['中性', '高地', '低谷', '迎船坡', '背船坡', '关口', '走廊', '开阔地', '隐蔽', '陡壁', '水', '坑'];
const ROLE_NAMES = ['ground', 'platform', 'liquid', 'pit', '?'];

const CLS_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 72, 80], [255, 209, 102], [77, 150, 255], [255, 107, 53], [46, 196, 182], [230, 57, 70],
  [181, 23, 158], [141, 153, 174], [87, 117, 144], [34, 34, 34], [17, 138, 178], [0, 0, 0],
];
const ROLE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [107, 143, 71], [176, 137, 104], [17, 138, 178], [10, 10, 10], [80, 80, 80],
];

const PANELS: ReadonlyArray<{ title: string; legend: string }> = [
  {
    title: 'L1 语义分类',
    legend: SEM_NAMES.map((n, i) => `<span><i style="background:rgb(${CLS_COLORS[i]})"></i>${n}</span>`).join(''),
  },
  {
    title: 'L1 坡向（红=迎船/进攻向，蓝=背船/防守向）',
    legend: '<span><i style="background:rgb(255,107,53)"></i>迎船</span><span><i style="background:rgb(46,196,182)"></i>背船</span><span><i style="background:rgb(68,72,80)"></i>非坡</span>',
  },
  {
    title: 'L1 隐蔽（暗红=对舰船 LOS 被挡）',
    legend: '<span><i style="background:rgb(87,117,144)"></i>可见</span><span><i style="background:rgb(140,30,30)"></i>隐蔽</span>',
  },
  {
    title: '创建时·地块本色',
    legend: '<span>生成器基色（同小地图）</span>',
  },
  {
    title: '创建时·基准高度（未挖；阴影=山体）',
    legend: '<span><i style="background:rgb(40,40,40)"></i>低</span><span><i style="background:rgb(235,235,235)"></i>高</span><span><i style="background:rgb(17,138,178)"></i>水</span>',
  },
  {
    title: '创建时·genRole（洋红=已挖改）',
    legend: ROLE_NAMES.slice(0, 4).map((n, i) => `<span><i style="background:rgb(${ROLE_COLORS[i]})"></i>${n}</span>`).join('')
      + '<span><i style="background:rgb(255,0,255)"></i>已挖改</span>',
  },
  {
    title: '工事层·坑洞分（深×近 0~1，敌读动态表）',
    legend: '<span><i style="background:rgb(13,32,76)"></i>浅/远(低)</span><span><i style="background:rgb(31,120,180)"></i>中</span>'
      + '<span><i style="background:rgb(255,255,109)"></i>高</span><span><i style="background:rgb(255,0,0)"></i>满</span>'
      + '<span><i style="background:rgb(120,80,180)"></i>坑洞代表点</span>',
  },
];

export class TerrainTableViewer {
  private readonly root: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly meta: HTMLDivElement;
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly ctxs: CanvasRenderingContext2D[] = [];
  private accum = 1e9;
  private ax = 0;
  private az = 0;
  private l1cls = new Uint8Array(N);
  private aspect = new Float32Array(N);
  private slope = new Float32Array(N);
  private blocked = new Uint8Array(N);
  private pass = new Uint8Array(N);
  private region = new Int16Array(N);
  private dhx = new Float32Array(N);
  private dhz = new Float32Array(N);
  private base = new Float32Array(N);
  private cur = new Float32Array(N);
  private dig = new Float32Array(N);
  private role = new Uint8Array(N);
  private color = new Uint32Array(N);
  private hd = new Float32Array(N);     // 掩码深（m）
  private hp = new Float32Array(N);     // 坑洞分（0..1）
  private bhMin = 0;
  private bhMax = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;left:10px;top:10px;z-index:40;background:#14161aee;border:1px solid #2b303a;'
      + 'border-radius:10px;padding:10px 12px;width:660px;color:#d8dee9;font:12px/1.45 "Microsoft YaHei",system-ui,sans-serif;'
      + 'box-shadow:0 6px 28px #000a;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:move;user-select:none;';
    head.innerHTML = '<b style="font-size:13px">地形表实时视图</b>'
      + '<span style="color:#8b95a5">L1 语义（新） vs 创建时原始地形（旧）</span>';
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'margin-left:auto;background:#2b303a;color:#d8dee9;border:1px solid #39404d;border-radius:6px;'
      + 'padding:2px 10px;cursor:pointer;';
    close.onclick = () => this.dispose();
    head.appendChild(close);
    this.root.appendChild(head);
    this.meta = document.createElement('div');
    this.meta.style.cssText = 'color:#a9b4c4;margin:4px 0 8px;white-space:pre-wrap;';
    this.meta.textContent = '等待落点扫描…';
    this.root.appendChild(this.meta);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;';
    for (let k = 0; k < 7; k++) {
      const box = document.createElement('div');
      box.style.cssText = 'background:#1b1e24;border:1px solid #2b303a;border-radius:8px;padding:6px;';
      const h = document.createElement('div');
      h.style.cssText = 'font-size:11px;color:#e6edf7;margin-bottom:5px;';
      h.textContent = PANELS[k].title;
      const cv = document.createElement('canvas');
      cv.width = SIDE; cv.height = SIDE;
      cv.style.cssText = 'width:100%;image-rendering:pixelated;display:block;background:#000;border-radius:4px;cursor:crosshair;';
      const lg = document.createElement('div');
      lg.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:5px;font-size:10px;color:#aab4c4;';
      lg.innerHTML = PANELS[k].legend;
      box.append(h, cv, lg);
      grid.appendChild(box);
      this.canvases.push(cv);
      this.ctxs.push(cv.getContext('2d')!);
    }
    this.root.appendChild(grid);
    this.tip = document.createElement('div');
    this.tip.style.cssText = 'position:fixed;pointer-events:none;background:#0d1117f2;border:1px solid #39404d;border-radius:6px;'
      + 'padding:7px 9px;font-size:11px;white-space:pre;display:none;z-index:41;box-shadow:0 4px 18px #0009;';
    document.body.append(this.root, this.tip);
    this.installHover();
    this.installDrag(head);
  }

  /** 由 WorldMode 每帧调用（内部 1Hz 限流） */
  tick(l1: TerrainSemantics | null, raster: RasterMap, mask: HoleMask | null, table: HoleTable | null, dt: number): void {
    this.accum += dt;
    if (this.accum < 1) return;
    this.accum = 0;
    if (!l1 || !l1.isReady) { this.meta.textContent = '等待落点扫描…'; return; }
    this.sampleAndDraw(l1, raster, mask, table);
  }

  dispose(): void {
    this.root.remove();
    this.tip.remove();
  }

  // ============================================================
  // 内部
  // ============================================================

  private sampleAndDraw(l1: TerrainSemantics, raster: RasterMap,
    mask: HoleMask | null, table: HoleTable | null): void {
    const a = l1.anchor;
    this.ax = a.x;
    this.az = a.z;
    const sx = a.x - R, sz = a.z - R;
    const o = { x: 0, z: 0 };
    let dug = 0, roleHist = [0, 0, 0, 0, 0];
    this.bhMin = 1e9; this.bhMax = -1e9;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const x = sx + ix * CELL + CELL / 2;
        const z = sz + iz * CELL + CELL / 2;
        this.l1cls[i] = l1.classAt(x, z);
        this.aspect[i] = l1.aspectAt(x, z);
        this.slope[i] = l1.slopeAt(x, z);
        this.blocked[i] = l1.losBlockedAt(x, z) ? 1 : 0;
        this.pass[i] = l1.isPassableAt(x, z) ? 1 : 0;
        this.region[i] = l1.regionIdAt(x, z);
        l1.downhillInto(x, z, o);
        this.dhx[i] = o.x; this.dhz[i] = o.z;
        this.base[i] = raster.baseSurfaceHeightAt(x, z) + raster.levelDepthAt(x, z);   // ★ 创建时原始面（未挖）
        this.cur[i] = raster.surfaceHeightAt(x, z);
        this.dig[i] = raster.levelDepthAt(x, z);   // ★ 真·挖掘深度（战壕判定同源）
        this.hp[i] = table ? table.scoreAt(x, z) : 0;
        this.hd[i] = mask ? mask.depthAt(x, z) : 0;
        const td = raster.tileDefAt(x, z);
        this.role[i] = td.genRole === 'ground' ? 0 : td.genRole === 'platform' ? 1 : td.genRole === 'liquid' ? 2 : td.genRole === 'pit' ? 3 : 4;
        roleHist[this.role[i]]++;
        const c = raster.terrainColorAt(x, z);
        this.color[i] = ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
        if (this.dig[i] > 0.05) dug++;
        if (this.base[i] < this.bhMin) this.bhMin = this.base[i];
        if (this.base[i] > this.bhMax) this.bhMax = this.base[i];
      }
    }
    this.drawPanels();
    if (table && table.holes.length) this.drawHolePts(table);
    const st = l1.stats();
    this.meta.textContent = `舰船 (${a.x.toFixed(0)}, ${a.z.toFixed(0)}) · L1 ${st.buildMs}ms 区块 ${st.regionCount}`
      + ` · genRole g${roleHist[0]}/p${roleHist[1]}/l${roleHist[2]}/pit${roleHist[3]}`
      + ` · 已挖改 ${dug} 格 · 坑洞表 ${table?.holes.length ?? 0} 条`
      + ` (顶分 ${(table?.holes[0]?.score ?? 0).toFixed(2)})`
      + ` · ${new Date().toLocaleTimeString('zh-CN')}`;
  }

  private drawPanels(): void {
    const ctxs = this.ctxs;
    for (let i = 0; i < N; i++) {
      const ix = i % SIDE, iz = (i - ix) / SIDE;
      // 1 语义
      const c = CLS_COLORS[this.l1cls[i]];
      this.px(ctxs[0], ix, iz, c[0], c[1], c[2]);
      // 2 坡向
      const cls = this.l1cls[i];
      if (cls === 3 || cls === 4) {
        const t = Math.max(-1, Math.min(1, this.aspect[i]));
        this.px(ctxs[1], ix, iz, t >= 0 ? 255 : 46, t >= 0 ? 107 : 196, t >= 0 ? 53 : 182, 0.35 + Math.abs(t) * 0.65);
      } else this.px(ctxs[1], ix, iz, 30, 32, 36);
      // 3 隐蔽
      if (this.blocked[i]) this.px(ctxs[2], ix, iz, 140, 30, 30);
      else this.px(ctxs[2], ix, iz, cls === 9 ? 80 : 87, cls === 9 ? 80 : 117, cls === 9 ? 80 : 144);
      // 4 地块本色
      const rgb = this.color[i];
      this.px(ctxs[3], ix, iz, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
      // 5 基准高度 + 阴影
      const g = (this.base[i] - this.bhMin) / ((this.bhMax - this.bhMin) || 1);
      const iL = ix > 0 ? i - 1 : i, iR = ix < SIDE - 1 ? i + 1 : i;
      const iU = iz > 0 ? i - SIDE : i, iD = iz < SIDE - 1 ? i + SIDE : i;
      const dx = (this.base[iR] - this.base[iL]) / 8, dz = (this.base[iD] - this.base[iU]) / 8;
      const shade = Math.max(0.35, Math.min(1.3, 0.85 + (-dx - dz) * 0.9));
      const v = Math.max(0, Math.min(255, (40 + g * 195) * shade));
      if (this.role[i] === 3) this.px(ctxs[4], ix, iz, 0, 0, 0);
      else if (this.role[i] === 2) this.px(ctxs[4], ix, iz, 17, 138, 178);
      else this.px(ctxs[4], ix, iz, v, v, v);
      // 6 genRole + 挖改
      const rc = ROLE_COLORS[this.role[i]];
      this.px(ctxs[5], ix, iz, rc[0], rc[1], rc[2]);
      if (Math.abs(this.cur[i] - this.base[i]) > 0.05) this.px(ctxs[5], ix, iz, 255, 0, 255);
      // 7 坑洞分热力（HoleTable 打分；低=深蓝 → 高=黄 → 满=红）
      const h = this.hp[i];
      if (h > 0) {
        const t = Math.min(1, h);
        const r = Math.round(255 * Math.min(1, t * 2) * t), gg = Math.round(255 * Math.min(1, (1 - Math.abs(t - 0.5) * 2)) * t),
          b = Math.round(255 * Math.max(0, 1 - t * 1.6));
        this.px(ctxs[6], ix, iz, r, gg, b);
      } else this.px(ctxs[6], ix, iz, 21, 26, 33);
    }
    for (const ctx of ctxs) this.drawOverlay(ctx);
  }

  /** 第 7 面板：坑洞代表点（紫框）+ 构造掩体（青=挡射界/灰=暴露）（描在热力之上） */
  private drawHolePts(table: HoleTable): void {
    const ctx = this.ctxs[6];
    if (!ctx) return;
    ctx.strokeStyle = 'rgb(160,95,255)';
    ctx.lineWidth = 1;
    for (const h of table.holes.slice(0, 24)) {
      const ix = Math.floor((h.cx - (this.ax - R)) / CELL);
      const iz = Math.floor((h.cz - (this.az - R)) / CELL);
      if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) continue;
      ctx.strokeRect(ix - 1, iz - 1, 3, 3);
    }
    for (const c of table.covers) {
      const ix = Math.floor((c.x - (this.ax - R)) / CELL);
      const iz = Math.floor((c.z - (this.az - R)) / CELL);
      if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) continue;
      ctx.fillStyle = c.hidden ? 'rgb(46,230,255)' : 'rgb(150,160,175)';
      ctx.fillRect(ix - 1, iz - 1, 2, 2);
    }
  }

  private px(ctx: CanvasRenderingContext2D, ix: number, iz: number, r: number, g: number, b: number, a = 1): void {
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
    ctx.fillRect(ix, iz, 1, 1);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 0.5;
    for (let k = 0; k <= SIDE; k += 8) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, SIDE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(SIDE, k); ctx.stroke();
    }
    const ax = Math.round((R - 2) / CELL), az = ax;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax - 4, az); ctx.lineTo(ax + 4, az); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax, az - 4); ctx.lineTo(ax, az + 4); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax, az, 3, 0, Math.PI * 2); ctx.stroke();
  }

  private installHover(): void {
    for (const cv of this.canvases) {
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        const ix = Math.floor(((e.clientX - r.left) / r.width) * SIDE);
        const iz = Math.floor(((e.clientY - r.top) / r.height) * SIDE);
        if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return;
        const i = iz * SIDE + ix;
        const wx = this.ax - R + ix * CELL + CELL / 2;
        const wz = this.az - R + iz * CELL + CELL / 2;
        const d = Math.hypot(wx - this.ax, wz - this.az);
        const dug = this.dig[i];
        this.tip.style.display = 'block';
        this.tip.style.left = Math.min(window.innerWidth - 270, e.clientX + 14) + 'px';
        this.tip.style.top = (e.clientY + 14) + 'px';
        this.tip.textContent =
          `格 (${ix},${iz})  世界 (${wx.toFixed(0)},${wz.toFixed(0)})  离船 ${d.toFixed(0)}m\n`
          + `— L1 —\n  语义 ${SEM_NAMES[this.l1cls[i]]}  区块 #${this.region[i]}\n`
          + `  坡向 ${this.aspect[i].toFixed(2)}  坡度 ${this.slope[i].toFixed(2)}\n`
          + `  可走 ${this.pass[i] ? '是' : '否'}  隐蔽 ${this.blocked[i] ? '是' : '否'}\n`
          + `— 创建时 —\n  genRole ${ROLE_NAMES[this.role[i]]}\n`
          + `  基准高 ${this.base[i].toFixed(2)}m  当前高 ${this.cur[i].toFixed(2)}m\n`
          + `  挖改 ${dug >= 0 ? '+' : ''}${dug.toFixed(2)}m\n`
          + `— 坑洞 —\n  掩码深 ${this.hd[i].toFixed(2)}m  坑洞分 ${this.hp[i].toFixed(2)}`;
      });
      cv.addEventListener('mouseleave', () => { this.tip.style.display = 'none'; });
    }
  }

  private installDrag(handle: HTMLElement): void {
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const r = this.root.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.root.style.left = `${e.clientX - ox}px`;
      this.root.style.top = `${e.clientY - oy}px`;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }
}
