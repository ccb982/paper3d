import * as THREE from 'three';
import { BulletEntity } from './BulletEntity';
import { EffectManager } from '../../core/EffectManager';
import { EntityManager } from '../../core/EntityManager';
import { CharacterEntity } from '../characters/CharacterEntity';
import { StaticEntity } from '../static/StaticEntity';

/**
 * 爆裂黎明子弹 - 命中时触发爆裂黎明特效并造成范围伤害
 * 继承自BulletEntity，添加特效触发和范围伤害功能
 */
export class DawnExplosionBulletEntity extends BulletEntity {
  private explosionRadius: number = 10; // 爆炸范围半径

  /**
   * 创建爆裂黎明子弹
   * @param position 发射位置（世界坐标）
   * @param direction 方向向量（需归一化）
   * @param speed 速度（单位/秒）
   * @param color 子弹颜色（默认金色）
   */
  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    color: number = 0xffd700
  ) {
    super(position, direction, speed, color);
    // 设置更高的伤害值
    this.setDamage(2);
  }

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

  public update(delta: number): void {
    super.update(delta);
  }

  public onDestroy(): void {
    super.onDestroy();
  }
}
