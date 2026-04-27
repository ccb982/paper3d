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
  private emitterPosition: { x: number; y: number };
  private emitterAngle: number;
  private emitterRadius: number;
  private colorIndex: number;
  private colorChangeTime: number;
  private colors: number[][];

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
    
    // 初始化释放点位置
    this.emitterPosition = { x: 256, y: 256 };
    this.emitterAngle = 0;
    this.emitterRadius = 100;
    
    // 初始化颜色系统
    this.colorIndex = 0;
    this.colorChangeTime = 0;
    this.colors = [
      [0.6, 0.3, 0.9], // 紫色
      [0.9, 0.6, 0.3], // 橙色
      [0.3, 0.9, 0.6], // 青色
      [0.9, 0.3, 0.6], // 粉色
      [0.6, 0.9, 0.3]  // 绿色
    ];
    
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
    // 更新释放点位置（圆形路径）
    this.emitterAngle += delta * 2; // 旋转速度
    this.emitterPosition.x = 256 + Math.cos(this.emitterAngle) * this.emitterRadius;
    this.emitterPosition.y = 256 + Math.sin(this.emitterAngle) * this.emitterRadius;
    
    // 定时变色
    this.colorChangeTime += delta;
    if (this.colorChangeTime >= 2) { // 每2秒变色一次
      this.colorChangeTime = 0;
      this.colorIndex = (this.colorIndex + 1) % this.colors.length;
    }
    
    // 获取当前颜色
    const currentColor = this.colors[this.colorIndex];
    
    // 持续释放染料
    this.fluidDynamics.setDye(this.emitterPosition.x, this.emitterPosition.y, 0, 10, 10, currentColor);
    
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