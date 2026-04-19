import * as THREE from 'three';
import { BaseEffect } from '../core/BaseEffect';
import { EntityManager } from '../core/EntityManager';

/**
 * 环形波特效 - 扩散圆环
 */
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
    EntityManager.getInstance().getScene()?.add(this.mesh);
  }

  protected onUpdate(_delta: number): void {
    const t = this.elapsed / this.duration; // 0→1
    const scale = 1 + t * 3;
    this.mesh.scale.set(scale, scale, 1);
    this.material.opacity = 0.8 * (1 - t);
  }

  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
