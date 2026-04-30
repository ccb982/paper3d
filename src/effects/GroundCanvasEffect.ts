import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { TextureManager } from '../systems/textures/TextureManager';

export class GroundCanvasEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 30.0, width: number = 20.0, height: number = 20.0) {
    super(duration);

    TextureManager.getInstance().initialize();

    const texture = TextureManager.getInstance().getTexture('bulletFluid');

    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
      side: THREE.DoubleSide
    });

    const geometry = new THREE.PlaneGeometry(width, height);

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    this.mesh.rotation.x = -Math.PI / 2;

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

    TextureManager.getInstance().release('bulletFluid');
  }
}