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
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { FrameTextureData } from '../../vendor/player/core/types';

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

/**
 * ★ 角色表现特效资产接口（Asset / FtxAsset 显式实现；CharacterBase 自动管线用）。
 * 受击染料 / 死亡动画都需要：独立流体实例（不缓存，与共享播放实例隔离）。
 */
export interface CharacterFxAssetSource extends FrameAssetSource {
  /** 第 index 帧 FTX 帧数据（bbox 宽高比/区域实体用） */
  getFtxFrame(index: number): FrameTextureData | null;
  /** ★ 死亡动画流体：矢量模式 + 强重力 + 大速度上限（撕碎消散） */
  createDeathFluidEffect(renderer: THREE.WebGLRenderer, frameIndex: number): FluidEffect | null;
  /** ★ 受击染料流体：矢量平流 + 速度阻尼（红色晕开缓停） */
  createHitDyeEffect(renderer: THREE.WebGLRenderer, frameIndex: number): FluidEffect | null;
}
