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
  private totalElapsedTime: number;
  private colors: number[][];
  private emitterColor: number[];
  private initialExhaustColor: number[];
  private colorChangeInterval: number;
  private initialColorDuration: number;

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
      simScale: 0.6,
      dyeScale: 0.8,
      curl: 2.5,
      velocityDissipation: 0.05,
      dyeDissipation: 0.05,
      pressureIterations: 20
    });
    
    // 初始化释放点位置
    this.emitterPosition = { x: 256, y: 256 };
    this.emitterAngle = 0;
    this.emitterRadius = 100;
    
    // 初始化颜色系统
    this.totalElapsedTime = 0;
    this.colorChangeInterval = 1.5; // 颜色变化间隔（更频繁）
    this.initialColorDuration = 2; // 初始颜色持续时间（更短）
    this.emitterColor = [1.0, 1.0, 1.0]; // 释放点固定为白色
    this.initialExhaustColor = [0.0, 0.0, 1.0]; // 初始尾气颜色（纯蓝色）
    this.colors = [
      [1.0, 0.0, 1.0], // 紫色
      [1.0, 0.5, 0.0], // 橙色
      [0.0, 1.0, 1.0], // 青色
      [1.0, 0.0, 0.5], // 粉色
      [0.5, 1.0, 0.0]  // 绿色
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
    // 更新总时间
    this.totalElapsedTime += delta;
    
    // 更新释放点位置（圆形路径）
    this.emitterAngle += delta * 2; // 旋转速度
    this.emitterPosition.x = 256 + Math.cos(this.emitterAngle) * this.emitterRadius;
    this.emitterPosition.y = 256 + Math.sin(this.emitterAngle) * this.emitterRadius;
    
    // 释放点使用固定颜色（白色）
    this.fluidDynamics.setDye(this.emitterPosition.x, this.emitterPosition.y, 0, 5, 5, this.emitterColor);
    
    // 释放尾气，初始颜色都是蓝色（增加浓度）
    this.fluidDynamics.setDye(this.emitterPosition.x, this.emitterPosition.y, 0, 20, 20, this.initialExhaustColor);
    
    // 计算当前颜色阶段（基于总时间）
    let currentColor = this.initialExhaustColor;
    
    if (this.totalElapsedTime > this.initialColorDuration) {
      // 计算已经过了多少个颜色变化周期
      const elapsedAfterInitial = this.totalElapsedTime - this.initialColorDuration;
      const colorIndex = Math.floor(elapsedAfterInitial / this.colorChangeInterval) % this.colors.length;
      currentColor = this.colors[colorIndex];
    }
    
    // 在释放点周围添加当前阶段的颜色，模拟尾气变色
    // 这样新释放的尾气是蓝色，而周围的尾气会逐渐变成当前颜色
    if (this.totalElapsedTime > this.initialColorDuration) {
      // 在不同距离添加不同强度的颜色
      for (let distance = 15; distance <= 100; distance += 15) {
        const offsetAngle = this.emitterAngle + Math.PI; // 向后释放
        const offsetX = this.emitterPosition.x + Math.cos(offsetAngle) * distance;
        const offsetY = this.emitterPosition.y + Math.sin(offsetAngle) * distance;
        
        // 距离越远，颜色强度越高，范围越大
        const intensity = Math.min(1, distance / 60);
        const size = 15 + distance / 5;
        const color = [
          currentColor[0] * intensity,
          currentColor[1] * intensity,
          currentColor[2] * intensity
        ];
        
        this.fluidDynamics.setDye(offsetX, offsetY, 0, size, size, color);
      }
    }
    
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