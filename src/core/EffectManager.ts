import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';
import { DawnBurstEffect } from './DawnBurstEffect';
import { FireEffect } from './FireEffect';

// 提前声明特效类，避免循环引用
export class HitFlashEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, size: number = 0.5, duration: number = 0.2, color: number = 0xffaa44) {
    super(duration);
    const geometry = new THREE.RingGeometry(size * 0.3, size, 16);
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    this.mesh.lookAt(new THREE.Vector3(0, 0, 0)); // 简单朝向原点
    
    // 获取场景并添加
    const scene = (window as any).gameScene;
    if (scene) {
      scene.add(this.mesh);
    }
  }

  protected onUpdate(delta: number): void {
    const progress = this.elapsed / this.duration; // 0 → 1
    const scale = 1 + progress * 2;               // 逐渐放大
    this.mesh.scale.set(scale, scale, 1);
    this.material.opacity = 1 - progress;         // 淡出
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.mesh.parent) {
      scene.remove(this.mesh);
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export class MuzzleFlashEffect extends BaseEffect {
  private group: THREE.Group;
  private rays: THREE.Mesh[] = [];

  constructor(position: THREE.Vector3, duration: number = 0.1, color: number = 0xffaa66) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    
    // 创建 8 条放射状射线
    const rayCount = 8;
    const length = 0.3;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const geometry = new THREE.BoxGeometry(0.05, length, 0.05);
      const material = new THREE.MeshStandardMaterial({ 
        color, 
        emissive: color, 
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 1
      });
      const ray = new THREE.Mesh(geometry, material);
      ray.position.set(Math.cos(angle) * length * 0.5, Math.sin(angle) * length * 0.5, 0);
      ray.rotation.z = angle;
      this.group.add(ray);
      this.rays.push(ray);
    }
    
    const scene = (window as any).gameScene;
    if (scene) {
      scene.add(this.group);
    }
  }

  protected onUpdate(delta: number): void {
    const progress = this.elapsed / this.duration;
    const scale = 1 - progress; // 快速缩小
    this.group.scale.set(scale, scale, 1);
    
    // 透明度控制
    this.rays.forEach(ray => {
      (ray.material as THREE.MeshStandardMaterial).opacity = 1 - progress;
    });
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.group.parent) {
      scene.remove(this.group);
    }
    this.rays.forEach(ray => {
      ray.geometry.dispose();
      (ray.material as THREE.Material).dispose();
    });
  }
}

interface Particle {
  velocity: THREE.Vector3;
  life: number;
}

export class ExplosionEffect extends BaseEffect {
  private points: THREE.Points;
  private particleCount: number = 60;
  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;

  constructor(position: THREE.Vector3, duration: number = 0.8, color: number = 0xff6600) {
    super(duration);
    
    // 创建粒子位置数组
    const positions = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      positions[i*3] = position.x;
      positions[i*3+1] = position.y;
      positions[i*3+2] = position.z;
      
      // 随机速度方向
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4
      );
      this.particles.push({ velocity: vel, life: 1 });
    }
    
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({ 
      color, 
      size: 0.08, 
      transparent: true, 
      blending: THREE.AdditiveBlending 
    });
    this.points = new THREE.Points(this.geometry, this.material);
    
    const scene = (window as any).gameScene;
    if (scene) {
      scene.add(this.points);
    }
  }

  protected onUpdate(delta: number): void {
    const positionsAttr = this.geometry.attributes.position;
    const positions = positionsAttr.array as Float32Array;
    let allDead = true;
    
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particles[i].life <= 0) continue;
      allDead = false;
      
      // 更新位置
      positions[i*3] += this.particles[i].velocity.x * delta;
      positions[i*3+1] += this.particles[i].velocity.y * delta;
      positions[i*3+2] += this.particles[i].velocity.z * delta;
      
      // 减少生命并减速
      this.particles[i].life -= delta * 1.5;
      this.particles[i].velocity.y -= delta * 3; // 重力
    }
    
    positionsAttr.needsUpdate = true;
    this.material.opacity = 1 - (this.elapsed / this.duration);
    
    if (allDead) this.isActive = false;
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.points.parent) {
      scene.remove(this.points);
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class RingWaveEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 0.5, color: number = 0x33aaff) {
    super(duration);
    const geometry = new THREE.RingGeometry(0.1, 0.3, 32);
    this.material = new THREE.MeshBasicMaterial({ 
      color, 
      transparent: true, 
      opacity: 0.8, 
      side: THREE.DoubleSide 
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    
    const scene = (window as any).gameScene;
    if (scene) {
      scene.add(this.mesh);
    }
  }

  protected onUpdate(delta: number): void {
    const t = this.elapsed / this.duration; // 0→1
    const scale = 1 + t * 3;
    this.mesh.scale.set(scale, scale, 1);
    this.material.opacity = 0.8 * (1 - t);
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.mesh.parent) {
      scene.remove(this.mesh);
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export class EffectManager {
  private static instance: EffectManager;
  private activeEffects: BaseEffect[] = [];

  private constructor() {}

  public static getInstance(): EffectManager {
    if (!EffectManager.instance) EffectManager.instance = new EffectManager();
    return EffectManager.instance;
  }

  public playHitFlash(position: THREE.Vector3, color?: number): void {
    this.activeEffects.push(new HitFlashEffect(position, 0.5, 0.2, color || 0xffaa44));
  }

  public playMuzzleFlash(position: THREE.Vector3): void {
    this.activeEffects.push(new MuzzleFlashEffect(position, 0.1));
  }

  public playExplosion(position: THREE.Vector3): void {
    this.activeEffects.push(new ExplosionEffect(position, 0.8));
  }

  public playRingWave(position: THREE.Vector3, color?: number): void {
    this.activeEffects.push(new RingWaveEffect(position, 0.5, color || 0x33aaff));
  }

  public playDawnBurst(position: THREE.Vector3, color?: number): void {
    this.activeEffects.push(new DawnBurstEffect(position, 4.0, color || 0xff6600));
  }

  public playFireEffect(position: THREE.Vector3, duration?: number): void {
    this.activeEffects.push(new FireEffect(position, duration === undefined ? Infinity : duration));
  }

  public update(delta: number): void {
    for (let i = this.activeEffects.length-1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.update(delta);
      if (!effect.isActive) {
        effect.dispose();
        this.activeEffects.splice(i, 1);
      }
    }
  }
}