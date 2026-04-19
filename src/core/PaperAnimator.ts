import * as THREE from 'three';
import { AnimationClip } from './AnimationClip';
import { cameraStore } from './CameraStore';

/**
 * 纸片人动画器 - 管理正面和背面动画
 */
export class PaperAnimator {
  private frontClip: AnimationClip | null = null;
  private backClip: AnimationClip | null = null;
  private currentClip: AnimationClip | null = null;
  private material: THREE.Material & { map?: THREE.Texture };

  constructor(material: THREE.Material & { map?: THREE.Texture }) {
    this.material = material;
  }

  /**
   * 设置正面动画片段
   */
  public setFrontClip(clip: AnimationClip): void {
    this.frontClip = clip;
  }

  /**
   * 设置背面动画片段
   */
  public setBackClip(clip: AnimationClip): void {
    this.backClip = clip;
    // 初始第一帧使用后背0贴图
    if (!this.material.map && clip.frames.length > 0) {
      this.material.map = clip.frames[0];
    }
  }

  /**
   * 根据角色位置和相机位置决定播放正面还是背面动画
   * @param charPos 角色世界坐标
   * @param cameraPos 相机世界坐标
   */
  public updateDirection(charPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    const toCamera = new THREE.Vector3().subVectors(cameraPos, charPos);
    toCamera.y = 0;
    if (toCamera.length() < 0.001) return;
    toCamera.normalize();
    const forward = new THREE.Vector3(0, 0, 1);
    const isFront = forward.dot(toCamera) > 0;
    const targetClip = isFront ? this.frontClip : this.backClip;
    if (targetClip === this.currentClip) return;
    this.currentClip = targetClip;
    this.currentClip?.reset();
  }

  /**
   * 更新动画
   * @param delta 时间差（秒）
   */
  public update(delta: number): void {
    if (!this.currentClip) return;
    const texture = this.currentClip.update(delta);
    if (texture) this.material.map = texture;
  }

  /**
   * 设置帧率
   */
  public setFrameRate(frontRate?: number, backRate?: number): void {
    if (frontRate !== undefined && this.frontClip) this.frontClip.frameRate = frontRate;
    if (backRate !== undefined && this.backClip) this.backClip.frameRate = backRate;
  }
}
