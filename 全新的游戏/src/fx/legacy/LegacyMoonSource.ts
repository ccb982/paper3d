// ============================================================
// src/fx/legacy/LegacyMoonSource —— 迁移期适配器（临时过渡）
// ============================================================
// 只做"把 vendor Asset 包装成 src/fx 的 MoonSource / 渲染后端"，
// 以及可选的旧 MoonEffect 回退视图。
// 退出条件：月亮完全由 src/fx 解码 + 渲染后，本文件随 legacy/ 整体删除。
// ============================================================

import type { Asset } from '../../vendor/player';
import { MoonEffect } from '../../vendor/player/MoonEffect';
import { renderFrameData } from '../../vendor/player/gl/renderer';
import type {
  MoonControllerLike,
  MoonFrameDataLike,
  MoonRenderBackend,
  MoonSource,
  MoonView,
} from '../channels/MoonChannel';

export interface LegacyMoonBinding {
  readonly source: MoonSource;
  readonly backend: MoonRenderBackend;
}

export function createLegacyMoonSource(asset: Asset): LegacyMoonBinding {
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
    // 迁移期灰度回退：旧 MoonEffect 原样保留
    createLegacyView(): MoonView {
      return new MoonEffect(asset);
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
