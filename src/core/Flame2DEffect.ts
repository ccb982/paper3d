import * as THREE from 'three';

export class Flame2DEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = window.innerWidth;
  private height: number = window.innerHeight;
  private particles: THREE.Vector3[] = [];
  private camera: THREE.Camera | null = null;
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.016; // 60fps

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

  // 粒子数据结构，包含位置和颜色
  private particleData: { position: THREE.Vector3; color: THREE.Color }[] = [];

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
    
    // 渲染 2D 粒子
    this.particleData.forEach((particle, index) => {
      // 将 3D 粒子转换为屏幕坐标
      const screenPos = this.projectToScreen(particle.position);
      if (!screenPos) return;
      
      // 计算粒子大小（基于深度）
      const depth = this.getParticleDepth(particle.position);
      const size = this.calculateParticleSize(depth);
      
      // 使用粒子的实际颜色
      const color = this.colorToRGB(particle.color);
      
      // 绘制粒子
      this.drawParticle(screenPos, size, color);
    });
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
    // 基于深度计算粒子大小，距离越远越小
    const baseSize = 10;
    const maxSize = 20;
    const minSize = 2;
    
    // 深度范围（可根据实际场景调整）
    const maxDepth = 10;
    const minDepth = 1;
    
    // 计算大小因子
    let size = baseSize / (depth / minDepth);
    
    // 限制大小范围
    size = Math.max(minSize, Math.min(maxSize, size));
    
    return size;
  }

  private colorToRGB(color: THREE.Color): string {
    // 将 THREE.Color 对象转换为 RGB 字符串
    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private calculateParticleColor(particle: THREE.Vector3, depth: number): string {
    // 基于粒子高度和深度计算颜色
    const height = particle.y;
    const heightRatio = Math.max(0, Math.min(1, height / 5)); // 假设火焰高度为 5
    
    // 颜色渐变：底部橙红，顶部黄白
    let r, g, b;
    
    if (heightRatio < 0.3) {
      // 底部：橙红
      r = 255;
      g = Math.floor(100 + heightRatio * 155 / 0.3);
      b = 0;
    } else if (heightRatio < 0.7) {
      // 中部：橙黄
      r = 255;
      g = Math.floor(255 - (heightRatio - 0.3) * 100 / 0.4);
      b = Math.floor((heightRatio - 0.3) * 100 / 0.4);
    } else {
      // 顶部：黄白
      r = 255;
      g = Math.floor(155 + (heightRatio - 0.7) * 100 / 0.3);
      b = Math.floor(100 + (heightRatio - 0.7) * 155 / 0.3);
    }
    
    // 基于深度调整亮度，距离越远越暗
    const depthRatio = Math.max(0, Math.min(1, 1 - (depth - 1) / 9)); // 深度 1-10
    r = Math.floor(r * depthRatio);
    g = Math.floor(g * depthRatio);
    b = Math.floor(b * depthRatio);
    
    return `rgb(${r}, ${g}, ${b})`;
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