import * as THREE from 'three';
import { Entity } from '../../core/Entity';
import { EntityManager } from '../../core/EntityManager';
import { generateId } from '../../utils/idGenerator';

/**
 * 子弹实体 - 代替原 BulletPool
 * 支持移动、生命周期、简易碰撞检测
 */
export class BulletEntity extends Entity {
  private velocity: THREE.Vector3;
  private lifetime: number = 3000;
  private createdAt: number;
  private damage: number = 1;

  /**
   * 创建子弹实体
   * @param position 发射位置（世界坐标）
   * @param direction 方向向量（需归一化）
   * @param speed 速度（单位/秒）
   * @param color 子弹颜色（默认橙色）
   */
  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    color: number = 0xffaa00
  ) {
    const id = generateId('bullet');

    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: 0x442200,
      emissiveIntensity: 0.5
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    super(id, 'bullet', mesh);

    this.velocity = direction.clone().normalize().multiplyScalar(speed);
    this.createdAt = Date.now();
    this.radius = 0.1;
  }

  /**
   * 设置子弹伤害值
   */
  public setDamage(damage: number): void {
    this.damage = damage;
  }

  /**
   * 设置子弹存活时间（毫秒）
   */
  public setLifetime(ms: number): void {
    this.lifetime = ms;
  }

  /**
   * 获取子弹伤害值
   */
  public getDamage(): number {
    return this.damage;
  }

  public update(delta: number): void {
    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;
    this.mesh.position.copy(this.position);

    if (Date.now() - this.createdAt > this.lifetime) {
      this.isActive = false;
    }
  }

  /**
   * 命中实体时的处理
   * @param entity 被击中的实体
   */
  protected onHit(entity: Entity): void {
    if (typeof (entity as any).takeDamage === 'function') {
      (entity as any).takeDamage(this.damage);
    }
  }

  public onDestroy(): void {
  }
}