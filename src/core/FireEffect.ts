import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';

class FireParticle {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public color: THREE.Color;
  public size: number;
  public lifetime: number;
  public maxLifetime: number;

  constructor(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, size: number, lifetime: number) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.color = color.clone();
    this.size = size;
    this.lifetime = lifetime;
    this.maxLifetime = lifetime;
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
    
    // 发射位置：从一个更小的口出来
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 0.1,
      0,
      (Math.random() - 0.5) * 0.1
    );
    
    // 初始速度：向上为主，带有随机偏移，增大随机范围
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      1 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.8
    );
    
    // 初始颜色：橙黄色
    const color = new THREE.Color(
      1.0,
      0.5 + Math.random() * 0.5,
      0.1 + Math.random() * 0.2
    );
    
    // 粒子大小：进一步减小粒子大小，使其只有几个像素大
    const size = 0.01 + Math.random() * 0.02;
    
    // 粒子寿命：延长并增大随机性
    const lifetime = 2.0 + Math.random() * 3.0;
    
    this.particles.push(new FireParticle(position, velocity, color, size, lifetime));
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
      
      // 更新位置
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.position.z += particle.velocity.z * delta;
      
      // 应用物理效果
      // 上升浮力
      particle.velocity.y += 0.8 * delta;
      // 底部向四周扩散的力：底部扩散力大，顶部扩散力小
      const heightFactor = Math.max(0, Math.pow(1 - particle.position.y / 3, 1590)); // 粒子越高，扩散力衰减越快，3为扩散力影响的最大高度
      const expansionStrength = 50000 * heightFactor; // 底部扩散力强度为5，顶部逐渐减小到0
      // 计算粒子到中心的方向向量，用于扩散
      const distance = Math.sqrt(particle.position.x * particle.position.x + particle.position.z * particle.position.z);
      if (distance > 0) {
        // 向四周扩散
        particle.velocity.x += (particle.position.x / distance) * expansionStrength * delta;
        particle.velocity.z += (particle.position.z / distance) * expansionStrength * delta;
      } else {
        // 对于中心的粒子，给予随机的初始扩散方向
        const angle = Math.random() * Math.PI * 2;
        particle.velocity.x += Math.cos(angle) * expansionStrength * delta;
        particle.velocity.z += Math.sin(angle) * expansionStrength * delta;
      }
      // 在一定高度后添加随机小幅度的水平抖动
      const jitterHeightThreshold = 0.3; // 抖动开始的高度阈值
      if (particle.position.y > jitterHeightThreshold) {
        const jitterStrength = 0.5; // 增大抖动强度，使效果更明显
        particle.velocity.x += (Math.random() - 0.5) * jitterStrength;
        particle.velocity.z += (Math.random() - 0.5) * jitterStrength;
      }
      
      // 阻力
      particle.velocity.multiplyScalar(0.97);
      
      // 更新颜色
      const lifeFactor = particle.lifetime / particle.maxLifetime;
      particle.color.r = 1.0;
      particle.color.g = 0.2 + lifeFactor * 0.8;
      particle.color.b = 0.05 + lifeFactor * 0.15;
      
      // 更新大小
      particle.size = 0.1 + lifeFactor * 0.2;
      
      // 更新寿命
      particle.lifetime -= delta;
      
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
