import * as THREE from 'three';
import { decodeMultiFrame, buildFrameTexture, type DecodedMultiFrame } from './ftx';
import { FramePlaybackController, type PlaybackConfig, type FramePlaybackCallbacks } from './controller';
import { FluidEffect } from '../fluid/FluidEffect';
import type { PhysicsConfig } from './types';

/**
 * ★ 轻量纹理资产：直接加载 FTX3 多帧纹理包（.ftx3 / .ftx3.gz / 原始二进制）。
 *
 * 与 Asset 不同，它不需要 zip bundle（manifest / 实体 / 流体数据），
 * 只解码纹理帧（base + residual）用于播放预览。适合基础色编辑器
 * 导出的主角/特效纹理包。
 */
export class FtxAsset {
  readonly frameCount: number;
  /** 帧画布尺寸（width，height 一般相同） */
  readonly width: number;
  readonly height: number;
  /** 每帧解码数据（供流体/高级使用） */
  readonly decoded: DecodedMultiFrame;

  private _frameTextures: Array<{ base: THREE.DataTexture; residual: THREE.DataTexture }> = [];
  private _controllers: Set<FramePlaybackController> = new Set();
  private _fluidEffects: Map<number, FluidEffect> = new Map();

  constructor(buffer: ArrayBuffer) {
    const multiFrame = decodeMultiFrame(buffer);
    this.decoded = multiFrame;
    this.frameCount = multiFrame.frames.length;
    if (multiFrame.frames.length === 0) {
      throw new Error('FTX3 包中没有帧');
    }
    const first = multiFrame.frames[0];
    this.width = first.width;
    this.height = first.height;

    for (const ftxFrame of multiFrame.frames) {
      this._frameTextures.push(buildFrameTexture(ftxFrame, multiFrame.palette));
    }
  }

  static async load(input: ArrayBuffer | Uint8Array | string): Promise<FtxAsset> {
    let buf: ArrayBuffer;
    if (typeof input === 'string') {
      const res = await fetch(input);
      if (!res.ok) throw new Error(`加载失败: ${res.status} ${res.statusText}`);
      buf = await res.arrayBuffer();
    } else if (input instanceof Uint8Array) {
      buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else {
      buf = input;
    }
    return new FtxAsset(await maybeGunzip(buf));
  }

  /** 第 index 帧的 GPU 纹理（base=HSL float, residual=8bit 量化） */
  getFrame(index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null {
    if (index < 0 || index >= this._frameTextures.length) return null;
    return this._frameTextures[index];
  }

  createController(config?: PlaybackConfig, callbacks?: FramePlaybackCallbacks): FramePlaybackController {
    const ctrl = new FramePlaybackController(this as any, this.frameCount, config, callbacks);
    this._controllers.add(ctrl);
    return ctrl;
  }

  /**
   * ★ 物理流体参数注入：纯纹理 + 公共物理参数 → 流体效果（无实体障碍物，全图平流）。
   * 参数来自公共库（.phys.json），同一份参数可用于任意纹理。
   */
  getFluidEffect(index: number, renderer: THREE.WebGLRenderer, physics: PhysicsConfig): FluidEffect | null {
    const frame = this.decoded.frames[index];
    if (!frame) return null;
    const cached = this._fluidEffects.get(index);
    if (cached) return cached;
    // 纯纹理：无实体边界 → 无障碍物（全图平流 + 连续源注入）
    const effect = new FluidEffect(renderer, physics, frame, this.decoded.palette, []);
    this._fluidEffects.set(index, effect);
    return effect;
  }

  /** 清除某帧的流体效果（重新注入参数后调用） */
  clearFluidEffect(index?: number): void {
    if (index === undefined) {
      for (const [, eff] of this._fluidEffects) eff.dispose();
      this._fluidEffects.clear();
      return;
    }
    const eff = this._fluidEffects.get(index);
    if (eff) {
      eff.dispose();
      this._fluidEffects.delete(index);
    }
  }

  dispose(): void {
    for (const ctrl of this._controllers) ctrl.dispose();
    this._controllers.clear();
    this.clearFluidEffect();
    for (const t of this._frameTextures) {
      t.base.dispose();
      t.residual.dispose();
    }
    this._frameTextures = [];
  }
}

/** 自动识别 gzip（1f 8b 魔数）并解压 */
async function maybeGunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return buffer;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const result = await new Response(stream).arrayBuffer();
    return result;
  } catch (err) {
    throw new Error('Gzip 解压失败: ' + (err as Error).message);
  }
}
