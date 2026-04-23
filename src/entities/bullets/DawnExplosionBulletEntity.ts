import * as THREE from 'three';
import { BulletEntity } from './BulletEntity';
import { EffectManager } from '../../core/EffectManager';
import { EntityManager } from '../../core/EntityManager';
import { CharacterEntity } from '../characters/CharacterEntity';
import { StaticEntity } from '../static/StaticEntity';
import { TextureManager } from '../../systems/textures/TextureManager';
import { createBulletTrailTexture, createBulletTrailGeometry, createBulletTrailMaterial } from '../../systems/textures/BulletTrailTexture';

/**
 * 爆裂黎明子弹 - 命中时触发爆裂黎明特效并造成范围伤害
 * 继承自BulletEntity，添加特效触发和范围伤害功能
 */
export class DawnExplosionBulletEntity extends BulletEntity {
  private explosionRadius: number = 10; // 爆炸范围半径
  private trailMesh: THREE.Mesh | null = null; // 尾气网格
  private trailMaterial: THREE.ShaderMaterial | null = null; // 尾气材质
  private trailTime: number = 0; // 尾气时间

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    color: number = 0xdd5b42 // 子弹颜色：#dd5b42
  ) {
    super(position, direction, speed, color);
    // 设置更高的伤害值
    this.setDamage(2);
    
    // 创建尾气特效（双层不同摆动算法）
    this.createTrailEffect();
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

  private createTrailEffect(): void {
    const textureManager = new TextureManager();
    
    // 创建尾气纹理
    createBulletTrailTexture(textureManager);
    const texture = textureManager.getTexture('bullet-trail');
    
    if (!texture) return;
    
    // 创建尾气几何体和材质
    const geometry = createBulletTrailGeometry();
    this.trailMaterial = createBulletTrailMaterial(texture);
    
    // 创建尾气网格
    this.trailMesh = new THREE.Mesh(geometry, this.trailMaterial);
    
    // 计算飞行方向（从velocity获取）
    const flightDirection = this.velocity.clone().normalize();
    
    // 拖尾位置：附着在子弹尾部（速度反方向偏移）
    const trailOffset = flightDirection.clone().multiplyScalar(-0.5); // 向后偏移 0.5
    this.trailMesh.position.copy(this.position).add(trailOffset);
    
    // 拖尾朝向：参考子弹头的方向
    this.trailMesh.quaternion.copy(this.mesh.quaternion);
    
    // 添加到场景
    const scene = EntityManager.getInstance().getScene();
    if (scene) {
      scene.add(this.trailMesh);
    }
  }

  public update(delta: number): void {
    super.update(delta);
    
    // 更新尾气时间
    this.trailTime += delta;
    
    // 更新尾气位置和朝向
    if (this.trailMesh && this.trailMaterial) {
      // 计算飞行方向（从velocity获取）
      const flightDirection = this.velocity.clone().normalize();
      
      // 更新尾气位置：附着在子弹尾部（速度反方向偏移）
      const trailOffset = flightDirection.clone().multiplyScalar(-0.5); // 向后偏移 0.5
      this.trailMesh.position.copy(this.position).add(trailOffset);
      
      // 更新尾气朝向：参考子弹头的方向
      this.trailMesh.quaternion.copy(this.mesh.quaternion);
      
      // 更新着色器时间uniform
      this.trailMaterial.uniforms.uTime.value = this.trailTime;
    }
  }

  public onDestroy(): void {
    super.onDestroy();
    
    // 清理尾气网格
    if (this.trailMesh) {
      const scene = EntityManager.getInstance().getScene();
      if (scene) {
        scene.remove(this.trailMesh);
      }
      if (this.trailMesh.geometry) {
        this.trailMesh.geometry.dispose();
      }
      if (this.trailMaterial) {
        this.trailMaterial.dispose();
      }
      this.trailMesh = null;
      this.trailMaterial = null;
    }
  }
}
