import * as THREE from 'three';
import { BaseEffect } from '../core/BaseEffect';
import { EntityManager } from '../core/EntityManager';

/**
 * 命中闪光特效 - 纯色圆环快速缩放
 */
export class HitFlashEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, size: number = 0.5, duration: number = 0.2, color: number = 0xffaa44) {
    super(duration);
    const geometry = new THREE.RingGeometry(size * 0.3, size, 16);
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    EntityManager.getInstance().getScene()?.add(this.mesh);
  }

  protected onUpdate(delta: number): void {
    const progress = this.elapsed / this.duration; // 0 → 1
    const scale = 1 + progress * 2;               // 逐渐放大
    this.mesh.scale.set(scale, scale, 1);
    this.material.opacity = 1 - progress;         // 淡出
  }

  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
