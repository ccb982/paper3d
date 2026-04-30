import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class VerticalTriangleTexture {
  type: 'canvas' | 'shader' = 'canvas';
  
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private animationId: number;
  private time: number = 0;
  
  private readonly triangleSize: number = 8;
  private readonly dropInterval: number = 0.15;
  private lastDropTime: number = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    
    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: this.canvas.width,
      height: this.canvas.height,
      curl: 0,
      velocityDissipation: 0.999999,
      dyeDissipation: 0.999999,
      pressureIterations: 20
    });
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    
    this.animate();
  }

  private animate(): void {
    this.update();
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  public generate(): THREE.Texture {
    return this.texture;
  }

  public update(delta?: number): void {
    this.time += delta || 0.016;
    
    this.injectDrops();
    this.injectTriangleBlocker();
    
    this.texture.needsUpdate = true;
  }

  private injectDrops(): void {
    const cx = this.canvas.width / 2;
    const topY = 50;
    const dropSize = 16;
    
    if (this.time - this.lastDropTime > this.dropInterval) {
      this.fluidDynamics.setDye(cx, topY, 0, dropSize, dropSize * 0.6, [0.2, 0.6, 0.9]);
      this.fluidDynamics.setVelocity(cx, topY, 0, dropSize * 0.8, dropSize * 0.4, 0, 500);
      this.lastDropTime = this.time;
    }
    
    for (let y = topY; y < this.canvas.height - 50; y += 15) {
      const gravity = 80 + (y - topY) * 0.3;
      this.fluidDynamics.setVelocity(cx, y, 0, 15, 8, 0, gravity);
    }
  }

  private injectTriangleBlocker(): void {
    const cx = this.canvas.width / 2;
    const baseY = this.canvas.height * 0.35;
    const size = this.triangleSize;
    
    const tipY = baseY - size * 10;
    const actualTipY = Math.max(tipY, 80);
    
    for (let y = actualTipY; y <= baseY; y += 3) {
      const t = (y - actualTipY) / (baseY - actualTipY);
      const halfWidth = size * 0.35 * (1 + t);
      this.fluidDynamics.setVelocity(cx, y, 0, halfWidth * 2 + 2, 4, 0, 0);
    }
    
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(cx, actualTipY);
      ctx.lineTo(cx - size * 0.3, baseY);
      ctx.lineTo(cx + size * 0.3, baseY);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
    }
  }

  public dispose(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    cancelAnimationFrame(this.animationId);
    this.texture.dispose();
  }
}