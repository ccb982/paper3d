import * as THREE from 'three';
import type { CharacterFxAssetSource } from '../../services/fx/AssetSource';
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
  PhysicsConfig, HitEffectShapeExport,
} from './core/types';

export type { Manifest, PerFrameData, AnnotationsFile, SerializedRegionEntity, PaletteColor, PureAnnotationExport, PhysicsConfig };
export type { PlaybackConfig, PlaybackOrder, ControllerState, FramePlaybackCallbacks } from './core/controller';
export type { EntityMeshData };
export type { FrameNameEntry } from './core/frameResolver';
export { renderFrameData } from './gl/renderer';
export { FramePlaybackController };
export { FluidEffect } from './fluid/FluidEffect';
export { MoonEffect } from './MoonEffect';
export type { FrameTextureData };
export { FtxAsset } from './FtxAsset';
export { HitEffectView } from './hitEffect/HitEffectView';
export type { HitEffectViewOptions } from './hitEffect/HitEffectView';
export type { HitEffectShapeExport, HitEffectSolidFill, HitEffectFtxFill, HitEffectResidualLayer, HitEffectsFile } from './core/types';
export { randomSeed, shapeSeed, generateVariant, tickVariant, variantDuration } from './hitEffect/variantGenerator';
export type { EffectShapeDef, EffectShapeParams } from './hitEffect/types';

export interface LoadOptions {
  resolution?: number;
  verifyHashes?: boolean;
}

/**
 * Asset —— 无头播放器核心（无 UI，纯资源加载 + 播放控制 + 渲染输出）
 * 游戏通过 getFrameRenderData / getFluidEffect 驱动特效挂接。
 */
export class Asset implements CharacterFxAssetSource {
  readonly manifest: Manifest;
  readonly frames: PerFrameData[];
  readonly baseTextures: THREE.DataTexture[];
  readonly residualTextures: THREE.DataTexture[];
  readonly annotations: PureAnnotationExport[];
  readonly resolution: number;
  readonly frameCount: number;
  /** 击中特效（矢量动画）形状定义（素材包无则空数组） */
  readonly hitEffects: HitEffectShapeExport[];

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

    // ★ 帧参数继承：第一帧的扭曲/变换参数用于所有帧。
    //   用户通常只做第一帧（前后参数一致），后序帧即使导出了
    //   distortEnabled=false（导出默认值）也统一沿用第一帧的开启状态。
    const f0 = raw.frames[0];
    const f0Enabled = f0?.distortEnabled ?? false;
    for (const fd of raw.frames) {
      if (f0Enabled) {
        // 第一帧开启扭曲 → 所有帧统一开启 + 缺失参数沿用第一帧
        if (!fd.distortEnabled) fd.distortEnabled = true;
        if (fd.distortAmplitude === undefined) fd.distortAmplitude = f0?.distortAmplitude ?? 0.06;
        if (fd.distortFrequency === undefined) fd.distortFrequency = f0?.distortFrequency ?? 5.0;
        if (fd.distortSpeed === undefined) fd.distortSpeed = f0?.distortSpeed ?? 1.2;
        if (fd.distortRotation === undefined) fd.distortRotation = f0?.distortRotation ?? 0;
      } else {
        if (fd.distortEnabled === undefined) fd.distortEnabled = false;
      }
      if (fd.textureOffset === undefined) fd.textureOffset = f0?.textureOffset;
      if (fd.textureScale === undefined) fd.textureScale = f0?.textureScale;
      if (fd.textureRotation === undefined) fd.textureRotation = f0?.textureRotation;
    }

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
      const frameHeight = hasFtx
        ? ftxFrames[frameData.textureIndex].height
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
        // ★ Nearest：RG Float32 在 WebGL2 不可线性过滤（采样未定义），
        //   且 VAT 按顶点索引/帧精确取点，最近邻即正确
        dispTex.minFilter = THREE.NearestFilter;
        dispTex.magFilter = THREE.NearestFilter;
        dispTex.wrapS = THREE.ClampToEdgeWrapping;
        dispTex.wrapT = THREE.ClampToEdgeWrapping;
        dispTex.flipY = false;

