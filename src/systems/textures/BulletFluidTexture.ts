import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class BulletFluidTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';

  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private lastTimestamp: number = 0;

  private readonly BULLET_X = 420;
  private readonly BULLET_Y = 256;
  private readonly TRAIL_LENGTH = 180;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);

    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: 512,
      height: 512,
      simScale: 1.0,
      dyeScale: 1.2,
      curl: 12,
      velocityDissipation: 0.05,
      dyeDissipation: 0.08,
      pressureIterations: 20
    });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.lastTimestamp = performance.now();
    this.animate();
  }

  generate(): THREE.Texture {
    return this.texture;
  }

  private injectFluid(): void {
    const x = this.BULLET_X;
    const y = this.BULLET_Y;

    // 全局背景向后推力（模拟子弹高速运动时尾气被甩向后方）
    for (let bx = 0; bx < 512; bx += 40) {
      for (let by = 0; by < 512; by += 40) {
        this.fluidDynamics.setVelocity(bx, by, 0, 35, 35, -30, 0);
      }
    }

    // 弹头高压区（白色椭圆形）
    this.fluidDynamics.setVelocity(x, y, 0, 35, 25, 0, 0);
    this.fluidDynamics.setDye(x, y, 0, 30, 20, [1, 1, 0.95]);

    // 前方弧形阻挡罩（阻止尾气向前扩散）
    for (let angle = -Math.PI * 0.5; angle <= Math.PI * 0.5; angle += Math.PI * 0.1) {
      const radius = 25;
      const shieldX = x + Math.cos(angle) * radius;
      const shieldY = y + Math.sin(angle) * radius;
      if (shieldX < 512 && shieldX > 0 && shieldY < 512 && shieldY > 0) {
        const pushX = -Math.cos(angle) * 100;
        const pushY = -Math.sin(angle) * 80;
        this.fluidDynamics.setVelocity(shieldX, shieldY, 0, 22, 22, pushX, pushY);
      }
    }

    // 后方大范围引导罩（把尾气限制在锥形区域内并向后引导）
    for (let angle = Math.PI * 0.5; angle <= Math.PI * 1.5; angle += Math.PI * 0.06) {
      const radius = 80;
      const guideX = x + Math.cos(angle) * radius;
      const guideY = y + Math.sin(angle) * radius;
      if (guideX < 512 && guideX > 0 && guideY < 512 && guideY > 0) {
        const pushX = -60;
        const pushY = -Math.sin(angle) * 40;
        this.fluidDynamics.setVelocity(guideX, guideY, 0, 25, 25, pushX, pushY);
      }
    }

    // 尾气核心（从弹头后方喷出，向左延伸，更强的向后速度）
    const step = 12;
    for (let dist = 20; dist <= this.TRAIL_LENGTH; dist += step) {
      const backX = x - dist;
      if (backX < 0) continue;
      const width = 6 + dist * 0.12;
      const intensity = 1 - (dist / this.TRAIL_LENGTH) * 0.5;

      this.fluidDynamics.setVelocity(backX, y, 0, width, width * 0.5,
        -150 * intensity, (Math.random() - 0.5) * 10);
      this.fluidDynamics.setDye(backX, y, 0, width * 0.7, width * 0.4,
        [0.2, 0.4, 1.0]);
    }

    // 卡门涡街（尾气两侧的交替涡旋）
    const vortexOffset = 15;
    const vortexStrength = 200;
    const alternating = Math.sin(performance.now() * 0.0015) > 0 ? 1 : -1;

    const v1X = x - 40;
    if (v1X > 0) {
      this.fluidDynamics.setVelocity(v1X, y + vortexOffset, 0, 18, 18,
        -vortexStrength * alternating, -20);
      this.fluidDynamics.setDye(v1X, y + vortexOffset, 0, 14, 14, [1.0, 0.2, 0.6]);

      this.fluidDynamics.setVelocity(v1X, y - vortexOffset, 0, 18, 18,
        -vortexStrength * alternating, 20);
      this.fluidDynamics.setDye(v1X, y - vortexOffset, 0, 14, 14, [0.1, 0.8, 0.9]);
    }

    const v2X = x - 80;
    if (v2X > 0) {
      const alternating2 = Math.sin(performance.now() * 0.0015 + Math.PI) > 0 ? 1 : -1;
      this.fluidDynamics.setVelocity(v2X, y + vortexOffset * 1.3, 0, 16, 16,
        -vortexStrength * 0.7 * alternating2, -15);
      this.fluidDynamics.setDye(v2X, y + vortexOffset * 1.3, 0, 12, 12, [0.9, 0.3, 1.0]);

      this.fluidDynamics.setVelocity(v2X, y - vortexOffset * 1.3, 0, 16, 16,
        -vortexStrength * 0.7 * alternating2, 15);
      this.fluidDynamics.setDye(v2X, y - vortexOffset * 1.3, 0, 12, 12, [0.1, 0.9, 0.7]);
    }

    const v3X = x - 120;
    if (v3X > 0) {
      const alternating3 = Math.sin(performance.now() * 0.0015 + Math.PI * 0.5) > 0 ? 1 : -1;
      this.fluidDynamics.setVelocity(v3X, y + vortexOffset * 1.6, 0, 14, 14,
        -vortexStrength * 0.5 * alternating3, -10);
      this.fluidDynamics.setDye(v3X, y + vortexOffset * 1.6, 0, 10, 10, [0.7, 0.2, 0.9]);

      this.fluidDynamics.setVelocity(v3X, y - vortexOffset * 1.6, 0, 14, 14,
        -vortexStrength * 0.5 * alternating3, 10);
      this.fluidDynamics.setDye(v3X, y - vortexOffset * 1.6, 0, 10, 10, [0.2, 0.7, 0.8]);
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min(0.033, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;

    this.injectFluid();
    this.texture.needsUpdate = true;
  };

  update(delta?: number): void {
  }

  dispose(): void {
    this.texture.dispose();
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}