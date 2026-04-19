import * as THREE from 'three';

/**
 * 相机存储 - 用于在不同组件间共享相机引用
 */
export class CameraStore {
  private static instance: CameraStore;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;

  private constructor() {}

  public static getInstance(): CameraStore {
    if (!CameraStore.instance) {
      CameraStore.instance = new CameraStore();
    }
    return CameraStore.instance;
  }

  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  public getCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }

  public getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }
}

export const cameraStore = CameraStore.getInstance();