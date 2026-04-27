import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class BulletFluidTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';

  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private elapsedTime: number;

  private bulletPosition: { x: number; y: number };
  private bulletAngle: number;
  private bulletSpeed: number;
  private vortexPhase: number;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);

    // 创建 FluidDynamics 实例
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
    this.texture.needsUpdate = true;

    this.elapsedTime = 0;
    this.bulletPosition = { x: 250, y: 180 };
    this.bulletAngle = 0;
    this.bulletSpeed = 0.01;
    this.vortexPhase = 0;
  }

  generate(): THREE.Texture {
    return this.texture;
  }

  update(delta?: number): void {
    if (!delta) delta = 0.016;

    this.elapsedTime += delta;

    // 子弹侧面视角：固定在左侧，尾迹向右延伸
    this.bulletAngle = 0; // 固定方向向右
    this.bulletPosition.x = 250; // 子弹头部位置（偏右，留出尾气空间）
    this.bulletPosition.y = 180; // 垂直位置（偏上）

    // 子弹后方位置（向右延伸）
    const backwardAngle = 0; // 向右

    // 弹头位置（椭圆形）
    const x = this.bulletPosition.x;
    const y = this.bulletPosition.y;

    // 弹头高压区（椭圆形）
    this.fluidDynamics.setVelocity(x, y, 0, 25, 15, 0, 0);
    this.fluidDynamics.setDye(x, y, 0, 20, 12, [1, 1, 0.95]);

    // 弹头前方（橙色马赫环）
    const aheadX = x + 30;
    const aheadY = y;
    this.fluidDynamics.setVelocity(aheadX, aheadY, 0, 18, 12, 60, 0);
    this.fluidDynamics.setDye(aheadX, aheadY, 0, 15, 10, [1.0, 0.5, 0.2]);

    // 尾气核心区（从弹头后方开始的锥形区域）
    const trailLength = 200;
    const step = 15;
    for (let dist = 25; dist <= trailLength; dist += step) {
      const backX = x - dist; // 向左延伸（弹头在左侧）
      const width = 8 + dist * 0.15; // 尾迹逐渐变宽
      const intensity = 1 - (dist / trailLength);

      // 尾气向后流动
      this.fluidDynamics.setVelocity(backX, y, 0, width, width * 0.6,
        -80 * intensity, (Math.random() - 0.5) * 20);
      this.fluidDynamics.setDye(backX, y, 0, width * 0.8, width * 0.5,
        [0.2, 0.4, 1.0]);
    }

    // 卡门涡街：交替的涡旋在尾迹上下两侧
    const vortexOffset = 12;
    const vortexStrength = 150;
    const alternating = Math.sin(this.elapsedTime * 2) > 0 ? 1 : -1;

    // 第一组涡旋
    const v1X = x - 50;
    this.fluidDynamics.setVelocity(v1X, y + vortexOffset, 0, 15, 15,
      -vortexStrength * alternating, 0);
    this.fluidDynamics.setDye(v1X, y + vortexOffset, 0, 12, 12, [1.0, 0.2, 0.6]);

    this.fluidDynamics.setVelocity(v1X, y - vortexOffset, 0, 15, 15,
      -vortexStrength * alternating, 0);
    this.fluidDynamics.setDye(v1X, y - vortexOffset, 0, 12, 12, [0.1, 0.8, 0.9]);

    // 第二组涡旋
    const v2X = x - 90;
    const alternating2 = Math.sin(this.elapsedTime * 2 + Math.PI) > 0 ? 1 : -1;
    this.fluidDynamics.setVelocity(v2X, y + vortexOffset * 1.5, 0, 14, 14,
      -vortexStrength * 0.8 * alternating2, 0);
    this.fluidDynamics.setDye(v2X, y + vortexOffset * 1.5, 0, 11, 11, [0.9, 0.3, 1.0]);

    this.fluidDynamics.setVelocity(v2X, y - vortexOffset * 1.5, 0, 14, 14,
      -vortexStrength * 0.8 * alternating2, 0);
    this.fluidDynamics.setDye(v2X, y - vortexOffset * 1.5, 0, 11, 11, [0.1, 0.9, 0.7]);

    // 第三组涡旋（更远，强度更弱）
    const v3X = x - 130;
    const alternating3 = Math.sin(this.elapsedTime * 2 + Math.PI * 0.5) > 0 ? 1 : -1;
    this.fluidDynamics.setVelocity(v3X, y + vortexOffset * 2, 0, 12, 12,
      -vortexStrength * 0.6 * alternating3, 0);
    this.fluidDynamics.setDye(v3X, y + vortexOffset * 2, 0, 10, 10, [0.7, 0.2, 0.9]);

    this.fluidDynamics.setVelocity(v3X, y - vortexOffset * 2, 0, 12, 12,
      -vortexStrength * 0.6 * alternating3, 0);
    this.fluidDynamics.setDye(v3X, y - vortexOffset * 2, 0, 10, 10, [0.2, 0.7, 0.8]);

    // 湍流效果：添加一些随机扰动
    for (let i = 0; i < 5; i++) {
      const turbX = x - 40 - Math.random() * 150;
      const turbY = y + (Math.random() - 0.5) * 60;
      this.fluidDynamics.setVelocity(turbX, turbY, 0, 20, 20,
        (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50);
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}