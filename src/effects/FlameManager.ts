import * as THREE from 'three';
import { ParticleFireEffect } from './ParticleFireEffect';

/**
 * 火焰管理器 - 使用单例模式管理火焰效果
 * 确保只创建一个火焰实例，但可以在多个位置使用
 */
export class FlameManager {
  private static instance: FlameManager;
  private flameEffect: ParticleFireEffect | null = null;
  private flamePositions: THREE.Vector3[] = [];
  private isInitialized = false;

  /**
   * 获取单例实例
   */
  public static getInstance(): FlameManager {
    if (!FlameManager.instance) {
      FlameManager.instance = new FlameManager();
    }
    return FlameManager.instance;
  }

  /**
   * 初始化火焰管理器
   * @param scene THREE.Scene实例
   * @param camera THREE.Camera实例
   */
  public initialize(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.isInitialized) {
      // 创建唯一的火焰实例
      this.flameEffect = new ParticleFireEffect(0, 0, 0, 1.0);
      this.flameEffect.setCamera(camera);
      
      // 将火焰效果添加到场景中
      if (this.flameEffect.group) {
        scene.add(this.flameEffect.group);
      }
      
      this.isInitialized = true;
    }
  }

  /**
   * 添加火焰位置
   * @param position 火焰位置
   * @returns 位置索引，用于后续更新或移除
   */
  public addFlamePosition(position: THREE.Vector3): number {
    this.flamePositions.push(position);
    return this.flamePositions.length - 1;
  }

  /**
   * 更新火焰位置
   * @param index 位置索引
   * @param position 新的火焰位置
   */
  public updateFlamePosition(index: number, position: THREE.Vector3): void {
    if (index >= 0 && index < this.flamePositions.length) {
      this.flamePositions[index] = position;
    }
  }

  /**
   * 移除火焰位置
   * @param index 位置索引
   */
  public removeFlamePosition(index: number): void {
    if (index >= 0 && index < this.flamePositions.length) {
      this.flamePositions.splice(index, 1);
    }
  }

  private flameInstances: { position: THREE.Vector3; mesh: THREE.Mesh }[] = [];

  /**
   * 更新火焰效果
   * 只更新一个火焰实例，但在所有位置渲染
   */
  public update(): void {
    if (this.isInitialized && this.flameEffect) {
      // 更新火焰实例
      this.flameEffect.update();
      
      // 确保火焰实例的可见性
      if (this.flameEffect.group) {
        this.flameEffect.group.visible = false; // 主实例不可见，只用于计算
      }
      
      // 更新或创建火焰实例的副本
      this.updateFlameInstances();
    }
  }

  /**
   * 更新火焰实例的副本
   */
  private updateFlameInstances(): void {
    if (!this.flameEffect) return;
    
    // 清理多余的实例
    while (this.flameInstances.length > this.flamePositions.length) {
      const instance = this.flameInstances.pop();
      if (instance && instance.mesh.parent) {
        instance.mesh.parent.remove(instance.mesh);
        instance.mesh.geometry.dispose();
        if (instance.mesh.material) {
          instance.mesh.material.dispose();
        }
      }
    }
    
    // 创建或更新实例
    for (let i = 0; i < this.flamePositions.length; i++) {
      const position = this.flamePositions[i];
      
      if (i < this.flameInstances.length) {
        // 更新现有实例
        const instance = this.flameInstances[i];
        instance.position = position;
        instance.mesh.position.copy(position);
      } else {
        // 创建新实例
        if (this.flameEffect.group) {
          // 克隆火焰效果的网格
          const mesh = this.flameEffect.group.clone(true);
          mesh.position.copy(position);
          
          // 添加到场景
          if (this.flameEffect.group.parent) {
            this.flameEffect.group.parent.add(mesh);
          }
          
          this.flameInstances.push({ position, mesh });
        }
      }
    }
  }

  /**
   * 清理火焰管理器
   */
  public dispose(): void {
    // 清理所有火焰实例副本
    for (const instance of this.flameInstances) {
      if (instance.mesh.parent) {
        instance.mesh.parent.remove(instance.mesh);
      }
      instance.mesh.geometry.dispose();
      if (instance.mesh.material) {
        instance.mesh.material.dispose();
      }
    }
    this.flameInstances = [];
    
    // 清理主火焰实例
    if (this.flameEffect) {
      this.flameEffect.dispose();
      this.flameEffect = null;
    }
    
    this.flamePositions = [];
    this.isInitialized = false;
  }

  /**
   * 获取火焰实例
   * @returns 火焰实例
   */
  public getFlameEffect(): ParticleFireEffect | null {
    return this.flameEffect;
  }

  /**
   * 获取所有火焰位置
   * @returns 火焰位置数组
   */
  public getFlamePositions(): THREE.Vector3[] {
    return this.flamePositions;
  }
}

// 导出单例实例
export const flameManager = FlameManager.getInstance();
