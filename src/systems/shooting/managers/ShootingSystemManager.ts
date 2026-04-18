import * as THREE from 'three';
import type { IShootingSystem, ShootingCallbacks, RayData } from '../';
import { BaseShootingSystem } from '../base/BaseShootingSystem';

export class ShootingSystemManager {
  private systems: Map<string, IShootingSystem>;
  private activeSystemName: string;
  private camera: THREE.Camera | null = null;
  private scene: THREE.Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private callbacks: ShootingCallbacks = {};
  private characterPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  
  constructor() {
    this.systems = new Map();
    this.activeSystemName = '';
  }
  
  public registerSystem(name: string, system: IShootingSystem): void {
    this.systems.set(name, system);
    system.setCallbacks(this.callbacks);
    
    if (this.camera) {
      system.setCamera(this.camera);
    }
    if (this.scene) {
      system.setScene(this.scene);
    }
    if (this.canvas) {
      system.setCanvas(this.canvas);
    }
    system.setCharacterPosition(this.characterPosition);
  }
  
  public setActiveSystem(name: string): boolean {
    if (!this.systems.has(name)) {
      console.warn(`ShootingSystemManager: System "${name}" not found`);
      return false;
    }

    this.systems.forEach((system, systemName) => {
      if (system instanceof BaseShootingSystem) {
        system.setActive(systemName === name);
      }
    });

    this.activeSystemName = name;
    console.log(`ShootingSystemManager: Active system changed to "${name}"`);
    return true;
  }
  
  public getActiveSystem(): IShootingSystem | null {
    return this.systems.get(this.activeSystemName) || null;
  }

  public requiresPointerLock(): boolean {
    const system = this.systems.get(this.activeSystemName);
    if (system && 'requiresPointerLock' in system) {
      return (system as any).requiresPointerLock();
    }
    return true;
  }

  public getRayData(): RayData[] {
    const system = this.systems.get(this.activeSystemName);
    if (system && 'getRayData' in system) {
      return (system as any).getRayData();
    }
    return [];
  }

  public getActiveSystemName(): string {
    return this.activeSystemName;
  }
  
  public update(delta: number): void {
    const system = this.systems.get(this.activeSystemName);
    if (system) {
      system.update(delta);
    }
  }
  
  public onMouseDown(event: MouseEvent): void {
    const system = this.systems.get(this.activeSystemName);
    if (system) {
      system.onMouseDown(event);
    }
  }
  
  public onMouseUp(event: MouseEvent): void {
    const system = this.systems.get(this.activeSystemName);
    if (system) {
      system.onMouseUp(event);
    }
  }
  
  public onMouseMove(event: MouseEvent): void {
    const system = this.systems.get(this.activeSystemName);
    if (system) {
      system.onMouseMove(event);
    }
  }
  
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.systems.forEach(system => system.setCamera(camera));
  }
  
  public setScene(scene: THREE.Scene): void {
    this.scene = scene;
    this.systems.forEach(system => system.setScene(scene));
  }
  
  public setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.systems.forEach(system => system.setCanvas(canvas));
  }
  
  public setCallbacks(callbacks: ShootingCallbacks): void {
    this.callbacks = callbacks;
    this.systems.forEach(system => system.setCallbacks(callbacks));
  }
  
  public setCharacterPosition(position: { x: number; y: number; z: number }): void {
    this.characterPosition = position;
    this.systems.forEach(system => system.setCharacterPosition(position));
  }
  
  public dispose(): void {
    this.systems.forEach(system => system.dispose());
    this.systems.clear();
  }
  
  public hasSystem(name: string): boolean {
    return this.systems.has(name);
  }
  
  public getSystemNames(): string[] {
    return Array.from(this.systems.keys());
  }
}