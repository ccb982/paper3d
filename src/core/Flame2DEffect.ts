import * as THREE from 'three';

export class Flame2DEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = window.innerWidth;
  private height: number = window.innerHeight;
  private camera: THREE.Camera | null = null;
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.016; // 60fps

  // 粒子数据结构，包含位置和颜色
  private particleData: { position: THREE.Vector3; color: THREE.Color }[] = [];

  // 轮廓缓存
  private cachedContour: { x: number; y: number }[] = [];
  private lastContourUpdate: number = 0;
  private contourUpdateDelay: number = 0.2;   // 每0.2秒重新采样一次轮廓

  // 极坐标参数
  private radialSegments: number = 90;         // 圆周分段数（越高轮廓越平滑）
  private percentile: number = 0.85;          // 百分位数，取半径较大的外围点（0.85 避开最外离散点）

  // 调试选项
  public showParticles: boolean = true;

  // 轮廓样式
  private contourColor: string = '#ff8800';
  private contourWidth: number = 3;

  constructor() {
    // 创建 canvas 元素
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
    
    // 监听窗口大小变化
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
    const currentTime = performance.now() * 0.001;
    if (currentTime - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = currentTime;

    if (!this.camera) {
      console.log('Flame2DEffect: Camera not set');
      return;
    }
    
    console.log('Flame2DEffect: Updating with', particles.length, 'particles');
    this.particleData = particles;
    this.render();
  }

  private render(): void {
    if (!this.camera) return;
    
    // 清空画布
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
        const size = Math.max(1, 4 / (pt.depth * 0.5 + 0.5));
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

  private projectToScreen(particle: THREE.Vector3): THREE.Vector2 | null {
    if (!this.camera) return null;
    
    // 创建临时向量
    const vector = new THREE.Vector3();
    
    // 克隆粒子位置
    vector.copy(particle);
    
    // 应用相机投影
    vector.project(this.camera);
    
    // 检查是否在视锥体范围内
    if (vector.x < -1 || vector.x > 1 || vector.y < -1 || vector.y > 1 || vector.z < 0 || vector.z > 1) {
      return null;
    }
    
    // 转换为屏幕坐标
    const screenX = (vector.x + 1) / 2 * this.width;
    const screenY = (1 - vector.y) / 2 * this.height;
    
    return new THREE.Vector2(screenX, screenY);
  }

  private getParticleDepth(particle: THREE.Vector3): number {
    if (!this.camera) return 1;
    
    const cameraPosition = this.camera.position;
    return particle.distanceTo(cameraPosition);
  }

  private calculateParticleSize(depth: number): number {
    // 简化的粒子大小计算
    // 基于深度计算粒子大小，距离越远越小
    const baseSize = 15;
    const minSize = 3;
    
    // 计算大小：距离越远越小
    let size = baseSize / (depth * 0.8);
    
    // 限制大小范围
    size = Math.max(minSize, size);
    
    return size;
  }

  private colorToRGB(color: THREE.Color): string {
    // 将 THREE.Color 对象转换为 RGB 字符串
    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * 极坐标外围点提取（根据颜色过滤）
   * 1. 过滤粒子：只保留红色和红白色，排除橙色
   * 2. 计算粒子群的中心点
   * 3. 按角度分组，每组取半径的百分位数点
   * 4. 返回按角度排序的点列表（屏幕坐标）
   */
  private computePolarContour(points: { x: number; y: number; depth: number; color: THREE.Color }[]): { x: number; y: number }[] {
    if (points.length < 10) return [];

    // 1. 根据颜色过滤：只保留红色和红白色，排除橙色
    const filtered = points.filter(p => {
      const r = p.color.r;
      const g = p.color.g;
      const b = p.color.b;
      // 红白色（焰底）：r>0.9, g>0.7, b>0.7
      const isRedWhite = r > 0.9 && g > 0.7 && b > 0.7;
      // 红色（外缘）：r>0.7, g<0.3, b<0.2
      const isRed = r > 0.7 && g < 0.3 && b < 0.2;
      // 排除橙色（中部）：r>0.8, g>0.4, b<0.3，且不是红白/红色
      const isOrange = r > 0.8 && g > 0.4 && g < 0.8 && b < 0.3;
      return (isRedWhite || isRed) && !isOrange;
    });

    if (filtered.length < 10) return [];

    // 2. 计算中心（所有过滤后点的平均）
    let centerX = 0, centerY = 0;
    for (const p of filtered) {
      centerX += p.x;
      centerY += p.y;
    }
    centerX /= filtered.length;
    centerY /= filtered.length;

    // 3. 径向分组：每个角度区间收集半径
    const radialGroups: number[][] = new Array(this.radialSegments).fill(null).map(() => []);
    for (const p of filtered) {
      let angle = Math.atan2(p.y - centerY, p.x - centerX);
      let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * this.radialSegments);
      seg = Math.min(this.radialSegments - 1, Math.max(0, seg));
      const radius = Math.hypot(p.x - centerX, p.y - centerY);
      radialGroups[seg].push(radius);
    }

    // 4. 每个区间取指定百分位的半径，构建轮廓点
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

    // 5. 按角度排序（确保闭合顺序正确）
    contour.sort((a, b) => {
      const angleA = Math.atan2(a.y - centerY, a.x - centerX);
      const angleB = Math.atan2(b.y - centerY, b.x - centerX);
      return angleA - angleB;
    });

    // 6. 平滑曲线
    const smooth = this.smoothPolygon(contour, 40);
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

  private drawParticle(position: THREE.Vector2, size: number, color: string): void {
    this.ctx.save();
    
    // 解析 RGB 颜色
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!rgbMatch) return;
    
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    
    // 创建径向渐变，使粒子中心亮边缘暗
    const gradient = this.ctx.createRadialGradient(
      position.x, position.y, 0,
      position.x, position.y, size
    );
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.5)`); // 50% 透明度
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`); // 完全透明
    
    this.ctx.fillStyle = gradient;
    
    // 绘制圆形粒子
    this.ctx.beginPath();
    this.ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
    this.ctx.fill();
    
    this.ctx.restore();
  }

  public dispose(): void {
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}