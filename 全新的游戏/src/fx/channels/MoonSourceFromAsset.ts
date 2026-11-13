// ============================================================
// src/fx/channels/MoonSourceFromAsset —— vendor Asset → MoonSource 的唯一适配器
// ============================================================
// 只做"把 vendor Asset 包装成 src/fx 的 MoonSource / 渲染后端"。
// 播放生命周期全部归 MoonChannel；本文件不含任何回退分支。
// ============================================================

import type { Asset } from '../../vendor/player';
import { renderFrameData } from '../../vendor/player/gl/renderer';
import type {
  MoonControllerLike,
  MoonFrameDataLike,
  MoonRenderBackend,
  MoonSource,
} from './MoonChannel';

export interface MoonAssetBinding {
  readonly source: MoonSource;
  readonly backend: MoonRenderBackend;
}

export function createMoonSource(asset: Asset): MoonAssetBinding {
  const source: MoonSource = {
    frameCount: asset.frameCount,
    resolution: asset.resolution,
    frames: asset.frames as unknown as MoonSource['frames'],
    getFtxBBox(index: number) {
      const ftx = asset.getFtxFrame(index);
      return ftx ? { w: ftx.bbox.w, h: ftx.bbox.h } : null;
    },
    createController() {
      return asset.createController({ order: 'loop', speed: 1 }) as MoonControllerLike;
    },
    getFrameRenderData(index: number) {
      return asset.getFrameRenderData(index) as unknown as MoonFrameDataLike | null;
    },
    disposeController(controller: MoonControllerLike) {
      asset.disposeController(controller as never);
    },
  };

  const backend: MoonRenderBackend = {
    renderFrameData(data, vatTime, vatFps, transform, renderer, scene, camera, distortTime) {
      renderFrameData(
        data as never,
        vatTime,
        vatFps,
        transform,
        renderer,
        scene,
        camera,
        undefined,
        distortTime,
      );
    },
  };

  return { source, backend };
}
