import * as THREE from 'three';

export interface IShootingSystem {
  name: string;
  initialize(): void;
  update(delta: number): void;
  onMouseDown(event: MouseEvent): void;
  onMouseUp(event: MouseEvent): void;
  onMouseMove(event: MouseEvent): void;
  dispose(): void;
  requiresPointerLock(): boolean;
  getRayData(): RayData[];
  setActive(active: boolean): void;
}

export interface BulletData {
  id: number;
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  velocity: number;
}

export interface RayData {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface LockTarget {
  point: { x: number; y: number; z: number };
  object: object;
}

export interface ShootingCallbacks {
  onBulletCreated?: (bullet: BulletData) => void;
  onBulletDestroyed?: (id: number) => void;
  onTargetLocked?: (target: LockTarget | null) => void;
  onLockStateChanged?: (isLocking: boolean, countdown: number) => void;
  onRayDataUpdated?: (rayData: RayData[]) => void;
  onShootDirectionChanged?: (direction: { x: number; y: number; z: number } | null) => void;
}
