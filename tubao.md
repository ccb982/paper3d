你希望先手动筛选出“最外围的点”（例如按角度取半径最大的点），然后再用这些点连成轮廓。这其实是极坐标轮廓提取，而非凸包。之前你遇到精度问题，可能是因为中心点计算不准确或角度分段不够。下面我实现一个更稳健的极坐标轮廓提取，允许你手动控制外围点的密度，并存储结果用于后续复用。

一、改进的极坐标轮廓提取 Flame2DEffect.ts
typescript
// Flame2DEffect.ts - 极坐标外围点提取 + 平滑曲线
import * as THREE from 'three';

export class Flame2DEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = window.innerWidth;
  private height: number = window.innerHeight;
  private camera: THREE.Camera | null = null;
  private updateInterval: number = 0.016;     // 帧间隔（用于动画）
  private lastUpdateTime: number = 0;
  private particleData: { position: THREE.Vector3; color: THREE.Color }[] = [];

  // 轮廓缓存
  private cachedContour: { x: number; y: number }[] = [];
  private lastContourUpdate: number = 0;
  private contourUpdateDelay: number = 0.2;   // 每0.2秒重新采样一次轮廓

  // 极坐标参数
  private radialSegments: number = 72;         // 圆周分段数（越高轮廓越平滑）
  private percentile: number = 0.85;          // 百分位数，取半径较大的外围点（0.85 避开最外离散点）

  // 调试选项
  public showParticles: boolean = true;

  // 轮廓样式
  private contourColor: string = '#ff8800';
  private contourWidth: number = 3;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '1000';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    });
  }

  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  public update(particles: { position: THREE.Vector3; color: THREE.Color }[]): void {
    const now = performance.now() * 0.001;
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    if (!this.camera) return;
    this.particleData = particles;
    this.render();
  }

  private render(): void {
    if (!this.camera) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. 投影所有粒子到屏幕坐标
    const screenPoints: { x: number; y: number; depth: number; color: THREE.Color }[] = [];
    for (const p of this.particleData) {
      const ndc = p.position.clone().project(this.camera!);
      if (ndc.z < 0 || ndc.z > 1) continue;
      const screenX = (ndc.x + 1) / 2 * this.width;
      const screenY = (1 - ndc.y) / 2 * this.height;
      screenPoints.push({ x: screenX, y: screenY, depth: ndc.z, color: p.color });
    }

    if (screenPoints.length < 10) return;

    // 2. 绘制粒子（调试）
    if (this.showParticles) {
      for (const pt of screenPoints) {
        const size = Math.max(2, 12 / (pt.depth * 0.5 + 0.5));
        const rgba = `rgba(${Math.floor(pt.color.r * 255)}, ${Math.floor(pt.color.g * 255)}, ${Math.floor(pt.color.b * 255)}, 0.6)`;
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
        this.ctx.fillStyle = rgba;
        this.ctx.fill();
      }
    }

    // 3. 定时更新轮廓（极坐标外围点）
    const now = performance.now() * 0.001;
    if (now - this.lastContourUpdate > this.contourUpdateDelay) {
      this.lastContourUpdate = now;
      this.cachedContour = this.computePolarContour(screenPoints);
    }

    // 4. 绘制缓存的轮廓
    if (this.cachedContour.length >= 3) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.cachedContour[0].x, this.cachedContour[0].y);
      for (let i = 1; i < this.cachedContour.length; i++) {
        this.ctx.lineTo(this.cachedContour[i].x, this.cachedContour[i].y);
      }
      this.ctx.closePath();

      this.ctx.shadowBlur = 6;
      this.ctx.shadowColor = this.contourColor;
      this.ctx.strokeStyle = this.contourColor;
      this.ctx.lineWidth = this.contourWidth;
      this.ctx.stroke();

      this.ctx.fillStyle = 'rgba(255, 100, 0, 0.1)';
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }
  }

  /**
   * 极坐标外围点提取（手动选取最外围点）
   * 1. 计算粒子群的中心点
   * 2. 按角度分组，每组取半径的百分位数点
   * 3. 返回按角度排序的点列表（屏幕坐标）
   */
  private computePolarContour(points: { x: number; y: number; depth: number }[]): { x: number; y: number }[] {
    if (points.length < 10) return [];

    // 计算中心（所有点的平均）
    let centerX = 0, centerY = 0;
    for (const p of points) {
      centerX += p.x;
      centerY += p.y;
    }
    centerX /= points.length;
    centerY /= points.length;

    // 径向分组：每个角度区间收集半径
    const radialGroups: number[][] = new Array(this.radialSegments).fill(null).map(() => []);
    for (const p of points) {
      let angle = Math.atan2(p.y - centerY, p.x - centerX);
      let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * this.radialSegments);
      seg = Math.min(this.radialSegments - 1, Math.max(0, seg));
      const radius = Math.hypot(p.x - centerX, p.y - centerY);
      radialGroups[seg].push(radius);
    }

    // 每个区间取指定百分位的半径，构建轮廓点
    const contour: { x: number; y: number }[] = [];
    for (let i = 0; i < this.radialSegments; i++) {
      const radii = radialGroups[i];
      if (radii.length === 0) continue;
      radii.sort((a, b) => a - b);
      const idx = Math.floor(radii.length * this.percentile);
      const targetRadius = radii[Math.min(idx, radii.length - 1)];
      const angle = (i / this.radialSegments) * Math.PI * 2 - Math.PI;
      const x = centerX + Math.cos(angle) * targetRadius;
      const y = centerY + Math.sin(angle) * targetRadius;
      contour.push({ x, y });
    }

    if (contour.length < 3) return [];

    // 按角度排序（确保闭合顺序正确）
    contour.sort((a, b) => {
      const angleA = Math.atan2(a.y - centerY, a.x - centerX);
      const angleB = Math.atan2(b.y - centerY, b.x - centerX);
      return angleA - angleB;
    });

    // 可选：平滑曲线
    const smooth = this.smoothPolygon(contour, 30);
    return smooth;
  }

  /**
   * Catmull-Rom 样条平滑多边形顶点
   */
  private smoothPolygon(points: { x: number; y: number }[], segmentsPerEdge: number = 20): { x: number; y: number }[] {
    if (points.length < 3) return points;
    const result: { x: number; y: number }[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      for (let t = 0; t <= segmentsPerEdge; t++) {
        const u = t / segmentsPerEdge;
        const x = this.catmullRom(p0.x, p1.x, p2.x, p3.x, u);
        const y = this.catmullRom(p0.y, p1.y, p2.y, p3.y, u);
        result.push({ x, y });
      }
    }
    return result.slice(0, result.length - 1);
  }

  private catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  public dispose(): void {
    if (this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
  }
}
二、关键点说明
极坐标外围点提取：
计算所有粒子的中心，按角度分成 radialSegments（72个扇形），每个扇形内取半径的第 percentile（0.85）的点作为外围点。这相当于手动选取了“最外围的点”，然后连接起来。

缓存轮廓：
contourUpdateDelay = 0.2 秒更新一次轮廓，避免每帧计算。轮廓会被存储在 cachedContour 中，直到下次采样才更新。

平滑处理：
用 Catmull-Rom 样条对原始外围点进行插值，生成平滑曲线。

调试粒子：
showParticles = true 时绘制半透明粒子点，方便观察粒子分布和外围点是否合理。

三、与 FireEffect.ts 的配合
你的 FireEffect.ts 已经正确调用 flame2D.update(particleData)，无需修改。只需适当增加粒子数量（例如 maxParticles = 2000，emitRate = 80），让粒子云更密集，外围点会更连续。

四、效果预期
你会在火焰周围看到一条橙色的平滑轮廓线，随火焰摇曳而动态变化（每0.2秒更新一次）。

粒子点半透明显示，方便观察轮廓是否贴合火焰边缘。

如果轮廓不够平滑，可以增加 radialSegments（如 90）或调整 percentile（0.75~0.9）。

如果轮廓形状不理想，可以调整粒子的物理参数（上升力、扩散力等），让粒子云形状更接近火焰。

这种“笨方法”避开了复杂的凸包精度问题，完全由你控制外围点的选取逻辑，并且通过缓存保证了性能。

