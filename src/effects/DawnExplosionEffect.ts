import * as THREE from 'three';
import { BaseEffect } from '../core/BaseEffect';
import { EntityManager } from '../core/EntityManager';

/**
 * 爆裂黎明特效 - 三层视觉结构
 * 1. 核心光球：明亮的、不断缩小的核心
 * 2. 红蓝冲击波：反向旋转的圆环
 * 3. 扩散粒子：从中心向外飞散的粒子
 */
export class DawnExplosionEffect extends BaseEffect {
  // 核心光球
  private coreMesh: THREE.Mesh;
  private coreMaterial: THREE.MeshBasicMaterial;
  // 冲击波圆环
  private ringRed: THREE.Mesh;
  private ringBlue: THREE.Mesh;
  private ringMaterialRed: THREE.MeshBasicMaterial;
  private ringMaterialBlue: THREE.MeshBasicMaterial;
  // 粒子系统
  private particleSystem: THREE.Points;
  private particleCount: number = 200;
  private particleVelocities: THREE.Vector3[] = [];

  constructor(position: THREE.Vector3, duration: number = 0.8) {
    super(duration);

    // 1. 创建核心光球
    const coreGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true });
    this.coreMesh = new THREE.Mesh(coreGeometry, this.coreMaterial);
    this.coreMesh.position.copy(position);
    EntityManager.getInstance().getScene()?.add(this.coreMesh);

    // 2. 创建冲击波圆环
    const ringGeometry = new THREE.RingGeometry(0.5, 0.8, 32);
    this.ringMaterialRed = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, side: THREE.DoubleSide });
    this.ringMaterialBlue = new THREE.MeshBasicMaterial({ color: 0x4444ff, transparent: true, side: THREE.DoubleSide });
    this.ringRed = new THREE.Mesh(ringGeometry, this.ringMaterialRed);
    this.ringBlue = new THREE.Mesh(ringGeometry, this.ringMaterialBlue);
    this.ringRed.position.copy(position);
    this.ringBlue.position.copy(position);
    // 让两个环交叉旋转
    this.ringRed.rotation.x = Math.PI / 2;
    this.ringBlue.rotation.z = Math.PI / 2;
    EntityManager.getInstance().getScene()?.add(this.ringRed);
    EntityManager.getInstance().getScene()?.add(this.ringBlue);

    // 3. 创建粒子系统
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      // 随机方向
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      // 随机速度（初始位置在原点）
      particlePositions[i*3] = position.x;
      particlePositions[i*3+1] = position.y;
      particlePositions[i*3+2] = position.z;
      this.particleVelocities.push(dir.multiplyScalar(3 + Math.random() * 4));
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0xffaa66, size: 0.08, blending: THREE.AdditiveBlending });
    this.particleSystem = new THREE.Points(particleGeo, particleMaterial);
    EntityManager.getInstance().getScene()?.add(this.particleSystem);
  }

  protected onUpdate(delta: number): void {
    const t = this.elapsed / this.duration; // 进度 0 -> 1

    // 1. 更新核心光球：逐渐缩小并淡出
    const coreScale = 1 - t;
    this.coreMesh.scale.set(coreScale, coreScale, coreScale);
    this.coreMaterial.opacity = 1 - t;

    // 2. 更新冲击波：向外扩散并淡出
    const waveScale = 1 + t * 5;
    this.ringRed.scale.set(waveScale, waveScale, 1);
    this.ringBlue.scale.set(waveScale, waveScale, 1);
    this.ringMaterialRed.opacity = 0.8 * (1 - t);
    this.ringMaterialBlue.opacity = 0.8 * (1 - t);

    // 3. 更新粒子系统：移动并逐渐淡出
    const positionsAttr = this.particleSystem.geometry.attributes.position;
    const positions = positionsAttr.array as Float32Array;
    for (let i = 0; i < this.particleCount; i++) {
      positions[i*3] += this.particleVelocities[i].x * delta;
      positions[i*3+1] += this.particleVelocities[i].y * delta;
      positions[i*3+2] += this.particleVelocities[i].z * delta;
    }
    positionsAttr.needsUpdate = true;
    (this.particleSystem.material as THREE.PointsMaterial).opacity = 1 - t;
  }

  public dispose(): void {
    // 清理资源，防止内存泄漏
    this.coreMesh.parent?.remove(this.coreMesh);
    this.ringRed.parent?.remove(this.ringRed);
    this.ringBlue.parent?.remove(this.ringBlue);
    this.particleSystem.parent?.remove(this.particleSystem);
    this.coreMesh.geometry.dispose();
    this.coreMaterial.dispose();
    this.ringRed.geometry.dispose();
    this.ringMaterialRed.dispose();
    this.ringBlue.geometry.dispose();
    this.ringMaterialBlue.dispose();
    this.particleSystem.geometry.dispose();
    (this.particleSystem.material as THREE.Material).dispose();
  }
}
