import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { CameraStore } from '../core/CameraStore';
import { TextureManager } from '../systems/textures/TextureManager';

export class BulletFluidEffect extends BaseEffect {
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor(position: THREE.Vector3, duration: number = 30.0, size: number = 8.0) {
    super(duration);
    
    // 初始化纹理管理器
    TextureManager.getInstance().initialize();
    
    // 获取子弹流体纹理
    const texture = TextureManager.getInstance().getTexture('bulletFluid');
    
    // 创建材质
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.8
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
    // 更新纹理生成器
    TextureManager.getInstance().update('bulletFluid', delta);
    
    // 让流体平面始终面向相机
    const camera = CameraStore.getInstance().getCamera();
    if (camera) {
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
    
    // 释放纹理引用
    TextureManager.getInstance().release('bulletFluid');
  }
}