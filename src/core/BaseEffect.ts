import * as THREE from 'three';

export abstract class BaseEffect {
  public isActive: boolean = true;
  public duration: number = 0;      // 总时长(秒)
  public elapsed: number = 0;
  public onComplete?: () => void;

  constructor(duration: number, onComplete?: () => void) {
    this.duration = duration;
    this.onComplete = onComplete;
  }

  public update(delta: number): void {
    this.elapsed += delta;
    if (this.duration !== Infinity && this.elapsed >= this.duration) {
      this.isActive = false;
      this.onComplete?.();
    } else {
      this.onUpdate(delta);
    }
  }

  protected abstract onUpdate(delta: number): void;
  public abstract dispose(): void;
}