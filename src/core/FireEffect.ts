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
      size: 0.5,
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
    
    // 发射位置：在中心点周围随机
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      0,
      (Math.random() - 0.5) * 0.5
    );
    
    // 初始速度：向上为主，带有随机偏移
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      1 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5
    );
    
    // 初始颜色：橙黄色
    const color = new THREE.Color(
      1.0,
      0.5 + Math.random() * 0.5,
      0.1 + Math.random() * 0.2
    );
    
    // 粒子大小
    const size = 0.1 + Math.random() * 0.2;
    
    // 粒子寿命
    const lifetime = 1.0 + Math.random() * 1.0;
    
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
      particle.velocity.y += 0.5 * delta;
      // 湍流
      particle.velocity.x += (Math.random() - 0.5) * 0.1 * delta;
      particle.velocity.z += (Math.random() - 0.5) * 0.1 * delta;
      // 阻力
      particle.velocity.multiplyScalar(0.98);
      
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
