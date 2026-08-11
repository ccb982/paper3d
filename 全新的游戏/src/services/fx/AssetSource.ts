// ============================================================
// FrameAssetSource —— 统一资产接口（FtxAsset / Asset 都满足）
// ============================================================
// 动画/渲染管线只依赖此接口，对"纯纹理包"和"特效包"一视同仁，
// 是两条管线共用的最基础复用点。

import type * as THREE from 'three';
import type {
  FramePlaybackController,
  PlaybackConfig,
  FramePlaybackCallbacks,
} from '../../vendor/player/core/controller';

export interface FrameAssetSource {
  frameCount: number;
  /** 第 index 帧的纹理对（base=HSL float, residual=8bit 量化），渲染用 */
  getFramePair(index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null;
  /** 创建播放控制器（时间轴） */
  createController(config?: PlaybackConfig, callbacks?: FramePlaybackCallbacks): FramePlaybackController;
  /** 帧名 → 帧索引（不存在返回 null） */
  resolveFrame(name: string): number | null;
  /** 是否存在该帧名 */
  hasFrame(name: string): boolean;
}
