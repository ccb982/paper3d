import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { CameraStore } from '../core/CameraStore';
import { createFirePlane } from './FirePlane';

export class FireEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(position: THREE.Vector3, duration: number = 2.0, width: number = 2.0, height: number = 3.0) {
    super(duration);
    // 尾焰颜色数组，包含三种颜色
    const fireColors = [
      0x523250, // #523250
      0x1d3054, // #1d3054
      0x272624  // #272624
    ];
    // 使用时间戳作为随机种子，确保每次创建都能获得不同的颜色
    const seed = Date.now() + Math.random() * 1000;
    const randomIndex = Math.floor((seed % fireColors.length));
    const randomColorHex = fireColors[randomIndex];
    const randomColor = new THREE.Color(randomColorHex);
    console.log('FireEffect color hex:', randomColorHex, 'index:', randomIndex); // 调试日志
    this.mesh = createFirePlane(width, height, 24, position, randomColor, randomColor); // 随机尾焰颜色
    const scene = EntityManager.getInstance().getScene();
    if (scene) scene.add(this.mesh);
    this.material = this.mesh.material as THREE.ShaderMaterial;
  }

  protected onUpdate(delta: number): void {
    this.material.uniforms.uTime.value = this.elapsed;
    // 让火焰平面始终面向相机
    const camera = CameraStore.getInstance().getCamera();
    if (camera) {
      this.mesh.lookAt(camera.position);
    }
    // 随时间逐渐缩小，但保持不透明度100%
    const t = this.elapsed / this.duration;
    const scale = 1 - t * 0.5;
    this.mesh.scale.set(scale, scale, 1);
    // 保持不透明度100%
    this.material.opacity = 1.0;
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
