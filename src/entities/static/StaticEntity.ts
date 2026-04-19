import { Entity } from '../../core/Entity';
import * as THREE from 'three';

export class StaticEntity extends Entity {
  public isShootable: boolean = true;   // 可被射击
  public health: number = 1;            // 生命值（默认1，一击即毁）
  public maxHealth: number = 1;         // 最大生命值

  constructor(id: string, mesh: THREE.Object3D, position: THREE.Vector3) {
    // 添加可射击属性到 userData
    mesh.userData = {
      ...mesh.userData,
      isShootable: true,
      staticEntityId: id
    };
    super(id, 'static', mesh);
    this.position.copy(position);
    this.mesh.position.copy(position);
  }

  /**
   * 静态物品不需要每帧更新（除非有动画）
   */
  public update(delta: number): void {
    // 静态物品通常无更新逻辑
    // 如有需要（如旋转、漂浮动画），可在此添加
  }

  /**
   * 受到伤害时的处理
   */
  public takeDamage(amount: number): void {
    this.health -= amount;
    if (this.health <= 0) {
      this.onDestroy();
      this.isActive = false;
    } else {
      this.onHit();
    }
  }

  /**
   * 命中时调用（子类可覆盖，例如变色）
   */
  protected onHit(): void {
    // 默认空实现
  }

  /**
   * 销毁时调用（子类可覆盖，例如播放特效）
   */
  public onDestroy(): void {
    // 默认从场景移除
  }
}