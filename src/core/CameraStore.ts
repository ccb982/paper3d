import * as THREE from 'three';

class CameraStore {
  private static instance: CameraStore;
  private camera: THREE.PerspectiveCamera | null = null;

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

  public getCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }
}

export const cameraStore = CameraStore.getInstance();
