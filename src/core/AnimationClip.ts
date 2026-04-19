import * as THREE from 'three';

/**
 * 动画片段 - 管理序列帧动画
 */
export class AnimationClip {
  public frames: THREE.Texture[] = [];
  public frameRate: number = 12;
  public loop: boolean = true;
  private currentFrame: number = 0;
  private timeAcc: number = 0;

  constructor(frames: THREE.Texture[], frameRate: number = 12, loop: boolean = true) {
    this.frames = frames;
    this.frameRate = frameRate;
    this.loop = loop;
  }

  /**
   * 更新动画，返回当前帧纹理
   * @param delta 时间差（秒）
   */
  public update(delta: number): THREE.Texture | null {
    if (this.frames.length === 0) return null;
    this.timeAcc += delta;
    const frameInterval = 1 / this.frameRate;
    if (this.timeAcc >= frameInterval) {
      const steps = Math.floor(this.timeAcc / frameInterval);
      this.currentFrame += steps;
      this.timeAcc -= steps * frameInterval;
      if (this.currentFrame >= this.frames.length) {
        if (this.loop) {
          this.currentFrame %= this.frames.length;
        } else {
          this.currentFrame = this.frames.length - 1;
          return this.frames[this.currentFrame];
        }
      }
    }
    return this.frames[this.currentFrame];
  }

  /**
   * 重置动画到起始帧
   */
  public reset(): void {
    this.currentFrame = 0;
    this.timeAcc = 0;
  }
}
