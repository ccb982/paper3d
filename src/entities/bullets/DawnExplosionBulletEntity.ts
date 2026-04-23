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
    
    // 尾气顶点坐标调整
    // 新的归一化方式：以X中点为原点，Y最高点为原点
    // 归一化后：X范围 -0.5 到 0.5，Y范围 -1 到 0
    // 映射到3D空间：X保持不变，Y=0，Z=1+Y（Z范围 0 到 1，0是尾部，1是头部）
    
    // 计算尾气位置：
    // 1. 子弹位置 + 速度方向 * 0.3（子弹尾部位置）
    // 2. 尾气的顶点（X=0, Z=0）需要对齐子弹尾部
    const bulletTailPosition = this.position.clone().add(flightDirection.clone().multiplyScalar(0.3));
    
    // 尾气网格的位置应该让其顶点（X=0, Z=0）对齐子弹尾部
    // 由于尾气几何体的X范围是-0.5到0.5，中心点在X=0
    // 所以直接将尾气网格的位置设置为子弹尾部位置
    this.trailMesh.position.copy(bulletTailPosition);
    
    // 拖尾朝向：与子弹头方向相反
    // 因为尾气头部（Z=1）应该指向与子弹飞行相反的方向
    const trailQuat = this.mesh.quaternion.clone();
    // 创建一个180度旋转的四元数
    const rotation180 = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), // Y轴旋转
      Math.PI // 180度
    );
    // 应用旋转，使尾气朝向与子弹头相反
    trailQuat.multiply(rotation180);
    this.trailMesh.quaternion.copy(trailQuat);
    
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
      
      // 更新尾气位置：
      // 1. 子弹位置 + 速度方向 * 0.3（子弹尾部位置）
      // 2. 尾气的顶点（X=0, Z=0）需要对齐子弹尾部
      const bulletTailPosition = this.position.clone().add(flightDirection.clone().multiplyScalar(0.3));
      
      // 尾气网格的位置应该让其顶点（X=0, Z=0）对齐子弹尾部
      this.trailMesh.position.copy(bulletTailPosition);
      
      // 更新尾气朝向：与子弹头方向相反
      // 因为尾气头部（Z=1）应该指向与子弹飞行相反的方向
      const trailQuat = this.mesh.quaternion.clone();
      // 创建一个180度旋转的四元数
      const rotation180 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), // Y轴旋转
        Math.PI // 180度
      );
      // 应用旋转，使尾气朝向与子弹头相反
      trailQuat.multiply(rotation180);
      this.trailMesh.quaternion.copy(trailQuat);
      
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
