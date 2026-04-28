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
      curl: 2,
      velocityDissipation: 0.95,   // 尾气寿命约0.3s
      dyeDissipation: 0.95,
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
    
    // 在喷射口之间添加实体阻挡线（厚度30px）
    this.fluidDynamics.setVelocity(nozzleX, BULLET_Y, 0, 10, 30, 0, 0);
    
    // 在喷射口正后方添加强侧向推力（直接作用于喷出的流体）
    const pushOffset = 6;  // 推力位置靠近喷射口
    this.fluidDynamics.setVelocity(nozzleX - 3, BULLET_Y - pushOffset, 0, 5, 4, -30, -40);  // 上侧向左上推
    this.fluidDynamics.setVelocity(nozzleX - 3, BULLET_Y + pushOffset, 0, 5, 4, -30, 40);   // 下侧向左下推
    
    // 上侧喷射口（染料0.1×0.1）
    const nozzleYUp = BULLET_Y - nozzleOffset - 2;
    this.fluidDynamics.setVelocity(nozzleX, nozzleYUp, 0, 3, 2, -jetSpeed * pulse * 0.8, -15);
    this.fluidDynamics.setDye(nozzleX, nozzleYUp, 0, 0.1, 0.1, [0.05, 0.25, 0.45]);
    
    // 下侧喷射口（染料0.1×0.1）
    const nozzleYDown = BULLET_Y + nozzleOffset + 2;
    this.fluidDynamics.setVelocity(nozzleX, nozzleYDown, 0, 3, 2, -jetSpeed * pulse * 0.8, 15);
    this.fluidDynamics.setDye(nozzleX, nozzleYDown, 0, 0.1, 0.1, [0.05, 0.25, 0.45]);

    // 3. 沿上下两条轨迹分别释放（更大间隔，染料0.1×0.1）
    const trailLength = 120;
    for (let dist = 25; dist <= trailLength; dist += 28) {
      const backX = BULLET_X - dist;
      if (backX < 0) continue;
      
      const spread = 12 + dist * 0.1;
      
      // 上侧轨迹
      const yUp = BULLET_Y - spread;
      this.fluidDynamics.setVelocity(backX, yUp, 0, 2, 2, -jetSpeed * 0.3, -8);
      this.fluidDynamics.setDye(backX, yUp, 0, 0.1, 0.1, [0.04, 0.2, 0.4]);
      
      // 下侧轨迹
      const yDown = BULLET_Y + spread;
      this.fluidDynamics.setVelocity(backX, yDown, 0, 2, 2, -jetSpeed * 0.3, 8);
      this.fluidDynamics.setDye(backX, yDown, 0, 0.1, 0.1, [0.04, 0.2, 0.4]);
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