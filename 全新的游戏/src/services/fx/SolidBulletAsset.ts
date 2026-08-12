// ============================================================
// SolidBulletAsset —— 程序生成的子弹贴片资产（FrameAssetSource）
// ============================================================
// 用途：子弹系统落地前的测试资产（发光圆点），无需资产文件。
// 实现最小接口：1 帧 + mock 播放控制器（子弹无动画，帧恒 0）。
// 正式资产就绪后替换为 .ftx3/.scene.zip，管线不变。

import * as THREE from 'three';
import type { FrameAssetSource } from './AssetSource';
import type { FramePlaybackController, PlaybackConfig, FramePlaybackCallbacks } from '../../vendor/player/core/controller';

/** 生成发光圆点子弹资产（size=纹理边长像素；h/s/l=HSL 颜色） */
export function createSolidBulletAsset(size = 64, h = 0.0, s = 0.9, l = 0.6): FrameAssetSource {
  const n = size * size;
  // base：HSL float（r=H, g=S, b=L, a=Alpha）；residual：8bit（128=无残差）
  const baseData = new Float32Array(n * 4);
  const resData = new Uint8Array(n * 4);
  const r = size * 0.45;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const i = (y * size + x) * 4;
      const inCircle = dx * dx + dy * dy <= r * r;
      baseData[i] = h;
      baseData[i + 1] = inCircle ? s : 0;
      baseData[i + 2] = inCircle ? l : 0;
      baseData[i + 3] = inCircle ? 1 : 0;
      resData[i] = 128;
      resData[i + 1] = 128;
      resData[i + 2] = 128;
      resData[i + 3] = 255;
    }
  }
  const base = new THREE.DataTexture(baseData, size, size, THREE.RGBAFormat, THREE.FloatType);
  const residual = new THREE.DataTexture(resData, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  base.needsUpdate = true;
  residual.needsUpdate = true;

  return {
    frameCount: 1,
    getFramePair: (i) => (i === 0 ? { base, residual } : null),
    // 子弹无动画：mock 控制器（帧恒 0）
    createController: (_config?: PlaybackConfig, _callbacks?: FramePlaybackCallbacks): FramePlaybackController =>
      ({
        callbacks: {},
        frameIndex: 0,
        state: 'playing',
        reset: () => undefined,
        goto: () => undefined,
        gotoTime: () => undefined,
        stepForward: () => undefined,
        stepBackward: () => undefined,
        hold: () => undefined,
        release: () => undefined,
        play: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        stop: () => undefined,
        advance: () => undefined,
        dispose: () => undefined,
      }) as unknown as FramePlaybackController,
    resolveFrame: () => 0,
    hasFrame: () => false,
  };
}
