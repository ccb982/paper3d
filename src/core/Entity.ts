import * as THREE from 'three';

interface DamageInfo {
  amount: number;
  type?: 'physical' | 'fire' | 'ice' | 'electric';
  source?: Entity;
}

/**
 * 实体基类 - 所有动态对象（玩家、敌人、子弹、特效）都应继承此类
 */
export abstract class Entity {
  public id: string;
  public type: string;
  public mesh: THREE.Object3D;
  public position: THREE.Vector3;
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public isActive: boolean = true;
  public radius: number = 0.5;
  public health: number = 1;
  public maxHealth: number = 1;

  constructor(id: string, type: string, mesh: THREE.Object3D) {
    this.id = id;
    this.type = type;
    this.mesh = mesh;
    this.position = mesh.position.clone();
  }

  /**
   * 每帧更新（子类必须实现）
   * @param delta 时间差（秒）
   */
  public abstract update(delta: number): void;

  /**
   * 承受伤害
   * @param damage 伤害信息
   */
  public takeDamage(damage: DamageInfo | number): void {
    const damageInfo = typeof damage === 'number' ? { amount: damage } : damage;
    this.health = Math.max(0, this.health - damageInfo.amount);
    if (this.health <= 0) {
      this.onDeath();
    }
  }

  /**
   * 死亡时调用
   * 子类可覆盖以添加死亡逻辑
   */
  public onDeath(): void {
    this.isActive = false;
  }

  /**
   * 销毁时调用（从场景移除、清理资源）
   * 子类可覆盖以添加额外逻辑
   */
  public onDestroy(): void {
  }
}