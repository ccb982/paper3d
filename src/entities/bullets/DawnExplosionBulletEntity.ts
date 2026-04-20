import * as THREE from 'three';
import { BulletEntity } from './BulletEntity';
import { EffectManager } from '../../core/EffectManager';
import { EntityManager } from '../../core/EntityManager';
import { CharacterEntity } from '../characters/CharacterEntity';
import { StaticEntity } from '../static/StaticEntity';

/**
 * 创建火焰精灵特效
 */
function createFireSprite(position: THREE.Vector3, size: number = 0.5): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128; // 增大画布尺寸
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ 
    map: texture, 
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9 // 增加不透明度
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(size, size, 1);
  
  let time = 0;
  function animate() {
    time += 0.05;
    ctx.clearRect(0, 0, 128, 128);
    // 绘制火焰形状（椭圆形，随机的波动）
    const radiusX = 40 + Math.sin(time * 8) * 8; // 增大火焰半径
    const radiusY = 60 + Math.sin(time * 12) * 12;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, radiusX);
    grad.addColorStop(0, '#ffffff'); // 中心更亮
    grad.addColorStop(0.3, '#ffaa33');
    grad.addColorStop(0.6, '#ff4422');
    grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(64, 64, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    texture.needsUpdate = true;
    requestAnimationFrame(animate);
  }
  animate();
  return sprite;
}

/**
 * 爆裂黎明子弹 - 命中时触发爆裂黎明特效并造成范围伤害
 * 继承自BulletEntity，添加特效触发和范围伤害功能
 */
export class DawnExplosionBulletEntity extends BulletEntity {
  private explosionRadius: number = 10; // 爆炸范围半径
  private fireSprite: THREE.Sprite | null = null; // 火焰精灵特效

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
    
    // 创建火焰精灵特效并添加到场景中
    this.fireSprite = createFireSprite(position, 1.5); // 增大火焰精灵大小
    const scene = EntityManager.getInstance().getScene();
    if (this.fireSprite && scene) {
      scene.add(this.fireSprite);
    }
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
    // 让火焰精灵随子弹移动
    if (this.fireSprite) {
      this.fireSprite.position.copy(this.position);
    }
  }

  public onDestroy(): void {
    super.onDestroy();
    // 清理火焰精灵
    if (this.fireSprite && this.fireSprite.parent) {
      this.fireSprite.parent.remove(this.fireSprite);
    }
  }
}