        const meshData = buildEntityMesh(
          entityData, ftxBbox, dispTex,
          dispResult.width, dispResult.height, frameWidth, frameHeight,
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
    this.hitEffects = raw.hitEffects?.shapes ?? [];
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

  /** 第 index 帧的纹理对（统一资产接口 FrameAssetSource 用） */
  getFramePair(index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null {
    const d = this.getFrameRenderData(index);
    if (!d) return null;
    return { base: d.baseTexture, residual: d.residualTexture };
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

  /**
   * ★ 从 URL 加载编辑器导出的 .phys.json 并注入（配方闭环）：
   *   - frameIndex 省略 → 注入到全部帧
   *   - 原始 JSON 直传（保留 regionWalls / obstacle 等扩展键，不经 parsePhysicsConfig 剥离）
   *   返回是否成功。
   */
  async loadPhysicsFromUrl(url: string, frameIndex?: number): Promise<boolean> {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const rawJson = (await res.json()) as any;
      // ★ 格式归一化：编辑器"导出配置"是五块结构（coreSwitches/globalForce/levelSet…），
      //   解析器只吃扁平结构 —— 此处转换，同时保留 regionWalls/obstacle 等扩展键
      const raw = normalizePhysJson(rawJson);
      const idxs = frameIndex !== undefined ? [frameIndex] : this.frames.map((_, i) => i);
      for (const i of idxs) this.injectPhysics(i, raw);
      return true;
    } catch {
      return false;
    }
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

  /**
   * ★ 创建独立流体效果（死亡动画用）：不缓存、与共享实例隔离。
   * 若该帧有 physics 配置则用之，否则用默认矢量配置（死亡动画强制矢量模式）。
   * 返回 null 表示无法构建（无 FTX 帧数据）。
   */
  createDeathFluidEffect(
    renderer: THREE.WebGLRenderer,
    frameIndex: number,
  ): FluidEffect | null {
    const ftxFrame = this.getFtxFrame(frameIndex);
    if (!ftxFrame) return null;
    const palette = this._ftx!.palette;

    const entities: SerializedRegionEntity[] = [];
    for (const ed of this.frames[frameIndex].regionEntities) {
      entities.push(ed);
    }

    // ★ 死亡动画强制矢量模式 + 强重力 + 大速度上限（流体消散用）
    const physics: PhysicsConfig = {
      ...(this.frames[frameIndex].physics ?? {}),
      enableAdvection: true,
      enablePressure: true,
      pressureIterations: 30,
      advectionMode: 'vector',
      gravity: { x: 0, y: 4000 },
      velocityScale: 0.98,
      maxVelocity: 20000,
    };

    return new FluidEffect(renderer, physics, ftxFrame, palette, entities);
  }

  /**
   * ★ 创建独立受击染料流体（角色受伤时注入红色；scalar 模式 + 高粘度 + LevelSet 表面张力，
   * 红色以浓度场扩散晕开，持续时间结束后 dispose 即恢复原纹理）
   */
  createHitDyeEffect(
    renderer: THREE.WebGLRenderer,
    frameIndex: number,
  ): FluidEffect | null {
    const ftxFrame = this.getFtxFrame(frameIndex);
    if (!ftxFrame) return null;
    const palette = this._ftx!.palette;

    const entities: SerializedRegionEntity[] = [];
    for (const ed of this.frames[frameIndex].regionEntities) {
      entities.push(ed);
    }

    const physics: PhysicsConfig = {
      // coreSwitches
      enableAdvection: true,
      enablePressure: true,
      pressureIterations: 100,
      pressureOmega: 1.7,
      pressureBoundaryMode: 'neumann',
      enableWarmStart: true,

      // advectionAndComposite
      advectionMode: 'scalar',
      combineMode: 'sub',
      channels: { h: true, s: true, l: true, a: true },
      scalarConfig: {
        hMultiplier: 0.8,
        sMultiplier: 0.8,
        lMultiplier: 0.8,
        aMultiplier: 0.8,
        baselineDensity: 1,
        decayRate: 0.0588,
      },

      // globalForce
      gravity: { x: 0, y: 0 },
      velocityScale: 2,
      maxVelocity: 50,
      viscosity: 1000,
      colorBoundaryMode: 'clamp',

      // levelSet
      levelSetConfig: {
        enabled: false,
        reinitInterval: 1,
        reinitIterations: 6,
        surfaceTension: -5000000,
        smoothingRadius: 5,
        narrowBandWidth: 5,
        constrainLiquid: false,
        outwardDamping: 1,
        clampAirPhi: true,
        maxAirPhi: 0,
        compensateWaterPhi: false,
        waterCompensationRate: 0.1,
      },
    };

    return new FluidEffect(renderer, physics, ftxFrame, palette, entities);
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


// ============================================================
// .phys.json 格式归一化：五块结构（编辑器导出）→ 扁平结构（解析器输入）
// ============================================================
function normalizePhysJson(json: Record<string, unknown> & { coreSwitches?: unknown }): Record<string, unknown> {
  const cs = json.coreSwitches as Record<string, unknown> | undefined;
  if (!cs) return json; // 已是扁平格式，原样返回

  const ac = (json.advectionAndComposite ?? {}) as Record<string, unknown>;
  const gf = (json.globalForce ?? {}) as Record<string, unknown>;
  const ls = (json.levelSet ?? {}) as Record<string, unknown>;

  return {
    ...json, // 透传扩展键：regionWalls / obstacle / name / category …
    enableAdvection: cs.enableAdvection,
    enablePressure: cs.enablePressure,
    pressureIterations: cs.pressureIterations,
    pressureOmega: cs.pressureOmega,
    pressureBoundaryMode: cs.pressureBoundaryMode,
    enableWarmStart: cs.enableWarmStart,
    advectionMode: ac.advectionMode,
    combineMode: ac.combineMode,
    channels: ac.channels,
    scalarConfig: ac.scalarConfig,
    gravity: gf.gravity,
    velocityScale: gf.velocityScale,
    maxVelocity: gf.maxVelocity,
    viscosity: gf.viscosity,
    colorBoundaryMode: gf.colorBoundaryMode,
    levelSetConfig: {
      enabled: ls.enabled ?? ls.enableLevelSet,
      ...(ls as Record<string, unknown>),
    },
    resolution: json.resolution,
    continuousSources: json.continuousSources ?? [],
  };
}
