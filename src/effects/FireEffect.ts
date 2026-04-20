import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { createFirePlane } from './FirePlane';

export class FireEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(position: THREE.Vector3, duration: number = 2.0, width: number = 0.8, height: number = 1.2) {
    super(duration);
    this.mesh = createFirePlane(width, height, 24, position, new THREE.Color(0xff4422), new THREE.Color(0xffaa66));
    const scene = EntityManager.getInstance().getScene();
    if (scene) scene.add(this.mesh);
    this.material = this.mesh.material as THREE.ShaderMaterial;
  }

  protected onUpdate(delta: number): void {
    this.material.uniforms.uTime.value = this.elapsed;
    // 随时间逐渐缩小并淡出（可选）
    const t = this.elapsed / this.duration;
    const scale = 1 - t * 0.5;
    this.mesh.scale.set(scale, scale, 1);
    this.material.opacity = 1 - t;
    if (this.elapsed >= this.duration) {
      this.isActive = false;
    }
  }

  public dispose(): void {
    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh.parent) scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
