import * as THREE from 'three';
import { BaseEffect } from '../core/BaseEffect';
import { EntityManager } from '../core/EntityManager';

interface Particle {
  velocity: THREE.Vector3;
  life: number;
}

/**
 * 爆炸特效 - 粒子系统
 */
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
    EntityManager.getInstance().getScene()?.add(this.points);
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
    this.points.parent?.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
