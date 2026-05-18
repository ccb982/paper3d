import * as THREE from 'three';
import { BaseShootingSystem } from '../base/BaseShootingSystem';

export class FreeStyleShootingSystem extends BaseShootingSystem {
  public name = 'freestyle';

  private isMouseDown: boolean = false;
  private lastFireTime: number = 0;
  private mousePos: { x: number; y: number } = { x: 0, y: 0 };
  private shootableObjects: THREE.Object3D[] = [];

  // ========== 性能优化：预创建的临时对象（避免每帧 GC）==========
  private _tmpDirection = new THREE.Vector3();
  private _tmpRaycaster = new THREE.Raycaster();
  private _tmpHitPoint = new THREE.Vector3();
  private _tmpFarPoint = new THREE.Vector3();
  private _tmpBulletOrigin = new THREE.Vector3();
  private _tmpDirToTarget = new THREE.Vector3();

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

    this.camera.getWorldDirection(this._tmpDirection);
    this._tmpRaycaster.set(this.camera.position, this._tmpDirection);

    if (this.shootableObjects.length > 0) {
      const intersects = this._tmpRaycaster.intersectObjects(this.shootableObjects, true);
      if (intersects.length > 0) {
        return intersects[0].point;
      }
    }

    this._tmpFarPoint.copy(this.camera.position).addScaledVector(this._tmpDirection, 100);
    return this._tmpFarPoint;
  }

  private updateShooting(): void {
    if (!this.isMouseDown) return;

    const now = Date.now();
    if (now - this.lastFireTime < this.fireRate) return;

    this.lastFireTime = now;

    const hitPoint = this.getRaycastHitPoint();
    if (!hitPoint) return;

    this._tmpBulletOrigin.set(
      this.characterPosition.x,
      this.characterPosition.y + 1.5,
      this.characterPosition.z
    );

    this._tmpDirToTarget.copy(hitPoint).sub(this._tmpBulletOrigin).normalize();

    this.createBullet(
      {
        x: this._tmpBulletOrigin.x,
        y: this._tmpBulletOrigin.y,
        z: this._tmpBulletOrigin.z
      },
      { x: this._tmpDirToTarget.x, y: this._tmpDirToTarget.y, z: this._tmpDirToTarget.z }
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