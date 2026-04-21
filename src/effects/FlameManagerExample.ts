import * as THREE from 'three';
import { flameManager } from './FlameManager';

/**
 * 火焰管理器使用示例
 */
export class FlameManagerExample {
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    
    // 初始化火焰管理器
    flameManager.initialize(scene, camera);
  }

  /**
   * 添加火焰效果
   * @param position 火焰位置
   * @returns 火焰位置索引
   */
  public addFlame(position: THREE.Vector3): number {
    return flameManager.addFlamePosition(position);
  }

  /**
   * 更新火焰效果
   */
  public update(): void {
    // 只调用一次update，所有火焰位置都会使用同一个火焰实例
    flameManager.update();
  }

  /**
   * 清理资源
   */
  public dispose(): void {
    flameManager.dispose();
  }
}

/**
 * 快速使用火焰效果的函数
 * @param scene THREE.Scene实例
 * @param camera THREE.Camera实例
 * @param position 火焰位置
 * @returns 火焰位置索引
 */
export function createFlame(
  scene: THREE.Scene, 
  camera: THREE.Camera, 
  position: THREE.Vector3
): number {
  // 确保火焰管理器已初始化
  flameManager.initialize(scene, camera);
  
  // 添加火焰位置
  return flameManager.addFlamePosition(position);
}

/**
 * 更新所有火焰效果
 */
export function updateFlames(): void {
  flameManager.update();
}

/**
 * 清理所有火焰效果
 */
export function disposeFlames(): void {
  flameManager.dispose();
}
