import * as THREE from 'three';

export class CharacterPositionStore {
  private static instance: CharacterPositionStore;

  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public isMoving: boolean = false;

  private constructor() {}

  public static getInstance(): CharacterPositionStore {
    if (!CharacterPositionStore.instance) {
      CharacterPositionStore.instance = new CharacterPositionStore();
    }
    return CharacterPositionStore.instance;
  }

  public setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
  }

  public setVelocity(x: number, y: number, z: number): void {
    this.velocity.set(x, y, z);
  }

  public setMoving(moving: boolean): void {
    this.isMoving = moving;
  }

  public getPosition(): THREE.Vector3 {
    return this.position;
  }

  public getPositionCopy(): { x: number; y: number; z: number } {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z
    };
  }
}

export const characterPositionStore = CharacterPositionStore.getInstance();
