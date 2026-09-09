// ============================================================
// DroneCompositeSource —— 无人机三图层合成源（FrameAssetSource）
// ============================================================
// 可露希尔无人机的 .scene.zip 三帧其实是三个图层：
//   帧0 无人机主体 / 帧1 左翅膀 / 帧2 右翅膀 —— 共享同一 441×300 画布，
//   各自纹理按 bbox 裁剪、bbox 位置即图层在画布中的位置。
// 本类把它们 CPU 合成进一张全画布 base+residual 纹理对：
//   getFramePair(任意 index) 一律返回合成后的完整无人机 → 单贴片同时显示全部图层。
// 渲染管线（FTXQuad）完全不变，只换纹理源。
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { Asset } from '../../vendor/player';
import { buildBaseHslData, buildResidualData } from '../../vendor/player/core/ftx';
import { FramePlaybackController } from '../../vendor/player/core/controller';
import type { FrameTextureData, PaletteColor } from '../../vendor/player/core/types';
import type {
  FrameAssetSource,
} from './AssetSource';
import type { PlaybackConfig, FramePlaybackCallbacks } from '../../vendor/player/core/controller';

/** 全画布尺寸（帧数据里存的原始画布宽高） */
export interface DroneCompositeInfo {
  width: number;
  height: number;
}

/**
 * 取源资产的所有 FTX 帧数据 + 调色板（Asset / FtxAsset 都实现 getFtxFrame）。
 * Asset 的调色板走公开访问器（新增 getFtxPalette），FtxAsset 直接读 palette。
 */
function collectFrames(source: Asset | FtxAsset): { frames: FrameTextureData[]; palette: PaletteColor[] } {
  const frames: FrameTextureData[] = [];
  for (let i = 0; i < source.frameCount; i++) {
    const f = source.getFtxFrame(i);
    if (f) frames.push(f);
  }
  const palette = source instanceof FtxAsset
    ? source.palette
    : (source as Asset).getFtxPalette();
  return { frames, palette };
}

export class DroneCompositeSource implements FrameAssetSource {
  readonly width: number;
  readonly height: number;
  readonly frameCount = 1;
  private pair: { base: THREE.DataTexture; residual: THREE.DataTexture } | null = null;

  constructor(source: Asset | FtxAsset) {
    const { frames, palette } = collectFrames(source);
    // 画布尺寸 = 第一帧的原始宽高（三帧共享同一画布）
    const f0 = frames[0];
    const width = f0?.width ?? 512;
    const height = f0?.height ?? 512;
    this.width = width;
    this.height = height;

    // 全画布缓冲区（初始透明；shape 内 alpha=1）
    const baseData = new Float32Array(width * height * 4);
    const resData = new Uint8Array(width * height * 4);
    // 残差预填充中性（128）——与 buildResidualData 约定一致
    for (let i = 0; i < resData.length; i += 4) {
      resData[i] = 128; resData[i + 1] = 128; resData[i + 2] = 128; resData[i + 3] = 0;
    }

    // 逐图层 blit 进画布（frame 顺序 = 主体 → 左翅膀 → 右翅膀，后者在上）
    for (const f of frames) {
      if (!f.bbox || f.bbox.w <= 0 || f.bbox.h <= 0) continue;
      const baseHsl = buildBaseHslData(f, palette);
      const residual = buildResidualData(f);
      if (!baseHsl || !residual) continue;
      const { bbox } = f;
      for (let y = 0; y < bbox.h; y++) {
        for (let x = 0; x < bbox.w; x++) {
          const s = (y * bbox.w + x) * 4;
          if (baseHsl.data[s + 3] <= 0.5) continue; // 该层此处透明 → 保留下层
          const dx = bbox.x + x;
          const dy = bbox.y + y;
          if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;
          const d = (dy * width + dx) * 4;
          baseData[d] = baseHsl.data[s];
          baseData[d + 1] = baseHsl.data[s + 1];
          baseData[d + 2] = baseHsl.data[s + 2];
          baseData[d + 3] = 1;
          resData[d] = residual.data[s];
          resData[d + 1] = residual.data[s + 1];
          resData[d + 2] = residual.data[s + 2];
          resData[d + 3] = 255;
        }
      }
    }

    const baseTex = new THREE.DataTexture(
      baseData, width, height, THREE.RGBAFormat, THREE.FloatType,
    );
    baseTex.flipY = false;
    baseTex.needsUpdate = true;
    baseTex.minFilter = THREE.NearestFilter;
    baseTex.magFilter = THREE.NearestFilter;
    baseTex.wrapS = THREE.ClampToEdgeWrapping;
    baseTex.wrapT = THREE.ClampToEdgeWrapping;

    const resTex = new THREE.DataTexture(
      resData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    resTex.flipY = false;
    resTex.needsUpdate = true;
    resTex.minFilter = THREE.NearestFilter;
    resTex.magFilter = THREE.NearestFilter;
    resTex.wrapS = THREE.ClampToEdgeWrapping;
    resTex.wrapT = THREE.ClampToEdgeWrapping;

    this.pair = { base: baseTex, residual: resTex };
  }

  /** 合成后的完整无人机纹理对（单帧，任意 index 返回同一张） */
  getFramePair(_index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null {
    return this.pair;
  }

  createController(_config?: PlaybackConfig, _callbacks?: FramePlaybackCallbacks): FramePlaybackController {
    // 静态合成源无动画：生成一个空跑控制器（跑在第 0 帧）
    return new FramePlaybackController(this as never, this.frameCount, {
      fps: 1, order: { type: 'sequence', frames: [0] }, loop: false,
    });
  }

  resolveFrame(_name: string): number {
    return 0;
  }

  hasFrame(_name: string): boolean {
    return true;
  }

  dispose(): void {
    if (this.pair) {
      this.pair.base.dispose();
      this.pair.residual.dispose();
      this.pair = null;
    }
  }
}