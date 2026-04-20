import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';

class FireParticle {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public color: THREE.Color;
  public size: number;
  public lifetime: number;
  public maxLifetime: number;
  public seed: number; // 随机种子，用于湍流相位

  constructor(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, size: number, lifetime: number, seed: number) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.color = color.clone();
    this.size = size;
    this.lifetime = lifetime;
    this.maxLifetime = lifetime;
    this.seed = seed;
  }
}

export class FireEffect extends BaseEffect {
  private group: THREE.Group;
  private particles: FireParticle[] = [];
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private maxParticles: number = 1000;
  private emitRate: number = 50;
  private emitAccumulator: number = 0;
  private elapsed: number = 0;

  constructor(position: THREE.Vector3, duration: number = Infinity) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    
    // 初始化几何体和材质
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    
    this.material = new THREE.PointsMaterial({
      size: 1.0,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    
    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
    
    const scene = (window as any).gameScene;
    if (scene) scene.add(this.group);
  }

  private emitParticle() {
    if (this.particles.length >= this.maxParticles) return;
    
    // 发射位置：增大半径，让火焰根部变宽
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      0,
      (Math.random() - 0.5) * 0.8
    );
    
    // 初始速度：从整个半球发射，而不是竖直向上
    // 生成半球范围内的随机方向
    const phi = Math.random() * Math.PI * 2; // 方位角 0-360度
    const theta = Math.random() * Math.PI / 2; // 极角 0-90度（上半球）
    const speed = 1.2 + Math.random() * 0.4; // 速度大小
    
    const velocity = new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi) * speed,
      Math.cos(theta) * speed, // y方向始终向上
      Math.sin(theta) * Math.sin(phi) * speed
    );
    
    // 存储随机种子用于湍流相位
    const seed = Math.random();
    
    // 初始颜色：白热
    const color = new THREE.Color(1.0, 0.9, 0.6);
    
    // 粒子大小
    const size = 0.08;
    
    // 粒子寿命：1.0 ~ 1.8 秒
    const lifetime = 1.0 + Math.random() * 0.8;
    
    this.particles.push(new FireParticle(position, velocity, color, size, lifetime, seed));
  }

  protected onUpdate(delta: number): void {
    this.elapsed += delta;
    
    // 发射粒子
    this.emitAccumulator += delta * this.emitRate;
    while (this.emitAccumulator >= 1.0) {
      this.emitParticle();
      this.emitAccumulator -= 1.0;
    }
    
    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      const lifeFactor = particle.lifetime / particle.maxLifetime; // 1 → 0
      const height = particle.position.y;

      // 1. 上升浮力：随高度递减，模拟热空气上升后冷却
      let upwardForce = 1.2 * (1 - height / 3.0);
      if (upwardForce < 0.2) upwardForce = 0.2;
      particle.velocity.y += upwardForce * delta;

      // 2. 水平扩散：底部强，随高度衰减
      let spreadStrength = 1.2 * Math.max(0, 1 - height / 2.0);
      // 生命后期也略微增加扩散，模拟火焰消散
      spreadStrength += 0.3 * (1 - lifeFactor);

      // 随机方向
      const angle = Math.random() * Math.PI * 2;
      particle.velocity.x += Math.cos(angle) * spreadStrength * delta;
      particle.velocity.z += Math.sin(angle) * spreadStrength * delta;

      // 3. 湍流：让火焰摇曳（使用正弦波 + 随机相位）
      const time = performance.now() * 0.001;
      const phase = particle.seed * 100;
      const turbX = Math.sin(time * 3.0 + phase) * 1.2;
      const turbZ = Math.cos(time * 2.3 + phase) * 1.2;
      particle.velocity.x += turbX * delta;
      particle.velocity.z += turbZ * delta;

      // 3.5 顶部收缩力：让火焰顶部收窄
      const radius = Math.hypot(particle.position.x, particle.position.z);
      if (height > 1.0 && radius > 0.1) {
        const inwardStrength = 0.5 * (height - 1.0);
        particle.velocity.x -= (particle.position.x / radius) * inwardStrength * delta;
        particle.velocity.z -= (particle.position.z / radius) * inwardStrength * delta;
      }

      // 4. 阻力：使速度不会过快
      particle.velocity.multiplyScalar(0.99); // 增大阻力，使火焰更高更飘

      // 5. 位置更新
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.position.z += particle.velocity.z * delta;

      // 6. 寿命减少
      particle.lifetime -= delta;

      // 7. 颜色与大小随生命期变化（更真实的火焰颜色）
      if (lifeFactor > 0.7) {
        // 根部：白热
        particle.color.setRGB(1.0, 0.9, 0.6);
        particle.size = 0.08;
      } else if (lifeFactor > 0.3) {
        // 中部：橙黄
        const t = (lifeFactor - 0.3) / 0.4;
        particle.color.setRGB(1.0, 0.6 + t * 0.3, 0.1 + t * 0.2);
        particle.size = 0.1;
      } else {
        // 顶部：暗红，逐渐透明
        const t = lifeFactor / 0.3;
        particle.color.setRGB(0.8, 0.2, 0.05);
        particle.size = 0.06;
      }

      // 移除死亡粒子
      if (particle.lifetime <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // 更新几何体
    this.updateGeometry();
    
    // 移除时间检查，使特效持续无限时间
    // if (this.elapsed >= this.duration) {
    //   this.isActive = false;
    // }
  }

  private updateGeometry() {
    // 清空数组
    this.positions.fill(0);
    this.colors.fill(0);
    this.sizes.fill(0);
    
    // 填充粒子数据
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const index = i * 3;
      
      this.positions[index] = particle.position.x;
      this.positions[index + 1] = particle.position.y;
      this.positions[index + 2] = particle.position.z;
      
      this.colors[index] = particle.color.r;
      this.colors[index + 1] = particle.color.g;
      this.colors[index + 2] = particle.color.b;
      
      this.sizes[i] = particle.size;
    }
    
    // 标记需要更新
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.group.parent) scene.remove(this.group);
    
    this.geometry.dispose();
    this.material.dispose();
  }
}
