// ============================================================
// NavDebugMap —— 寻路可视化小地图（RTS 侧调试 UI，外接）
//   底图：raster.mapColorAt（地形语义色，2s 重烘）
//   覆盖：每队寻路走廊（折线）/ 起点(pathFrom) / 终点(pathGoal) / 队令目标 / 队长位置
//   数据：swarm.tactics.board.get/getPath（只读）
// ============================================================
import { RasterMap } from '../services/map/RasterMap';
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';

export class NavDebugMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private lastBake = 0;
  private lastDraw = 0;
  visible = true;

  constructor(
    private readonly raster: RasterMap,
    private readonly swarm: SwarmSystem,
    private readonly size = 240,
    private readonly half = 240,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.cssText = `position:fixed;left:8px;bottom:8px;width:${size}px;height:${size}px;image-rendering:pixelated;z-index:940;border:1px solid rgba(110,170,235,0.4);border-radius:6px;background:rgba(6,10,16,0.9);`;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = 160;
    this.base.height = 160;
    this.baseCtx = this.base.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  update(): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastBake > 2000) { this.bake(); this.lastBake = now; }
    if (now - this.lastDraw < 100) return;
    this.lastDraw = now;
    this.draw();
  }

  /** 地形语义底图（mapColorAt 全彩；±half 米 → 160px） */
  private bake(): void {
    const N = 160;
    const img = this.baseCtx.createImageData(N, N);
    const d = img.data;
    const step = (this.half * 2) / N;
    for (let iz = 0; iz < N; iz++) {
      const wz = -this.half + (iz + 0.5) * step;
      for (let ix = 0; ix < N; ix++) {
        const wx = -this.half + (ix + 0.5) * step;
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
    const g = this.ctx;
    const S = this.size;
    g.clearRect(0, 0, S, S);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0, S, S);
    const p2 = (x: number, z: number): [number, number] => [((x + this.half) / (2 * this.half)) * S, ((z + this.half) / (2 * this.half)) * S];

    for (const s of this.swarm.squads.all()) {
      const path = this.swarm.tactics.board.getPath(s.id);
      const cmd = this.swarm.tactics.board.get(s.id);
      const col = `hsl(${(s.id * 47) % 360} 90% 60%)`;
      // 走廊折线
      const corr = path?.corridor;
      if (corr && corr.length > 1) {
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.beginPath();
        const [x0, z0] = p2(corr[0]!.x, corr[0]!.z);
        g.moveTo(x0, z0);
        for (const q of corr) { const [qx, qz] = p2(q.x, q.z); g.lineTo(qx, qz); }
        g.stroke();
      }
      // 起点（绿点）
      if (path?.pathFromX !== undefined && path?.pathFromZ !== undefined) {
        const [px, pz] = p2(path.pathFromX, path.pathFromZ);
        g.fillStyle = '#39d353';
        g.beginPath(); g.arc(px, pz, 2.4, 0, Math.PI * 2); g.fill();
      }
      // 终点（黄叉）
      if (path?.pathGoalX !== undefined && path?.pathGoalZ !== undefined) {
        const [gx, gz] = p2(path.pathGoalX, path.pathGoalZ);
        g.strokeStyle = '#ffd24a';
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(gx - 4, gz - 4); g.lineTo(gx + 4, gz + 4); g.moveTo(gx + 4, gz - 4); g.lineTo(gx - 4, gz + 4); g.stroke();
      }
      // 队令目标（红叉）
      const t = cmd?.order?.target;
      if (t) {
        const [tx, tz] = p2(t.x, t.z);
        g.strokeStyle = '#ff5b4a';
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(tx - 4, tz); g.lineTo(tx + 4, tz); g.moveTo(tx, tz - 4); g.lineTo(tx, tz + 4); g.stroke();
      }
      // 队长位置（白点）
      const lead = s.members.get(s.leaderUid);
      if (lead) {
        const [lx, lz] = p2(lead.x, lead.z);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(lx, lz, 2, 0, Math.PI * 2); g.fill();
      }
    }
    // 图例
    g.fillStyle = 'rgba(220,232,245,0.85)';
    g.font = '10px Consolas,monospace';
    g.fillText('线=走廊 绿=起点 黄=终点 红=队令 白=队长', 6, 12);
  }

  dispose(): void { this.canvas.remove(); }
}
