import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { TextureManager } from '../systems/textures/TextureManager';

export class TriangleFluidEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 30.0, size: number = 10.0) {
    super(duration);

    TextureManager.getInstance().initialize();

    const texture = TextureManager.getInstance().getTexture('triangleFluid');

    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      side: THREE.DoubleSide
    });

    const geometry = new THREE.PlaneGeometry(size, size);

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);

    const scene = EntityManager.getInstance().getScene();
    if (scene) scene.add(this.mesh);
  }

  protected onUpdate(delta: number): void {
  }

  public dispose(): void {
    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh.parent) scene.remove(this.mesh);

    this.mesh.geometry.dispose();
    this.material.dispose();

    TextureManager.getInstance().release('triangleFluid');
  }
}