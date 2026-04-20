import * as THREE from 'three';
import { BulletEntity } from './BulletEntity';
import { EffectManager } from '../../core/EffectManager';
import { EntityManager } from '../../core/EntityManager';
import { CharacterEntity } from '../characters/CharacterEntity';
import { StaticEntity } from '../static/StaticEntity';
import { FireEffect } from '../../effects/FireEffect';

/**
 * 爆裂黎明子弹 - 命中时触发爆裂黎明特效并造成范围伤害
 * 继承自BulletEntity，添加特效触发和范围伤害功能
 */
export class DawnExplosionBulletEntity extends BulletEntity {
  private explosionRadius: number = 10; // 爆炸范围半径
  private fireEffects: FireEffect[] = []; // 多层火焰特效



  /**
   * 命中实体时的处理
   * @param entity 被击中的实体
   */
  protected onHit(entity: any): void {
    super.onHit(entity);
    // 触发爆裂黎明特效
    EffectManager.getInstance().playDawnExplosion(this.position);
    // 造成范围伤害
    this.applyAreaDamage();
  }

  /**
   * 应用范围伤害
   */
  private applyAreaDamage(): void {
    const allEntities = EntityManager.getInstance().getAllEntities();
    const areaDamage = this.getDamage() * 0.5; // 范围伤害为直接伤害的50%

    allEntities.forEach((entity) => {
      // 跳过自身和已经不活跃的实体
      if (entity.id === this.id || !entity.isActive) return;

      // 计算实体与爆炸中心的距离
      const distance = entity.position.distanceTo(this.position);
      
      // 如果在爆炸范围内
      if (distance <= this.explosionRadius) {
        // 对敌人和可射击的静态实体造成伤害
        if (
          (entity instanceof CharacterEntity && (entity as CharacterEntity).faction === 'enemy') ||
          (entity instanceof StaticEntity && (entity as StaticEntity).isShootable)
        ) {
          // 距离越近，伤害越高
          const damageMultiplier = 1 - (distance / this.explosionRadius);
          const finalDamage = Math.round(areaDamage * damageMultiplier);
          
          if (finalDamage > 0 && typeof entity.takeDamage === 'function') {
            entity.takeDamage(finalDamage);
          }
        }
      }
    });
  }

  // 存储尾焰的随机参数
  private fireEffectParams: { angle: number; distance: number; yOffset: number }[] = [];

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    color: number = 0xdd5b42 // 子弹颜色：#dd5b42
  ) {
    super(position, direction, speed, color);
    // 设置更高的伤害值
    this.setDamage(2);
    
    // 创建多层火焰特效，包裹子弹
    const effectCount = 8; // 8层尾焰，形成包裹效果
    for (let i = 0; i < effectCount; i++) {
      // 计算每层尾焰的位置，围绕子弹分布，添加随机性
      const angle = (i / effectCount) * Math.PI * 2 + Math.random() * 0.5; // 随机角度偏移
      const distance = 0.2 + i * 0.15 + Math.random() * 0.1; // 随机距离偏移
      const yOffset = (Math.random() - 0.5) * 0.3; // 随机Y方向偏移
      
      // 存储随机参数
      this.fireEffectParams.push({ angle, distance, yOffset });
      
      // 计算偏移向量
      const offset = new THREE.Vector3(
        Math.sin(angle) * distance,
        yOffset,
        Math.cos(angle) * distance
      );
      
      // 确保尾焰在子弹周围分布
      const effectPosition = position.clone().add(offset);
      
      // 每层尾焰的尺寸不同，添加随机性
      const width = (2.0 - i * 0.15) * (0.8 + Math.random() * 0.4); // 随机宽度
      const height = (2.5 - i * 0.2) * (0.8 + Math.random() * 0.4); // 随机高度
      
      // 每层尾焰的持续时间不同
      const duration = 6.0 - i * 0.5 + Math.random() * 1.0; // 随机持续时间
      
      // 创建火焰特效
      const fireEffect = new FireEffect(effectPosition, duration, width, height);
      // 添加随机旋转
      if (fireEffect['mesh']) {
        fireEffect['mesh'].rotation.x = Math.random() * Math.PI * 2;
        fireEffect['mesh'].rotation.y = Math.random() * Math.PI * 2;
        fireEffect['mesh'].rotation.z = Math.random() * Math.PI * 2;
      }
      this.fireEffects.push(fireEffect);
      EffectManager.getInstance().addEffect(fireEffect);
    }
  }

  public update(delta: number): void {
    super.update(delta);
    // 让所有火焰特效随子弹移动，保持包裹效果和随机性
    this.fireEffects.forEach((fireEffect, index) => {
      if (fireEffect && fireEffect['mesh'] && this.fireEffectParams[index]) {
        const { angle, distance, yOffset } = this.fireEffectParams[index];
        
        // 计算偏移向量，使用存储的随机参数
        const offset = new THREE.Vector3(
          Math.sin(angle) * distance,
          yOffset,
          Math.cos(angle) * distance
        );
        
        // 确保尾焰在子弹周围分布
        const effectPosition = this.position.clone().add(offset);
        fireEffect['mesh'].position.copy(effectPosition);
      }
    });
  }

  public onDestroy(): void {
    super.onDestroy();
    // 清理所有火焰特效
    this.fireEffects.forEach((fireEffect) => {
      if (fireEffect) {
        EffectManager.getInstance().removeEffect(fireEffect);
      }
    });
    this.fireEffects = [];
  }
}
