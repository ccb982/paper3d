import * as THREE from 'three';
import { BaseEffect } from '../core/BaseEffect';
import { EntityManager } from '../core/EntityManager';

/**
 * 枪口闪光特效 - 放射状线条
 */
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
    EntityManager.getInstance().getScene()?.add(this.group);
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
    this.group.parent?.remove(this.group);
    this.rays.forEach(ray => {
      ray.geometry.dispose();
      (ray.material as THREE.Material).dispose();
    });
  }
}
