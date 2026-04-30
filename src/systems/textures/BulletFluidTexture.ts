import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class BulletFluidTexture {
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
  private readonly jetSpeed: number = 280;

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
      curl: 2,
      velocityDissipation: 0.55,   // 大幅延长尾气寿命
      dyeDissipation: 0.55,
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

    // 2. 上下两个喷射口（极小释放量，保持分开）
    const nozzleX = BULLET_X - nozzleDist;
    const pulse = 0.8 + Math.sin(this.time * 3) * 0.2;
    const nozzleOffset = 15;  // 增大间距适配30px挡边
    
    // 在喷射口之间添加实体阻挡线，并延伸到画布底部（厚度50px）
    const barrierStartX = nozzleX;
    const barrierLength = this.canvas.width;
    
    // 从喷射口位置向左延伸一条长隔板
    for (let x = barrierStartX; x >= 0; x -= 8) {
      this.fluidDynamics.setVelocity(x, BULLET_Y, 0, 10, 50, 0, 0);
    }
    
    // 在喷射口正后方添加强侧向推力（直接作用于喷出的流体）
    const pushOffset = 6;  // 推力位置靠近喷射口
    this.fluidDynamics.setVelocity(nozzleX - 3, BULLET_Y - pushOffset, 0, 5, 4, -30, -40);  // 上侧向左上推
    this.fluidDynamics.setVelocity(nozzleX - 3, BULLET_Y + pushOffset, 0, 5, 4, -30, 40);   // 下侧向左下推
    
    // 上侧喷射口（染料3×3）
    const nozzleYUp = BULLET_Y - nozzleOffset - 2;
    this.fluidDynamics.setVelocity(nozzleX, nozzleYUp, 0, 3, 2, -jetSpeed * pulse * 0.8, -15);
    this.fluidDynamics.setDye(nozzleX, nozzleYUp, 0, 3, 3, [0.05, 0.25, 0.45]);
    
    // 下侧喷射口（染料3×3）
    const nozzleYDown = BULLET_Y + nozzleOffset + 2;
    this.fluidDynamics.setVelocity(nozzleX, nozzleYDown, 0, 3, 2, -jetSpeed * pulse * 0.8, 15);
    this.fluidDynamics.setDye(nozzleX, nozzleYDown, 0, 3, 3, [0.05, 0.25, 0.45]);

    // 3. 沿上下两条轨迹连续释放（带涡流摆动）
    const trailLength = 140;
    for (let dist = 15; dist <= trailLength; dist += 6) {
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      const spread = 10 + dist * 0.08;
      const intensity = 1 - dist / trailLength;
      
      // 添加涡流摆动（正弦波）
      const waveOffset = Math.sin(dist * 0.15 + this.time * 2) * 8;
      
      // 上侧轨迹（带上下摆动）
      const yUp = BULLET_Y - spread + waveOffset;
      const vYUp = Math.cos(dist * 0.15) * 12;
      this.fluidDynamics.setVelocity(backX, yUp, 0, 2, 2, -jetSpeed * 0.35 * intensity, vYUp);
      this.fluidDynamics.setDye(backX, yUp, 0, 3, 3, [0.03 * intensity, 0.18 * intensity, 0.35 * intensity]);
      
      // 下侧轨迹（带上下摆动，与上侧相反）
      const yDown = BULLET_Y + spread - waveOffset;
      const vYDown = -Math.cos(dist * 0.15) * 12;
      this.fluidDynamics.setVelocity(backX, yDown, 0, 2, 2, -jetSpeed * 0.35 * intensity, vYDown);
      this.fluidDynamics.setDye(backX, yDown, 0, 3, 3, [0.03 * intensity, 0.18 * intensity, 0.35 * intensity]);
    }

    // 4. 仅保留尾部的分离力（不注入额外染料）
    for (let dist = 80; dist <= 120; dist += 20) {
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      // 沿两侧轨迹继续施加分离力
      const spread = 15 + dist * 0.15;
      this.fluidDynamics.setVelocity(backX, BULLET_Y - spread, 0, 3, 3, -jetSpeed * 0.2, -15);
      this.fluidDynamics.setVelocity(backX, BULLET_Y + spread, 0, 3, 3, -jetSpeed * 0.2, 15);
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