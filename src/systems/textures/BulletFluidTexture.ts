import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class BulletFluidTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';

  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private lastTimestamp: number = 0;
  private time: number = 0;

  private readonly BULLET_X: number;
  private readonly BULLET_Y: number;
  
  private readonly a: number = 30;
  private readonly b: number = 18;
  
  private readonly nozzleDist: number = 15;
  private readonly jetSpeed: number = 200;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);

    this.BULLET_X = this.canvas.width - 80;
    this.BULLET_Y = this.canvas.height / 2;

    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: 768,
      height: 512,
      simScale: 1.0,
      dyeScale: 1.0,
      curl: 2,                // 降低涡旋，防止卷吸
      velocityDissipation: 0.12,
      dyeDissipation: 0.15,
      pressureIterations: 20
    });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.lastTimestamp = performance.now();
    this.animate();
  }

  generate(): THREE.Texture {
    return this.texture;
  }

  private injectFluid(deltaTime: number): void {
    const { BULLET_X, BULLET_Y, a, b, nozzleDist, jetSpeed } = this;

    this.time += deltaTime * 2;

    // 1. 弹头高压区（不变）
    this.fluidDynamics.setVelocity(BULLET_X, BULLET_Y, 0, a, b, 0, 0);
    this.fluidDynamics.setDye(BULLET_X, BULLET_Y, 0, a * 0.85, b * 0.75, [1.0, 0.95, 0.85]);

    // 2. 单一强力喷射口（仅正后方）
    const nozzleX = BULLET_X - nozzleDist;
    const pulse = 0.8 + Math.sin(this.time * 3) * 0.2;
    
    // 核心喷射点 - 严格向后喷射
    this.fluidDynamics.setVelocity(nozzleX, BULLET_Y, 0, 10, 8, -jetSpeed * pulse, 0);
    this.fluidDynamics.setDye(nozzleX, BULLET_Y, 0, 12, 10, [0.15, 0.65, 1.0]);

    // 3. 后方连续尾迹（仅注入染料，不施加速度，让流场自然带动）
    const trailLength = 160;
    for (let dist = 25; dist <= trailLength; dist += 12) {
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      const intensity = 1 - dist / trailLength;
      const width = 6 + dist * 0.08;
      
      this.fluidDynamics.setDye(backX, BULLET_Y, 0, width * 0.8, width * 0.5, 
        [0.12, 0.5 + intensity * 0.25, 0.92]);
    }

    // 4. 侧视卡门涡街（仅染料位置上下偏移 + 微小的垂直速度）
    const waveAmp = 4;   // 振幅很小，不破坏主流向
    const waveFreq = 2.0;
    
    for (let dist = 40; dist <= 130; dist += 20) {
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      const phase = this.time * waveFreq + dist * 0.12;
      const offsetY = Math.sin(phase) * waveAmp;
      
      // 上侧波动（青色）
      const yUp = BULLET_Y - 12 + offsetY;
      this.fluidDynamics.setDye(backX, yUp, 0, 7, 5, [0.2, 0.85, 0.92]);
      this.fluidDynamics.setVelocity(backX, yUp, 0, 4, 4, -35, Math.sin(phase) * 10);
      
      // 下侧反向波动（粉色）
      const yDown = BULLET_Y + 12 - offsetY;
      this.fluidDynamics.setDye(backX, yDown, 0, 7, 5, [1.0, 0.28, 0.68]);
      this.fluidDynamics.setVelocity(backX, yDown, 0, 4, 4, -35, -Math.sin(phase) * 10);
    }

    // 5. 极少量湍流（仅2个点，向后方向为主）
    for (let i = 0; i < 2; i++) {
      const dist = 50 + Math.random() * 80;
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      const backY = BULLET_Y + (Math.random() - 0.5) * 20;
      this.fluidDynamics.setVelocity(backX, backY, 0, 5, 5,
        -40 - Math.random() * 20, (Math.random() - 0.5) * 8);
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min(0.033, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;

    this.injectFluid(delta);
    this.texture.needsUpdate = true;
  };

  update(delta?: number): void {
  }

  dispose(): void {
    this.texture.dispose();
    if (this.fluidDynamics) {
      this.fluidDynamics.dispose?.();
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}