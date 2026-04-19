import * as THREE from 'three';
import { AnimationClip } from './AnimationClip';

/**
 * 动画加载器 - 加载序列帧动画
 */
export class AnimationLoader {
  /**
   * 加载序列帧动画
   * @param basePath 文件夹路径，如 '/textures/characters/player/front'
   * @param frameCount 帧数
   * @param startIndex 起始索引，默认1
   * @param frameRate 帧率
   * @param loop 是否循环
   */
  public static async loadClip(
    basePath: string,
    frameCount: number,
    startIndex: number = 0,
    frameRate: number = 12,
    loop: boolean = true
  ): Promise<AnimationClip> {
  
    const loader = new THREE.TextureLoader();
    const promises: Promise<THREE.Texture>[] = [];
    for (let i = 0; i < frameCount; i++) {
      const idx = startIndex + i;
      const path = `${basePath}/${idx}.png`;
      promises.push(loader.loadAsync(path));
    }
    const loaded = await Promise.all(promises);
    return new AnimationClip(loaded, frameRate, loop);
  }

  /**
   * 加载纸片人角色的正面和背面动画
   * @param baseFolder 角色根目录，应包含 front/ 和 back/ 子文件夹
   * @param frontCount 正面帧数
   * @param backCount 背面帧数
   * @param frameRate 帧率
   */
  public static async loadPaperAnimations(
    baseFolder: string,
    frontCount: number,
    backCount: number,
    frameRate: number = 12
  ): Promise<{ frontClip: AnimationClip; backClip: AnimationClip }> {
    const frontClip = await this.loadClip(`${baseFolder}/front`, frontCount, 0, frameRate, true);
    const backClip = await this.loadClip(`${baseFolder}/back`, backCount, 0, frameRate, true);
    return { frontClip, backClip };
  }
}
