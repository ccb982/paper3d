import { BaseEffect } from './BaseEffect';
import { HitFlashEffect } from '../effects/HitFlashEffect';
import { MuzzleFlashEffect } from '../effects/MuzzleFlashEffect';
import { ExplosionEffect } from '../effects/ExplosionEffect';
import { RingWaveEffect } from '../effects/RingWaveEffect';
import * as THREE from 'three';

/**
 * 特效管理器 - 单例模式
 */
export class EffectManager {
  private static instance: EffectManager;
  private activeEffects: BaseEffect[] = [];

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
