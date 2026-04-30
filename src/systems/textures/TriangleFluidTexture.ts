import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class TriangleFluidTexture {
  type: 'canvas' | 'shader' = 'canvas';

  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private lastTimestamp: number = 0;
  private time: number = 0;

  private readonly triangleSize: number = 40;
  private readonly jetSpeed: number = 180;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);

    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: 768,
      height: 512,
      simScale: 1.0,
      dyeScale: 1.0,
      curl: 0,
      velocityDissipation: 0.9,
      dyeDissipation: 0.9,
      pressureIterations: 20
    });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.lastTimestamp = performance.now();
    this.animate();
  }

  generate(): THREE.Texture {
    return this.texture;
  }

  private animate = (): void => {
    const now = performance.now();
    const deltaTime = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    this.update(deltaTime);

    requestAnimationFrame(this.animate);
  };

  public update(delta: number): void {
    this.time += delta * 2;

    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (ctx) {
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.injectTriangleDye();

    this.texture.needsUpdate = true;
  }

  private injectTriangleDye(): void {
    const cx = this.canvas.width * 0.55;
    const cy = this.canvas.height / 2;
    const size = this.triangleSize;

    const pulse = 0.8 + Math.sin(this.time * 3) * 0.2;
    const puffPhase = Math.floor(this.time * 4) % 4;

    const frontX = cx + size * 0.5;
    const frontY = cy;

    const injectionRadius = size * 0.35;

    const constantX = frontX + 15;
    this.fluidDynamics.setDye(constantX, frontY, 0, injectionRadius * 1.2, injectionRadius * 0.9, [0.2, 0.5, 0.9]);
    this.fluidDynamics.setVelocity(constantX, frontY, 0, injectionRadius * 0.6, injectionRadius * 0.4, -this.jetSpeed * 0.3, 0);

    if (puffPhase === 0) {
      this.fluidDynamics.setDye(frontX, frontY, 0, injectionRadius * 1.5, injectionRadius * 1.2, [0.2, 0.5, 0.9]);
      this.fluidDynamics.setVelocity(frontX, frontY, 0, injectionRadius * 1.2, injectionRadius * 0.9, -this.jetSpeed * pulse, 0);

      const trailLength = 280;
      for (let dist = 20; dist <= trailLength; dist += 25) {
        const backX = cx - dist;
        if (backX < 0) continue;

        const intensity = 1 - dist / trailLength;
        const width = 15 + dist * 0.15;

        this.fluidDynamics.setDye(backX, frontY, 0, width * 0.9, width * 0.6, [0.15 * intensity, 0.4 * intensity, 0.8 * intensity]);
        this.fluidDynamics.setVelocity(backX, frontY, 0, width * 0.7, width * 0.5, -this.jetSpeed * 0.5 * intensity, 0);
      }
    }

    for (let x = cx - size; x >= 0; x -= 18) {
      this.fluidDynamics.setVelocity(x, cy, 0, 12, 25, -60, 0);
    }

    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.save();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.moveTo(cx - size, cy - size * 0.2);
      ctx.lineTo(cx - size, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.8, cy);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  public dispose(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.texture.dispose();
  }
}