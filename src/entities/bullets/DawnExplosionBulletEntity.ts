import * as THREE from 'three';
import { BulletEntity } from './BulletEntity';
import { EffectManager } from '../../core/EffectManager';

/**
 * 爆裂黎明子弹 - 命中时触发爆裂黎明特效
 * 继承自BulletEntity，添加特效触发功能
 */
export class DawnExplosionBulletEntity extends BulletEntity {
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
  }

  public update(delta: number): void {
    super.update(delta);
  }

  public onDestroy(): void {
    super.onDestroy();
  }
}
