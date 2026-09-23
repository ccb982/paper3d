// ============================================================
// NavDebugMap —— 命令检视小地图（RTS 侧调试 UI，外接只读）
//   打开方式：右侧列表点某条命令 → open(squadId, focus)
//   视图：滚轮缩放（span 40~600m）+ 拖拽平移；底图=地形语义色（随视图重烘）
//   覆盖：该队走廊（粗）/ 起点(绿) / 终点(黄叉) / 队令目标(红叉) / 队长(白点)
//          + 该队命令历史点（灰点连线 + 距今年龄）
// ============================================================
import { RasterMap } from '../services/map/RasterMap';
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';
import type { CommandLogEntry } from '../systems/swarm/CommandLedger';
import { orderCn } from './cn';

export class NavDebugMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly titleEl: HTMLDivElement;
  private readonly legendEl: HTMLDivElement;
  private readonly size = 560;
  private cx = 0;
  private cz = 0;
  private span = 160;
  private squadId: number | null = null;
  private dirtyBase = true;
  private lastBase = 0;
  private lastDraw = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  visible = false;

  constructor(
    private readonly raster: RasterMap,
    private readonly swarm: SwarmSystem,
    private readonly shipAt?: () => { x: number; z: number },
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:960', 'display:none', 'background:rgba(6,10,16,0.96)',
      'border:1px solid rgba(110,170,235,0.5)', 'border-radius:10px', 'padding:8px',
      'box-shadow:0 10px 40px rgba(0,0,0,0.6)',
    ].join(';');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 4px 8px;color:#dce8f5;font:13px "Microsoft YaHei",sans-serif;';
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'flex:1 1 auto;color:#8ac8ff;font-weight:bold;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭 (Esc)';
    closeBtn.style.cssText = 'padding:3px 10px;cursor:pointer;border-radius:6px;color:#dff0ff;background:rgba(26,60,96,0.95);border:1px solid rgba(110,170,235,0.6);';
    closeBtn.onclick = () => this.close();
    head.append(this.titleEl, closeBtn);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.cssText = 'image-rendering:pixelated;border:1px solid rgba(110,170,235,0.3);border-radius:6px;cursor:grab;display:block;';
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = 320;
    this.base.height = 320;
    this.baseCtx = this.base.getContext('2d')!;

    this.legendEl = document.createElement('div');
    this.legendEl.textContent = '走廊(彩色线) · 起始点(绿点) · 目标点(黄叉) · 命令目标(红叉) · 队长(白点) · 命令历史(点+文字) | 滚轮缩放 · 拖拽平移';
    this.legendEl.style.cssText = 'padding:6px 4px 0;color:#9fb4c8;font:11px Consolas,monospace;';

    this.root.append(head, this.canvas, this.legendEl);
    document.body.appendChild(this.root);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = 1 + Math.sign(e.deltaY) * 0.15;
      this.span = Math.max(40, Math.min(600, this.span * f));
      this.dirtyBase = true;
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      const mpp = this.span / this.size;
      this.cx -= dx * mpp;
      this.cz -= dy * mpp;
      this.dirtyBase = true;
      this.draw();
    });
    this.canvas.addEventListener('pointerup', () => {
      this.dragging = false;
      this.canvas.style.cursor = 'grab';
    });
  }

  /** 打开：看某队（squadId=null → 全览）；focus 给定则居中到该点 */
  open(squadId: number | null, focus?: { x: number; z: number }, span = 160): void {
    this.squadId = squadId;
    this.span = span;
    if (focus) { this.cx = focus.x; this.cz = focus.z; }
    else if (squadId !== null) {
      const path = this.swarm.tactics.board.getPath(squadId);
      const cmd = this.swarm.tactics.board.get(squadId);
      const t = cmd?.order?.target ?? (path?.pathGoalX !== undefined ? { x: path.pathGoalX, z: path.pathGoalZ! } : null);
      if (t) { this.cx = t.x; this.cz = t.z; }
      else {
        const s = this.swarm.squads.all().find((q) => q.id === squadId);
        const lead = s?.members.get(s?.leaderUid ?? 0);
        if (lead) { this.cx = lead.x; this.cz = lead.z; }
      }
    } else { this.cx = 0; this.cz = 0; this.span = 480; }
    this.visible = true;
    this.dirtyBase = true;
    this.root.style.display = 'block';
    this.draw();
  }

  close(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  toggleOverview(): void {
    if (this.visible && this.squadId === null) this.close();
    else this.open(null);
  }

  update(): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastDraw < 120) return;
    this.lastDraw = now;
    this.draw();
  }

  /** ★ 立即重绘（时间轴拖动等外部事件；绕过节流） */
  redrawNow(): void {
    if (!this.visible) return;
    this.dirtyBase = true;
    this.lastBase = 0;
    this.lastDraw = 0;
    this.draw();
  }

  private bake(): void {
    const N = 320;
    const img = this.baseCtx.createImageData(N, N);
    const d = img.data;
    const mpp = this.span / N;
    const x0 = this.cx - this.span / 2, z0 = this.cz - this.span / 2;
    for (let iz = 0; iz < N; iz++) {
      const wz = z0 + (iz + 0.5) * mpp;
      for (let ix = 0; ix < N; ix++) {
        const wx = x0 + (ix + 0.5) * mpp;
        const packed = this.raster.mapColorAt(wx, wz);
        const i = (iz * N + ix) * 4;
        d[i] = (packed >> 16) & 255;
        d[i + 1] = (packed >> 8) & 255;
        d[i + 2] = packed & 255;
        d[i + 3] = 255;
      }
    }
    this.baseCtx.putImageData(img, 0, 0);
  }

  private draw(): void {
    const now = performance.now();
    if (this.dirtyBase && now - this.lastBase > 250) { this.bake(); this.lastBase = now; this.dirtyBase = false; }
    const g = this.ctx;
    const S = this.size;
    g.clearRect(0, 0, S, S);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0, S, S);
    const p2 = (x: number, z: number): [number, number] => [
      ((x - (this.cx - this.span / 2)) / this.span) * S,
      ((z - (this.cz - this.span / 2)) / this.span) * S,
    ];
    // 网格（50m）
    g.strokeStyle = 'rgba(140,190,240,0.15)';
    const g0 = Math.ceil((this.cx - this.span / 2) / 50) * 50;
    for (let x = g0; x <= this.cx + this.span / 2; x += 50) { const [px] = p2(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, S); g.stroke(); }
    const gz0 = Math.ceil((this.cz - this.span / 2) / 50) * 50;
    for (let z = gz0; z <= this.cz + this.span / 2; z += 50) { const [, pz] = p2(0, z); g.beginPath(); g.moveTo(0, pz); g.lineTo(S, pz); g.stroke(); }

    const squads = this.squadId === null ? this.swarm.squads.all() : this.swarm.squads.all().filter((s) => s.id === this.squadId);
    // ★ 舰船位置（蓝圈）+ 工事扇区（8 区环带 + 认领队 + 需求值 + 各队 spot）
    if (this.shipAt) {
      const sp = this.shipAt();
      const [sx, sz] = p2(sp.x, sp.z);
      const sPx = S / this.span;
      const fort = this.swarm.commander.fortify;
      const band = this.swarm.commander.fortifyBand;   // ★ 单源（含 pushM/前推棘轮）
      const rLo = band.rLo;
      const rHi = band.rHi;
      // ★ 事态函数：环形活动区上下限（下限=允许离舰 / 上限=第一波收拢到舰）
      if (Number.isFinite(band.minD) && band.minD > 0) {
        g.setLineDash([5, 5]);
        g.strokeStyle = 'rgba(255,210,90,0.9)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(sx, sz, band.minD * sPx, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(255,210,90,0.95)';
        g.font = '10px Consolas,monospace';
        g.fillText(`下限 ${band.minD.toFixed(0)}m（frontP ${band.frontP.toFixed(2)}）`, sx - 60, sz - band.minD * sPx - 4);
      }
      if (Number.isFinite(band.maxD) && band.maxD > 0) {
        g.setLineDash([2, 6]);
        g.strokeStyle = 'rgba(90,220,255,0.9)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(sx, sz, band.maxD * sPx, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(90,220,255,0.95)';
        g.font = '10px Consolas,monospace';
        g.fillText(`上限 ${band.maxD.toFixed(0)}m`, sx - 30, sz - band.maxD * sPx - 4);
      }
      const ownerOf = new Map<number, number>();   // sector → squadId
      for (const [sid, sec] of fort.claims) ownerOf.set(sec, sid);
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        const owner = ownerOf.get(i);
        const hue = owner !== undefined ? (owner * 47) % 360 : 210;
        g.beginPath();
        g.arc(sx, sz, rHi * sPx, a0, a1);
        g.arc(sx, sz, rLo * sPx, a1, a0, true);
        g.closePath();
        g.fillStyle = owner !== undefined ? `hsla(${hue} 90% 60% 0.18)` : 'rgba(120,160,200,0.10)';
        g.fill();
        g.strokeStyle = 'rgba(150,190,230,0.4)';
        g.lineWidth = 1;
        g.stroke();
        const mid = (a0 + a1) / 2;
        const rm = (rLo + rHi) / 2;
        const lx = sx + Math.cos(mid) * rm * sPx;
        const ly = sz + Math.sin(mid) * rm * sPx;
        g.fillStyle = owner !== undefined ? `hsl(${hue} 90% 70%)` : '#a9c2d8';
        g.font = '10px Consolas,monospace';
        g.fillText(`区${i}${owner !== undefined ? `·第${owner}队` : ''}`, lx - 14, ly);
        const need = fort.safety[i];
        g.fillStyle = 'rgba(220,232,245,0.8)';
        g.fillText(Number.isFinite(need) ? `需求${need.toFixed(1)}` : '需求-', lx - 14, ly + 11);
      }
      // 各队施工点（spot）
      for (const [sid, p] of fort.spots) {
        const [px2, pz2] = p2(p.x, p.z);
        g.fillStyle = `hsl(${(sid * 47) % 360} 90% 60%)`;
        g.beginPath(); g.arc(px2, pz2, 3.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#dce8f5';
        g.font = '10px Consolas,monospace';
        g.fillText(`第${sid}队`, px2 + 5, pz2 + 3);
      }
      // 舰船本体（蓝圈 + 名）
      g.strokeStyle = '#3399ff';
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(sx, sz, 9, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(80,170,255,0.9)';
      g.font = '10px Consolas,monospace';
      g.fillText('舰船', sx + 11, sz + 3);
      g.fillStyle = 'rgba(220,232,245,0.85)';
      g.fillText(`施工带 ${rLo.toFixed(0)}~${rHi.toFixed(0)}m（前推+${band.pushM.toFixed(0)}m）`, sx + 8, sz + rHi * sPx + 12);
    }
    for (const s of squads) {
      const path = this.swarm.tactics.board.get(s.id);   // ★ 走廊/起终点在命令状态（寻路轨覆盖式）
      const cmd = path;
      const focused = this.squadId === s.id;
      const col = `hsl(${(s.id * 47) % 360} 90% 60%)`;
      const corr = path?.corridor;
      if (corr && corr.length > 1) {
        g.strokeStyle = col;
        g.lineWidth = focused ? 3 : 1.5;
        g.beginPath();
        const [x0, z0] = p2(corr[0]!.x, corr[0]!.z);
        g.moveTo(x0, z0);
        for (const q of corr) { const [qx, qz] = p2(q.x, q.z); g.lineTo(qx, qz); }
        g.stroke();
      }
      if (path?.pathFromX !== undefined && path?.pathFromZ !== undefined) {
        const [px, pz] = p2(path.pathFromX, path.pathFromZ);
        g.fillStyle = '#39d353';
        g.beginPath(); g.arc(px, pz, focused ? 5 : 3, 0, Math.PI * 2); g.fill();
      }
      if (path?.pathGoalX !== undefined && path?.pathGoalZ !== undefined) {
        const [gx, gz] = p2(path.pathGoalX, path.pathGoalZ);
        g.strokeStyle = '#ffd24a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(gx - 7, gz - 7); g.lineTo(gx + 7, gz + 7); g.moveTo(gx + 7, gz - 7); g.lineTo(gx - 7, gz + 7); g.stroke();
      }
      const t = cmd?.order?.target;
      if (t) {
        const [tx, tz] = p2(t.x, t.z);
        g.strokeStyle = '#ff5b4a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(tx - 7, tz); g.lineTo(tx + 7, tz); g.moveTo(tx, tz - 7); g.lineTo(tx, tz + 7); g.stroke();
      }
      const lead = s.members.get(s.leaderUid);
      if (lead) {
        const [lx, lz] = p2(lead.x, lead.z);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(lx, lz, focused ? 4 : 2.5, 0, Math.PI * 2); g.fill();
      }
      // 令历史（灰点连线 + 年龄）
      if (focused) {
        const ring = (this.swarm.cmdLog as unknown as { ring?: CommandLogEntry[] }).ring ?? [];
        const hist: CommandLogEntry[] = [];
        for (let i = ring.length - 1; i >= 0 && hist.length < 12; i--) if (ring[i]!.squadId === s.id) hist.push(ring[i]!);
        hist.reverse();
        g.strokeStyle = 'rgba(200,210,220,0.5)';
        g.setLineDash([4, 4]);
        g.beginPath();
        hist.forEach((h, i) => {
          const [hx, hz] = p2(h.tx, h.tz);
          if (i === 0) g.moveTo(hx, hz); else g.lineTo(hx, hz);
        });
        g.stroke();
        g.setLineDash([]);
        for (const h of hist) {
          const [hx, hz] = p2(h.tx, h.tz);
          g.fillStyle = h.source === 'leader' ? '#ffa733' : '#ff5544';
          g.beginPath(); g.arc(hx, hz, 3, 0, Math.PI * 2); g.fill();
          const age = Math.max(0, Math.round(now / 1000 - h.t));
          g.fillStyle = 'rgba(230,238,245,0.9)';
          g.font = '10px Consolas,monospace';
          g.fillText(`${orderCn(h.kind)} ${age}秒前`, hx + 5, hz - 5);
        }
      }
    }
    this.titleEl.textContent = this.squadId === null
      ? `全览（${squads.length} 队）· 视野 ${Math.round(this.span)}m`
      : `第${this.squadId}队 · 视野 ${Math.round(this.span)}m · 中心 (${this.cx | 0}, ${this.cz | 0})`;
  }

  dispose(): void { this.root.remove(); }
}
