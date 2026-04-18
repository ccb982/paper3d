import * as THREE from 'three';
import { BaseShootingSystem } from '../base/BaseShootingSystem';
import { getCameraPitch, getCorrectedNDC } from '../../../utils/shootingUtils';
import type { RayData } from '../interfaces/IShootingSystem';

interface Target {
  object: THREE.Object3D;
  distance: number;
}

export class LockonShootingSystem extends BaseShootingSystem {
  public name = 'lockon';

  private isMouseDown: boolean = false;
  private lastFireTime: number = 0;

  private isLocking: boolean = false;
  private lockCountdown: number = 0;
  private lockDuration: number = 1000;

  private targetDetected: boolean = false;
  private lockedTarget: Target | null = null;

  private shootableObjects: THREE.Object3D[] = [];
  private mousePos: { x: number; y: number } = { x: 0, y: 0 };

  private rayData: RayData[] = [];
  private isActiveSystem: boolean = false;

  protected onInitialize(): void {
    console.log('LockonShootingSystem initialized');
  }

  protected onUpdate(delta: number): void {
    this.performRaycastAndLock(delta);
  }

  private performRaycastAndLock(delta: number): void {
    if (!this.camera || !this.canvas) {
      console.log('LockOn: early return - no camera or canvas');
      return;
    }

    this.camera.updateMatrixWorld();

    const characterPos = new THREE.Vector3(
      this.characterPosition.x,
      this.characterPosition.y,
      this.characterPosition.z
    );

    const ndcResult = getCorrectedNDC(
      this.canvas,
      this.mousePos.x,
      this.mousePos.y,
      this.camera,
      characterPos,
      0.3
    );

    const raycaster = new THREE.Raycaster();
    const allIntersects: THREE.Intersection[] = [];
    const rayOrigins: THREE.Vector3[] = [];
    const rayDirections: THREE.Vector3[] = [];

    // 计算俯角影响的射线偏移量
    const pitch = getCameraPitch(this.camera);
    const pitchAbs = Math.abs(pitch);
    // 俯角越大，射线间距越大
    const offsetScale = 0.05 + pitchAbs * 0.1;

    const rayOffsets = [
      { x: 0, y: 0 },
      { x: offsetScale, y: 0 },
      { x: -offsetScale, y: 0 },
      { x: 0, y: offsetScale },
      { x: 0, y: -offsetScale },
    ];

    for (const offset of rayOffsets) {
        raycaster.setFromCamera(
          new THREE.Vector2(ndcResult.corrected.x + offset.x, ndcResult.corrected.y + offset.y),
          this.camera
        );
        const finalDirection = raycaster.ray.direction.clone();

        raycaster.set(this.camera.position, finalDirection);
        const intersects = raycaster.intersectObjects(this.shootableObjects, true);

        allIntersects.push(...intersects);
        rayOrigins.push(this.camera.position.clone());
        rayDirections.push(finalDirection.clone());
      }

    this.rayData = rayOrigins.map((origin, i) => ({
      origin,
      direction: rayDirections[i]
    }));

    console.log(`LockOn: shootable=${this.shootableObjects.length}, intersects=${allIntersects.length}, mouseDown=${this.isMouseDown}`);

    const hasTarget = allIntersects.length > 0;

    if (hasTarget) {
      allIntersects.sort((a, b) => a.distance - b.distance);
      const closestIntersect = allIntersects[0];

      const target: Target = {
        object: closestIntersect.object,
        distance: closestIntersect.distance
      };

      if (this.isMouseDown && !this.lockedTarget && !this.isLocking) {
        this.lockedTarget = target;
        this.isLocking = true;
        this.lockCountdown = this.lockDuration;
        this.notifyLockStateChanged(true, this.lockCountdown);
        this.notifyTargetLocked({ point: closestIntersect.point, object: closestIntersect.object });
        console.log('锁定开始');
      }

      if (this.lockedTarget) {
        this.lockedTarget = target;
      }
    } else {
      if (this.lockedTarget || this.isLocking) {
        console.log('目标丢失，取消锁定');
      }
      this.lockedTarget = null;
      this.isLocking = false;
      this.lockCountdown = 0;
      this.notifyLockStateChanged(false, 0);
      this.notifyTargetLocked(null);
    }

    if (this.isLocking) {
      this.lockCountdown -= delta * 1000;

      if (this.lockCountdown <= 0) {
        this.lockCountdown = 0;
        this.isLocking = false;
        console.log('锁定完成，可以射击');
      }

      this.notifyLockStateChanged(this.isLocking, this.lockCountdown);
    }

    this.updateShooting();
  }

  private updateShooting(): void {
    if (!this.lockedTarget || this.isLocking || !this.isMouseDown) {
      this.notifyShootDirectionChanged(null);
      return;
    }

    const targetPosition = new THREE.Vector3();
    this.lockedTarget.object.getWorldPosition(targetPosition);

    const firePosition = new THREE.Vector3(
      this.characterPosition.x,
      this.characterPosition.y + 1.2,
      this.characterPosition.z
    );

    const direction = new THREE.Vector3().subVectors(targetPosition, firePosition).normalize();

    this.notifyShootDirectionChanged({ x: direction.x, y: direction.y, z: direction.z });

    const now = Date.now();
    if (now - this.lastFireTime < this.fireRate) return;

    this.lastFireTime = now;

    this.createBullet(
      {
        x: firePosition.x,
        y: firePosition.y,
        z: firePosition.z
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
      this.cancelLocking();
    }
  }

  protected handleMouseMove(event: MouseEvent): void {
    this.mousePos = { x: event.clientX, y: event.clientY };
  }

  private cancelLocking(): void {
    this.isLocking = false;
    this.lockCountdown = 0;
    this.targetDetected = false;
    this.lockedTarget = null;
    this.notifyLockStateChanged(false, 0);
    this.notifyTargetLocked(null);
  }

  protected onDispose(): void {
    console.log('LockonShootingSystem disposed');
  }

  public setShootableObjects(objects: THREE.Object3D[]): void {
    this.shootableObjects = objects;
  }

  public requiresPointerLock(): boolean {
    return false;
  }

  public setActive(active: boolean): void {
    this.isActiveSystem = active;
  }

  public getRayData(): RayData[] {
    return this.isActiveSystem ? this.rayData : [];
  }
}