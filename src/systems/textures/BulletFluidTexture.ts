import * as THREE from 'three';
import { FluidDynamics } from '@bienehito/fluid-dynamics';
import { CameraStore } from '../../core/CameraStore';

export class BulletFluidTexture implements ITextureGenerator {
  type: 'canvas' | 'shader' = 'canvas';
  
  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private elapsedTime: number;
  
  // 子弹模拟参数
  private bulletPosition: { x: number; y: number };
  private bulletAngle: number;
  private bulletSpeed: number;
  private vortexPhase: number;

  constructor() {
    // 创建 canvas 元素
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    
    // 创建 FluidDynamics 实例
    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: 512,
      height: 512,
      simScale: 0.8,
      dyeScale: 1.0,
      curl: 4,
      velocityDissipation: 0.03,
      dyeDissipation: 0.02,
      pressureIterations: 20
    });
    
    // 创建 canvas 纹理
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.needsUpdate = true;
    
    // 初始化子弹参数
    this.elapsedTime = 0;
    this.bulletPosition = { x: 256, y: 256 };
    this.bulletAngle = 0;
    this.bulletSpeed = 0.5;
    this.vortexPhase = 0;
  }

  generate(): THREE.Texture {
    return this.texture;
  }

  update(delta?: number): void {
    if (!delta) delta = 0.016;
    
    this.elapsedTime += delta;
    
    // 更新子弹位置（圆形运动）
    this.bulletAngle += this.bulletSpeed;
    this.bulletPosition.x = 256 + Math.cos(this.bulletAngle) * 100;
    this.bulletPosition.y = 256 + Math.sin(this.bulletAngle) * 100;
    
    // 更新涡旋相位
    this.vortexPhase += delta * 5;
    
    const x = this.bulletPosition.x;
    const y = this.bulletPosition.y;
    
    // 1. 在弹头位置施加"滞止"高压效果（减小白色范围）
    this.fluidDynamics.setVelocity(x, y, 0, 20, 20, 0, 0); // 中心速度为零，模拟高压区
    this.fluidDynamics.setDye(x, y, 0, 15, 15, [1, 1, 0.9]); // 中心注入淡白色染料
    
    // 2. 在弹头后方施加"加速"低压区
    const backwardAngle = this.bulletAngle + Math.PI;
    const suctionX = x + Math.cos(backwardAngle) * 30;
    const suctionY = y + Math.sin(backwardAngle) * 30;
    const speedForce = 200;
    const vx = Math.cos(backwardAngle) * speedForce;
    const vy = Math.sin(backwardAngle) * speedForce;
    this.fluidDynamics.setVelocity(suctionX, suctionY, 0, 60, 60, vx, vy);
    
    // 在低压区注入蓝色染料
    this.fluidDynamics.setDye(suctionX, suctionY, 0, 40, 40, [0.1, 0.3, 1.0]);
    
    // 3. 在尾部路径上生成交替的涡旋能量（模拟卡门涡街）
    const trailDistance = 50;
    const trailX = x + Math.cos(backwardAngle) * trailDistance;
    const trailY = y + Math.sin(backwardAngle) * trailDistance;
    const vortexStrength = 120;
    const alternating = Math.sin(this.vortexPhase) > 0 ? 1 : -1;
    
    // 生成一对交替的旋涡
    const vortexOffset = 25;
    const vortex1X = trailX + Math.cos(backwardAngle + Math.PI/2) * vortexOffset;
    const vortex1Y = trailY + Math.sin(backwardAngle + Math.PI/2) * vortexOffset;
    const vortex2X = trailX - Math.cos(backwardAngle + Math.PI/2) * vortexOffset;
    const vortex2Y = trailY - Math.sin(backwardAngle + Math.PI/2) * vortexOffset;
    
    // 对两个涡旋施加旋转力
    this.fluidDynamics.setVelocity(vortex1X, vortex1Y, 0, 40, 40, 
      -alternating * vortexStrength, alternating * vortexStrength);
    this.fluidDynamics.setVelocity(vortex2X, vortex2Y, 0, 40, 40, 
      alternating * vortexStrength, -alternating * vortexStrength);
    
    // 注入鲜艳的染料到涡旋位置
    this.fluidDynamics.setDye(trailX, trailY, 0, 35, 35, [0.3, 0.6, 1.0]);
    this.fluidDynamics.setDye(vortex1X, vortex1Y, 0, 30, 30, [1.0, 0.1, 0.5]); // 粉色
    this.fluidDynamics.setDye(vortex2X, vortex2Y, 0, 30, 30, [0.1, 0.9, 0.8]); // 青色
    
    // 4. 添加另一个更远的涡旋对（模拟马赫环）
    const trailDistance2 = 90;
    const trailX2 = x + Math.cos(backwardAngle) * trailDistance2;
    const trailY2 = y + Math.sin(backwardAngle) * trailDistance2;
    const vortex1X2 = trailX2 + Math.cos(backwardAngle + Math.PI/2) * vortexOffset * 1.5;
    const vortex1Y2 = trailY2 + Math.sin(backwardAngle + Math.PI/2) * vortexOffset * 1.5;
    const vortex2X2 = trailX2 - Math.cos(backwardAngle + Math.PI/2) * vortexOffset * 1.5;
    const vortex2Y2 = trailY2 - Math.sin(backwardAngle + Math.PI/2) * vortexOffset * 1.5;
    
    const alternating2 = Math.sin(this.vortexPhase + Math.PI) > 0 ? 1 : -1;
    this.fluidDynamics.setVelocity(vortex1X2, vortex1Y2, 0, 35, 35, 
      -alternating2 * vortexStrength * 0.8, alternating2 * vortexStrength * 0.8);
    this.fluidDynamics.setVelocity(vortex2X2, vortex2Y2, 0, 35, 35, 
      alternating2 * vortexStrength * 0.8, -alternating2 * vortexStrength * 0.8);
    
    this.fluidDynamics.setDye(trailX2, trailY2, 0, 25, 25, [0.9, 0.3, 1.0]);
    this.fluidDynamics.setDye(vortex1X2, vortex1Y2, 0, 25, 25, [0.8, 0.1, 0.6]);
    this.fluidDynamics.setDye(vortex2X2, vortex2Y2, 0, 25, 25, [0.1, 0.8, 0.9]);
    
    // 5. 添加第三个更远的涡旋对
    const trailDistance3 = 130;
    const trailX3 = x + Math.cos(backwardAngle) * trailDistance3;
    const trailY3 = y + Math.sin(backwardAngle) * trailDistance3;
    const vortex1X3 = trailX3 + Math.cos(backwardAngle + Math.PI/2) * vortexOffset * 2;
    const vortex1Y3 = trailY3 + Math.sin(backwardAngle + Math.PI/2) * vortexOffset * 2;
    const vortex2X3 = trailX3 - Math.cos(backwardAngle + Math.PI/2) * vortexOffset * 2;
    const vortex2Y3 = trailY3 - Math.sin(backwardAngle + Math.PI/2) * vortexOffset * 2;
    
    const alternating3 = Math.sin(this.vortexPhase + Math.PI * 0.5) > 0 ? 1 : -1;
    this.fluidDynamics.setVelocity(vortex1X3, vortex1Y3, 0, 30, 30, 
      -alternating3 * vortexStrength * 0.6, alternating3 * vortexStrength * 0.6);
    this.fluidDynamics.setVelocity(vortex2X3, vortex2Y3, 0, 30, 30, 
      alternating3 * vortexStrength * 0.6, -alternating3 * vortexStrength * 0.6);
    
    this.fluidDynamics.setDye(trailX3, trailY3, 0, 20, 20, [0.7, 0.2, 0.9]);
    
    // 更新纹理（FluidDynamics 库内部会自动更新）
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}