import * as THREE from 'three';
import { loadBundle, type BundleLoadResult } from './core/bundle';
import { decodeMultiFrame, buildFrameTexture, type DecodedMultiFrame } from './core/ftx';
import { buildDisplacementTextureData } from './core/entity';
import { buildEntityMesh, type EntityMeshData } from './gl/renderer';
import { FramePlaybackController } from './core/controller';
import type { PlaybackConfig, FramePlaybackCallbacks } from './core/controller';
import { FrameResolver, type FrameNameEntry } from './core/frameResolver';
import { FluidEffect } from './fluid/FluidEffect';
import type {
  Manifest, PerFrameData, AnnotationsFile,
  SerializedRegionEntity, PaletteColor, FrameTextureData, PureAnnotationExport,
  PhysicsConfig,
} from './core/types';

export type { Manifest, PerFrameData, AnnotationsFile, SerializedRegionEntity, PaletteColor, PureAnnotationExport, PhysicsConfig };
export type { PlaybackConfig, PlaybackOrder, ControllerState, FramePlaybackCallbacks } from './core/controller';
export type { EntityMeshData };
export type { FrameNameEntry } from './core/frameResolver';
export { renderFrameData } from './gl/renderer';
export { FramePlaybackController };
export { FluidEffect } from './fluid/FluidEffect';
export type { FrameTextureData };
export { FtxAsset } from './FtxAsset';

export interface LoadOptions {
  resolution?: number;
  verifyHashes?: boolean;
}

/**
 * Asset —— 无头播放器核心（无 UI，纯资源加载 + 播放控制 + 渲染输出）
 * 游戏通过 getFrameRenderData / getFluidEffect 驱动特效挂接。
 */
export class Asset {
  readonly manifest: Manifest;
  readonly frames: PerFrameData[];
  readonly baseTextures: THREE.DataTexture[];
  readonly residualTextures: THREE.DataTexture[];
  readonly annotations: PureAnnotationExport[];
  readonly resolution: number;
  readonly frameCount: number;

  /** 帧名解析器（名字 → 帧索引，基于 PerFrameData.name） */
  readonly resolver: FrameResolver;

  /** FTX 解码数据（构建流体效果用） */
  private _ftx: DecodedMultiFrame | null = null;

  private _entityMeshMap: Map<string, EntityMeshData> = new Map();
  private _controllers: Set<FramePlaybackController> = new Set();
  private _fluidEffects: Map<number, FluidEffect> = new Map();

  constructor(raw: BundleLoadResult, options: { resolution: number }) {
    const resolution = options.resolution ?? 512;
    const multiFrame = decodeMultiFrame(raw.ftxBinary.buffer);
    const { palette, frames: ftxFrames } = multiFrame;
    this._ftx = multiFrame;
    this.resolver = new FrameResolver(raw.frames.map((f) => f.name));

    const baseTextures: THREE.DataTexture[] = [];
    const residualTextures: THREE.DataTexture[] = [];
    for (const ftxFrame of ftxFrames) {
      const { base, residual } = buildFrameTexture(ftxFrame, palette);
      baseTextures.push(base);
      residualTextures.push(residual);
    }

    for (let frameIdx = 0; frameIdx < raw.frames.length; frameIdx++) {
      const frameData = raw.frames[frameIdx];
      const hasFtx = frameData.textureIndex >= 0 && frameData.textureIndex < ftxFrames.length;
      const ftxBbox = hasFtx
        ? ftxFrames[frameData.textureIndex].bbox
        : { x: 0, y: 0, w: resolution, h: resolution };
      const frameWidth = hasFtx
        ? ftxFrames[frameData.textureIndex].width
        : resolution;

      for (const entityData of frameData.regionEntities) {
        const dispResult = buildDisplacementTextureData(
          entityData.boundary,
          entityData.maskEffect || null,
          resolution,
          resolution,
          entityData.fixedVertices || [],
          30,
        );
        if (!dispResult) continue;

        const dispTex = new THREE.DataTexture(
          dispResult.data, dispResult.width, dispResult.height,
          THREE.RGFormat, THREE.FloatType,
        );
        dispTex.needsUpdate = true;
        dispTex.minFilter = THREE.LinearFilter;
        dispTex.magFilter = THREE.LinearFilter;
        dispTex.wrapS = THREE.ClampToEdgeWrapping;
        dispTex.wrapT = THREE.ClampToEdgeWrapping;
        dispTex.flipY = false;

        const meshData = buildEntityMesh(
          entityData, ftxBbox, dispTex,
          dispResult.width, dispResult.height, frameWidth,
        );
        if (!meshData) continue;

        this._entityMeshMap.set(`${frameIdx}:${entityData.id}`, meshData);
      }
    }

    this.manifest = raw.manifest;
    this.frames = raw.frames;
    this.baseTextures = baseTextures;
    this.residualTextures = residualTextures;
    this.annotations = raw.annotations?.annotations ?? [];
    this.resolution = resolution;
    this.frameCount = raw.manifest.totalFrames;
  }

  static async load(input: ArrayBuffer | Uint8Array | string, options: LoadOptions = {}): Promise<Asset> {
    const buf = typeof input === 'string' ? await (await fetch(input)).arrayBuffer() : input;
    const raw = await loadBundle(buf, options.verifyHashes);
    return new Asset(raw, { resolution: options.resolution ?? 512 });
  }

  createController(config?: PlaybackConfig, callbacks?: FramePlaybackCallbacks): FramePlaybackController {
    const ctrl = new FramePlaybackController(this, this.frameCount, config, callbacks);
    this._controllers.add(ctrl);
    return ctrl;
  }

