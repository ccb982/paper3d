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
    
    // 创建尾气特效（前端附着在子弹上，后端独立）
    this.createTrailEffect();
    // 修改子弹材质，添加前端尾气效果
    this.modifyBulletMaterial();
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

  private modifyBulletMaterial(): void {
    const textureManager = new TextureManager();
    
    // 创建尾气纹理用于子弹前端
    createBulletTrailTexture(textureManager);
    const trailTexture = textureManager.getTexture('bullet-trail');
    
    if (!trailTexture) return;
    
    // 创建新的子弹材质，添加尾气纹理作为前端效果
    const bulletMaterial = new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: new THREE.Color(this.mesh.material instanceof THREE.MeshStandardMaterial ? this.mesh.material.color : 0xdd5b42) },
        trailTexture: { value: trailTexture },
        time: { value: 0 },
        speed: { value: this.velocity.length() }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          vUv = uv;
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 baseColor;
        uniform sampler2D trailTexture;
        uniform float time;
        uniform float speed;
        
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          // 基础颜色
          vec3 color = baseColor;
          
          // 计算纹理坐标，使用尾气纹理的前30%部分
          // 将子弹表面的Z位置映射到纹理的前30%
          float trailLength = 0.3; // 只使用尾气纹理的前30%
          float zNormalized = (vPosition.z + 0.3) / 0.6; // 归一化Z位置到0-1范围（覆盖整个子弹）
          float textureY = zNormalized * trailLength; // 映射到纹理的前30%
          
          // 添加时间偏移，使纹理流动
          float timeOffset = mod(time * speed * 0.1, trailLength);
          float trailUvY = textureY + timeOffset;
          
          // 确保纹理坐标在0-1范围内
          trailUvY = mod(trailUvY, 1.0);
          
          vec2 trailUv = vec2(vUv.x, trailUvY);
          vec4 trailColor = texture2D(trailTexture, trailUv);
          
          // 混合基础颜色和尾气纹理
          float alpha = trailColor.a * 0.8;
          color = mix(color, trailColor.rgb, alpha);
          
          // 为子弹前端5%的部分添加发光效果
          if (zNormalized > 0.95) {
            float glowIntensity = (zNormalized - 0.95) * 20.0; // 从0到1的强度
            vec3 glowColor = vec3(0.8, 0.6, 0.8); // 粉色发光（降低亮度）
            color = mix(color, glowColor, glowIntensity * 0.5);
          }
          
          // 为子弹末端添加红色过渡效果
          if (zNormalized < 0.3) {
            float endIntensity = 1.0 - (zNormalized / 0.3); // 从0到1的强度
            vec3 endColor = vec3(1.0, 0.0, 0.21); // #fe0036 红色
            color = mix(color, endColor, endIntensity * 0.8);
          }
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true
    });
    
    // 替换子弹材质
    this.mesh.material = bulletMaterial;
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
    
    // 增大尾气大小（缩放为原来的3倍）
    this.trailMesh.scale.set(3, 3, 3);
    
    // 添加到场景
    const scene = EntityManager.getInstance().getScene();
    if (scene) {
      scene.add(this.trailMesh);
    }
    
    // 初始化尾气位置和朝向
    const flightDir = this.velocity.clone().normalize();
    const distance = 8.5;
    this.trailMesh.position.copy(this.position.clone().add(flightDir.clone().multiplyScalar(-distance)));
    this.trailMesh.quaternion.copy(this.mesh.quaternion);
  }

  public update(delta: number): void {
    super.update(delta); // 更新子弹位置、朝向等（父类已处理好子弹的位置和速度）

    // 更新尾气时间
    this.trailTime += delta;

    // 更新子弹前端尾气纹理动画
    if (this.mesh.material instanceof THREE.ShaderMaterial) {
      this.mesh.material.uniforms.time.value = this.trailTime;
    }

    if (this.trailMesh && this.trailMaterial) {
      const flightDir = this.velocity.clone().normalize();
      
      // ===== 强制尾气位置：放在子弹后方固定距离 =====
            // 注意：这里不使用子弹尾部，而是直接沿着速度反方向偏移一个较大数值，确保尾气明显在后
            const distance = 8.5; // 尾气与子弹中心的距离（单位），可根据视觉效果调整
            const trailPos = this.position.clone().add(flightDir.clone().multiplyScalar(-distance));
            this.trailMesh.position.copy(trailPos);
      
      // ===== 强制尾气朝向：让尾气的 +Z 指向速度反方向 =====
      // 这样尾气的头部（+Z）会指向后方，尾部（-Z）指向前方？不，因为头部在+Z，所以指向后方意味着尾部在子弹方向，需要确认。
      // 实际上我们希望尾气的尾部（宽端）指向后方。由于你的尾气头部在+Z（窄端），尾部在-Z（宽端），要让尾部指向后方，应该让 -Z 指向后方，即 +Z 指向前方。
      // 更简单：假设你希望尾气像火焰一样“喷”向后方，通常尾气的根部（附着点）在子弹尾部，然后向后扩散。那么尾气应该指向后方，即尾气的头部（窄端）指向后方，尾部（宽端）指向前方？这会产生奇怪效果。
      // 根据你的描述“让尾气尾部指向后方”，而你的几何体尾部在 Z=0，头部在 Z=1。为了让尾部指向后方，需要让几何体的 -Z 指向后方，即 +Z 指向前方。因此尾气的朝向应该和子弹相同（+Z 指向速度方向）。
      // 我们采用最简单的方案：让尾气朝向与子弹相同，然后让尾气位置向后偏移足够多，使得尾部自然出现在后方。
      this.trailMesh.quaternion.copy(this.mesh.quaternion);
      
      // 更新着色器时间
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
