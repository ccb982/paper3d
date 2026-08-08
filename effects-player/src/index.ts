import * as THREE from 'three';
import { loadBundle, type BundleLoadResult } from './core/bundle';
import { decodeMultiFrame, buildFrameTexture } from './core/ftx';
import { buildDisplacementTextureData } from './core/entity';
import { buildEntityMesh, type EntityMeshData } from './gl/renderer';
import { FramePlaybackController } from './core/controller';
import type { PlaybackConfig, FramePlaybackCallbacks } from './core/controller';
import type {
  Manifest, PerFrameData, AnnotationsFile,
  SerializedRegionEntity, PaletteColor, FrameTextureData, PureAnnotationExport,
} from './core/types';

export type { Manifest, PerFrameData, AnnotationsFile, SerializedRegionEntity, PaletteColor, PureAnnotationExport };
export type { PlaybackConfig, PlaybackOrder, ControllerState, FramePlaybackCallbacks } from './core/controller';
export type { EntityMeshData };
export { renderFrameData, createThreeContext } from './gl/renderer';
export { FramePlaybackController };

export interface LoadOptions {
  resolution?: number;
  verifyHashes?: boolean;
}

export class Asset {
  readonly manifest: Manifest;
  readonly frames: PerFrameData[];
  readonly baseTextures: THREE.DataTexture[];
  readonly residualTextures: THREE.DataTexture[];
  readonly annotations: PureAnnotationExport[];
  readonly resolution: number;
  readonly frameCount: number;

  private _entityMeshMap: Map<string, EntityMeshData> = new Map();
  private _controllers: Set<FramePlaybackController> = new Set();

  constructor(raw: BundleLoadResult, options: { resolution: number }) {
    const resolution = options.resolution ?? 512;
    const multiFrame = decodeMultiFrame(raw.ftxBinary.buffer);
    const { palette, frames: ftxFrames } = multiFrame;

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

  getFrameRenderData(index: number): { baseTexture: THREE.DataTexture; residualTexture: THREE.DataTexture; entities: EntityMeshData[] } | null {
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
    return { baseTexture: baseTex, residualTexture: resTex, entities };
  }

  disposeController(ctrl: FramePlaybackController): void { ctrl.dispose(); this._controllers.delete(ctrl); }

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
    this.baseTextures.length = 0;
    this.residualTextures.length = 0;
  }
}