  getFrameRenderData(index: number): {
    baseTexture: THREE.DataTexture;
    residualTexture: THREE.DataTexture;
    entities: EntityMeshData[];
    textureOffset: { x: number; y: number };
    textureScale: { x: number; y: number };
    textureRotation: number;
    distortEnabled: boolean;
    distortAmplitude: number;
    distortFrequency: number;
    distortSpeed: number;
    distortRotation: number;
  } | null {
    if (index < 0 || index >= this.frames.length) return null;
    const fd = this.frames[index];
    const baseTex = fd.textureIndex >= 0 && fd.textureIndex < this.baseTextures.length
      ? this.baseTextures[fd.textureIndex] : this.baseTextures[0];
    const resTex = fd.textureIndex >= 0 && fd.textureIndex < this.residualTextures.length
      ? this.residualTextures[fd.textureIndex] : this.residualTextures[0];
    const entities: EntityMeshData[] = [];
    for (const ed of fd.regionEntities) {
      const m = this._entityMeshMap.get(`${index}:${ed.id}`);
      if (m) entities.push(m);
    }
    return {
      baseTexture: baseTex,
      residualTexture: resTex,
      entities,
      textureOffset: fd.textureOffset ?? { x: 0, y: 0 },
      textureScale: fd.textureScale ?? { x: 1, y: 1 },
      textureRotation: fd.textureRotation ?? 0,
      distortEnabled: fd.distortEnabled ?? false,
      distortAmplitude: fd.distortAmplitude ?? 0.06,
      distortFrequency: fd.distortFrequency ?? 5.0,
      distortSpeed: fd.distortSpeed ?? 1.2,
      distortRotation: fd.distortRotation ?? 0,
    };
  }

  disposeController(ctrl: FramePlaybackController): void { ctrl.dispose(); this._controllers.delete(ctrl); }

  // ============ 帧名解析（FrameResolver） ============

  /** 全部帧清单（名字 + 索引） */
  getFrameNames(): FrameNameEntry[] {
    return this.resolver.list();
  }

  /** 全部帧名（按顺序） */
  frameNames(): string[] {
    return this.resolver.names();
  }

  /** 名字 → 帧索引；不存在返回 null */
  resolveFrame(name: string): number | null {
    return this.resolver.resolve(name);
  }

  /** 是否存在该帧名 */
  hasFrame(name: string): boolean {
    return this.resolver.contains(name);
  }

  /** 按名字跳帧（驱动所有已创建的播放控制器） */
  gotoFrame(name: string): boolean {
    const idx = this.resolver.resolve(name);
    if (idx === null) return false;
    for (const ctrl of this._controllers) ctrl.goto(idx);
    return true;
  }

  /** 该帧是否有流体物理配置 */
  hasPhysics(index: number): boolean {
    const fd = this.frames[index];
    return !!fd && !!fd.physics;
  }

  /** 获取该帧流体配置（无则 null） */
  getPhysicsConfig(index: number): PhysicsConfig | null {
    const fd = this.frames[index];
    return fd?.physics ?? null;
  }

  /** 获取该帧 FTX 原始数据（构建流体效果用），无则 null */
  getFtxFrame(index: number): FrameTextureData | null {
    if (!this._ftx) return null;
    const fd = this.frames[index];
    if (!fd) return null;
    const ftxIdx = fd.textureIndex;
    if (ftxIdx < 0 || ftxIdx >= this._ftx.frames.length) return null;
    return this._ftx.frames[ftxIdx];
  }

  /**
   * ★ 物理参数注入（解耦）：用公共物理参数（.phys.json）覆盖某帧的内嵌参数。
   * 同一份参数可注入任意特效/纹理；注入后已创建的流体效果自动失效重建。
   */
  injectPhysics(frameIndex: number, config: import('./core/types').PhysicsConfig | null): void {
    const fd = this.frames[frameIndex];
    if (!fd) return;
    fd.physics = config;
    this._fluidEffects.delete(frameIndex);
  }

  /** 获取或惰性创建该帧的流体效果（需要渲染器）。返回 null 表示该帧无流体配置。 */
  getFluidEffect(index: number, renderer: THREE.WebGLRenderer): FluidEffect | null {
    if (index < 0 || index >= this.frames.length) return null;
    const cached = this._fluidEffects.get(index);
    if (cached) return cached;

    const physics = this.frames[index].physics;
    if (!physics) return null;
    const ftxFrame = this.getFtxFrame(index);
    if (!ftxFrame) return null;
    const palette = this._ftx!.palette;

    const entities: SerializedRegionEntity[] = [];
    for (const ed of this.frames[index].regionEntities) {
      entities.push(ed);
    }

    const effect = new FluidEffect(renderer, physics, ftxFrame, palette, entities);
    this._fluidEffects.set(index, effect);
    return effect;
  }

  /** 释放所有流体效果（重新加载或 dispose 时调用） */
  clearFluidEffects(): void {
    for (const [, eff] of this._fluidEffects) eff.dispose();
    this._fluidEffects.clear();
  }

  dispose(): void {
    for (const ctrl of this._controllers) ctrl.dispose();
    this._controllers.clear();
    for (const tex of this.baseTextures) tex.dispose();
    for (const tex of this.residualTextures) tex.dispose();
    for (const [, em] of this._entityMeshMap) {
      em.displacementTexture.dispose();
      em.mesh.geometry.dispose();
      em.fillMesh.geometry.dispose();
      (em.mesh.material as THREE.Material).dispose();
      (em.fillMesh.material as THREE.Material).dispose();
    }
    this._entityMeshMap.clear();
    this.clearFluidEffects();
    this.baseTextures.length = 0;
    this.residualTextures.length = 0;
  }
}
