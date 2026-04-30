import { BaseEffect } from './BaseEffect';
import { HitFlashEffect } from '../effects/HitFlashEffect';
import { MuzzleFlashEffect } from '../effects/MuzzleFlashEffect';
import { ExplosionEffect } from '../effects/ExplosionEffect';
import { RingWaveEffect } from '../effects/RingWaveEffect';
import { DawnBurstEffect } from '../effects/DawnBurstEffect';
import { ParticleFireEffect } from '../effects/ParticleFireEffect';
import { FluidEffect } from '../effects/FluidEffect';
import { BulletFluidEffect } from '../effects/BulletFluidEffect';
import { GroundCanvasEffect } from '../effects/GroundCanvasEffect';
import { TriangleFluidEffect } from '../effects/TriangleFluidEffect';
import { VerticalTriangleEffect } from '../effects/VerticalTriangleEffect';
import * as THREE from 'three';

/**
 * 特效管理器 - 单例模式
 */
export class EffectManager {
  private static instance: EffectManager;
  private activeEffects: BaseEffect[] = [];
  private particleFireEffects: ParticleFireEffect[] = [];

  private constructor() {}

  public static getInstance(): EffectManager {
    if (!EffectManager.instance) EffectManager.instance = new EffectManager();
    return EffectManager.instance;
  }

  /**
   * 播放命中闪光特效
   */
  public playHitFlash(position: THREE.Vector3, color?: number): void {
    this.activeEffects.push(new HitFlashEffect(position, 0.5, 0.2, color || 0xffaa44));
  }

  /**
   * 播放枪口闪光特效
   */
  public playMuzzleFlash(position: THREE.Vector3): void {
    this.activeEffects.push(new MuzzleFlashEffect(position, 0.1));
  }

  /**
   * 播放爆炸特效
   */
  public playExplosion(position: THREE.Vector3): void {
    this.activeEffects.push(new ExplosionEffect(position, 0.8));
  }

  /**
   * 播放环形波特效
   */
  public playRingWave(position: THREE.Vector3, color?: number): void {
    this.activeEffects.push(new RingWaveEffect(position, 0.5, color || 0x33aaff));
  }

  /**
   * 播放爆裂黎明特效
   */
  public playDawnExplosion(position: THREE.Vector3): void {
    this.activeEffects.push(new DawnBurstEffect(position, 4.0));
  }

  /**
   * 播放粒子火焰特效（场景中的火）
   */
  public playParticleFireEffect(position: THREE.Vector3, duration: number = Infinity): ParticleFireEffect {
    const fireEffect = new ParticleFireEffect(position, duration);
    this.particleFireEffects.push(fireEffect);
    return fireEffect;
  }

  /**
   * 播放流体特效
   */
  public playFluidEffect(position: THREE.Vector3, duration: number = 10.0, size: number = 5.0): void {
    this.activeEffects.push(new FluidEffect(position, duration, size));
  }

  /**
   * 播放子弹流体特效（基于物理模拟）
   */
  public playBulletFluidEffect(position: THREE.Vector3, duration: number = 30.0, size: number = 8.0): void {
    this.activeEffects.push(new BulletFluidEffect(position, duration, size));
  }

  /**
   * 在地面上创建画布特效（平躺在地面上）
   */
  public playGroundCanvasEffect(position: THREE.Vector3, duration: number = 30.0, width: number = 20.0, height: number = 20.0): void {
    this.activeEffects.push(new GroundCanvasEffect(position, duration, width, height));
  }

  /**
   * 播放三角形流体特效
   */
  public playTriangleFluidEffect(position: THREE.Vector3, duration: number = 30.0, size: number = 10.0): void {
    this.activeEffects.push(new TriangleFluidEffect(position, duration, size));
  }

  /**
   * 播放竖直三角形水滴特效（水滴撞击三角形固体）
   */
  public playVerticalTriangleEffect(position: THREE.Vector3, duration: number = 30.0, size: number = 10.0): void {
    this.activeEffects.push(new VerticalTriangleEffect(position, duration, size));
  }

  /**
   * 清除所有粒子火焰特效
   */
  public clearAllParticleFireEffects(): void {
    for (const fireEffect of this.particleFireEffects) {
      fireEffect.dispose();
    }
    this.particleFireEffects = [];
  }

  /**
   * 添加特效
   */
  public addEffect(effect: BaseEffect): void {
    this.activeEffects.push(effect);
  }

  /**
   * 移除特效
   */
  public removeEffect(effect: BaseEffect): void {
    const index = this.activeEffects.indexOf(effect);
    if (index !== -1) {
      effect.dispose();
      this.activeEffects.splice(index, 1);
    }
  }

  /**
   * 每帧更新所有特效
   */
  public update(delta: number): void {
    for (let i = this.activeEffects.length-1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.update(delta);
      if (!effect.isActive) {
        effect.dispose();
        this.activeEffects.splice(i, 1);
      }
    }
    
    // 更新粒子火焰特效
    for (let i = this.particleFireEffects.length-1; i >= 0; i--) {
      const fireEffect = this.particleFireEffects[i];
      fireEffect.update(delta);
      if (!fireEffect.isActive) {
        fireEffect.dispose();
        this.particleFireEffects.splice(i, 1);
      }
    }
  }

  /**
   * 清除所有特效
   */
  public clear(): void {
    for (let i = this.activeEffects.length-1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.dispose();
      this.activeEffects.splice(i, 1);
    }
  }

  /**
   * 获取当前活跃特效数量
   */
  public getActiveEffectCount(): number {
    return this.activeEffects.length;
  }
}

// 导出单例实例
export const effectManager = EffectManager.getInstance();
