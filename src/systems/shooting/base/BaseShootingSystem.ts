import * as THREE from 'three';
import type { IShootingSystem, ShootingCallbacks, BulletData, LockTarget } from '../';

export abstract class BaseShootingSystem implements IShootingSystem {
  public abstract name: string;
  
  protected camera: THREE.Camera | null = null;
  protected scene: THREE.Scene | null = null;
  protected canvas: HTMLCanvasElement | null = null;
  protected callbacks: ShootingCallbacks = {};
  
  protected isActive: boolean = true;
  protected bulletVelocity: number = 15;
  protected fireRate: number = 1000;
  protected bulletIdCounter: number = 0;
  
  protected characterPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  
  public initialize(): void {
    this.onInitialize();
  }
  
  protected abstract onInitialize(): void;
  
  public update(delta: number): void {
    if (!this.isActive) return;
    this.onUpdate(delta);
  }
  
  protected abstract onUpdate(delta: number): void;
  
  public onMouseDown(event: MouseEvent): void {
    if (!this.isActive) return;
    this.handleMouseDown(event);
  }
  
  public onMouseUp(event: MouseEvent): void {
    if (!this.isActive) return;
    this.handleMouseUp(event);
  }
  
  public onMouseMove(event: MouseEvent): void {
    if (!this.isActive) return;
    this.handleMouseMove(event);
  }
  
  protected abstract handleMouseDown(event: MouseEvent): void;
  protected abstract handleMouseUp(event: MouseEvent): void;
  protected abstract handleMouseMove(event: MouseEvent): void;
  
  public dispose(): void {
    this.isActive = false;
    this.onDispose();
  }

  public setActive(active: boolean): void {
    this.isActive = active;
    console.log(`${this.name} system ${active ? 'activated' : 'deactivated'}`);
  }

  public requiresPointerLock(): boolean {
    return true;
  }

  protected abstract onDispose(): void;
  
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }
  
  public setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }
  
  public setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }
  
  public setCallbacks(callbacks: ShootingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }
  
  public setCharacterPosition(position: { x: number; y: number; z: number }): void {
    this.characterPosition = position;
  }
  
  public setBulletVelocity(velocity: number): void {
    this.bulletVelocity = velocity;
  }
  
  public setFireRate(rate: number): void {
    this.fireRate = rate;
  }
  
  protected createBullet(
    position: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number }
  ): BulletData {
    const bullet: BulletData = {
      id: this.bulletIdCounter++,
      position: { ...position },
      direction: { ...direction },
      velocity: this.bulletVelocity
    };
    
    this.callbacks.onBulletCreated?.(bullet);
    return bullet;
  }
  
  protected notifyBulletDestroyed(id: number): void {
    this.callbacks.onBulletDestroyed?.(id);
  }
  
  protected notifyTargetLocked(target: LockTarget | null): void {
    this.callbacks.onTargetLocked?.(target);
  }
  
  protected notifyLockStateChanged(isLocking: boolean, countdown: number): void {
    this.callbacks.onLockStateChanged?.(isLocking, countdown);
  }

  protected notifyShootDirectionChanged(direction: { x: number; y: number; z: number } | null): void {
    this.callbacks.onShootDirectionChanged?.(direction);
  }

  public getRayData(): Array<{ origin: THREE.Vector3; direction: THREE.Vector3 }> {
    return [];
  }
}