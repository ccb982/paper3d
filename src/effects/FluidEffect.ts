import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { CameraStore } from '../core/CameraStore';
import { FluidDynamics } from '@bienehito/fluid-dynamics';

export class FluidEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private fluidDynamics: FluidDynamics;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 10.0, size: number = 5.0) {
    super(duration);
    
    // 创建 canvas 元素
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    
    // 创建 FluidDynamics 实例
    this.fluidDynamics = new FluidDynamics(this.canvas, {
      width: 512,
      height: 512,
      simScale: 0.5,
      dyeScale: 0.5,
      curl: 3,
      velocityDissipation: 0.1,
      dyeDissipation: 0.1,
      pressureIterations: 20
    });
    
    // 添加一些初始染料
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const color = [
        0.5 + Math.random() * 0.5, // 红色
        0.2 + Math.random() * 0.3, // 绿色
        0.8 + Math.random() * 0.2  // 蓝色
      ];
      this.fluidDynamics.setDye(x, y, 0, 50, 50, color);
    }
    
    // 创建 canvas 纹理
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.needsUpdate = true;
    
    // 创建材质
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    
    // 创建平面几何体
    const geometry = new THREE.PlaneGeometry(size, size);
    
    // 创建网格
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    this.mesh.rotation.x = -Math.PI / 2; // 平放在地面上
    
    // 添加到场景
    const scene = EntityManager.getInstance().getScene();
    if (scene) scene.add(this.mesh);
  }

  protected onUpdate(delta: number): void {
    // 添加随机力来扰动流体
    if (Math.random() < 0.1) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const angle = Math.random() * Math.PI * 2;
      const force = 100 + Math.random() * 200;
      const dx = Math.cos(angle) * force;
      const dy = Math.sin(angle) * force;
      this.fluidDynamics.setVelocity(x, y, 0, 30, 30, dx, dy);
    }
    
    // 更新纹理
    this.texture.needsUpdate = true;
    
    // 让流体平面始终面向相机
    const camera = CameraStore.getInstance().getCamera();
    if (camera) {
      // 保持平面水平，只调整旋转
      const lookAt = new THREE.Vector3(camera.position.x, this.mesh.position.y, camera.position.z);
      this.mesh.lookAt(lookAt);
    }
  }

  public dispose(): void {
    const scene = EntityManager.getInstance().getScene();
    if (scene && this.mesh.parent) scene.remove(this.mesh);
    
    // 清理资源
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    
    // 移除 canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}