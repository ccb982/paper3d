import * as THREE from 'three';
import { BaseShootingSystem } from '../base/BaseShootingSystem';

export class FreeStyleShootingSystem extends BaseShootingSystem {
  public name = 'freestyle';

  private isMouseDown: boolean = false;
  private lastFireTime: number = 0;
  private mousePos: { x: number; y: number } = { x: 0, y: 0 };
  private shootableObjects: THREE.Object3D[] = [];

  public setShootableObjects(objects: THREE.Object3D[]): void {
    this.shootableObjects = objects;
  }

  protected onInitialize(): void {
    console.log('FreeStyleShootingSystem initialized');
  }

  protected onUpdate(delta: number): void {
    this.updateShooting();
  }

  private getRaycastHitPoint(): THREE.Vector3 | null {
    if (!this.camera) return null;

    const raycaster = new THREE.Raycaster();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    raycaster.set(this.camera.position, direction);

    if (this.shootableObjects.length > 0) {
      const intersects = raycaster.intersectObjects(this.shootableObjects, true);
      if (intersects.length > 0) {
        return intersects[0].point;
      }
    }

    const farPoint = this.camera.position.clone().add(direction.multiplyScalar(100));
    return farPoint;
  }

  private updateShooting(): void {
    if (!this.isMouseDown) return;

    const now = Date.now();
    if (now - this.lastFireTime < this.fireRate) return;

    this.lastFireTime = now;

    const hitPoint = this.getRaycastHitPoint();
    if (!hitPoint) return;

    const bulletOrigin = new THREE.Vector3(
      this.characterPosition.x,
      this.characterPosition.y + 1.5,
      this.characterPosition.z
    );

    const direction = hitPoint.clone().sub(bulletOrigin).normalize();

    this.createBullet(
      {
        x: bulletOrigin.x,
        y: bulletOrigin.y,
        z: bulletOrigin.z
      },
      { x: direction.x, y: direction.y, z: direction.z }
    );
  }

  protected handleMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.isMouseDown = true;
    }
  }

  protected handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this.isMouseDown = false;
    }
  }

  protected handleMouseMove(event: MouseEvent): void {
    this.mousePos = { x: event.clientX, y: event.clientY };
  }

  protected onDispose(): void {
    console.log('FreeStyleShootingSystem disposed');
  }
}