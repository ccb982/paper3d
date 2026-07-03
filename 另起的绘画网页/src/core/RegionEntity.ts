import type { Point } from '../types';
import * as THREE from 'three';
import {
  computeBBoxAllRings,
  rasterizeRegionMaskLocal,
  clusterAndGenerateTexturesV2,
  hslToRgb,
  dequantize,
} from '../utils/colorCompressor';
import { compressToBinary, uint8ToBase64 } from '../utils/binaryCompression';
import type { CompressionResultV2 } from '../utils/colorCompressor';

export interface FtxTextureData {
  version: 2;
  baseColors: Array<{ h: number; s: number; l: number }>;
  deltaTexture: Uint8Array;
  regionIdTexture?: Uint8Array;
  textureSize: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export class RegionEntity {
  public readonly id: number;
  public readonly layerId: string;
  public readonly boundary: Point[][];

  private _ftxData: FtxTextureData | null = null;

  public transform = {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    anchor: null as { x: number; y: number } | null,
  };
  public maskEffect: any = null;

  private _gpuTexture: THREE.DataTexture | null = null;
  private _textureVersion: number = 0;
  private _cachedVersion: number = -1;

  constructor(id: number, layerId: string, boundary: Point[][]) {
    this.id = id;
    this.layerId = layerId;
    this.boundary = boundary;
  }

  public buildFromPaintBuffer(
    paintBuffer: ImageData,
    hueThreshold: number = 0.05,
    textureSize: number = 128
  ): void {
    const bbox = computeBBoxAllRings(this.boundary);
    const mask = rasterizeRegionMaskLocal(this.boundary, bbox);

    const smallComposited = document.createElement('canvas');
    smallComposited.width = 512;
    smallComposited.height = 512;
    const ctx = smallComposited.getContext('2d')!;
    ctx.putImageData(paintBuffer, 0, 0);

    const { baseColors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(
      mask,
      bbox,
      ctx.getImageData(0, 0, 512, 512),
      hueThreshold,
      512
    );

    this._ftxData = {
      version: 2,
      baseColors,
      deltaTexture: deltaTex,
      regionIdTexture: regionIdTex || undefined,
      textureSize,
      bbox,
    };

    this._textureVersion++;
  }

  public getGPUTexture(): THREE.DataTexture | null {
    if (!this._ftxData) return null;

    if (this._gpuTexture && this._textureVersion === this._cachedVersion) {
      return this._gpuTexture;
    }

    const { baseColors, deltaTexture, regionIdTexture, textureSize, bbox } = this._ftxData;
    const pixelData = this._decompressToRGBA(baseColors, deltaTexture, regionIdTexture, textureSize, bbox);

    if (this._gpuTexture) {
      this._gpuTexture.dispose();
    }
    this._gpuTexture = new THREE.DataTexture(
      pixelData,
      bbox.w,
      bbox.h,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this._gpuTexture.needsUpdate = true;
    this._gpuTexture.minFilter = THREE.LinearFilter;
    this._gpuTexture.magFilter = THREE.LinearFilter;
    this._gpuTexture.wrapS = THREE.ClampToEdgeWrapping;
    this._gpuTexture.wrapT = THREE.ClampToEdgeWrapping;

    this._cachedVersion = this._textureVersion;
    return this._gpuTexture;
  }

  private _decompressToRGBA(
    baseColors: Array<{ h: number; s: number; l: number }>,
    deltaTexture: Uint8Array,
    regionIdTexture: Uint8Array | undefined,
    _textureSize: number,
    bbox: { w: number; h: number }
  ): Uint8ClampedArray {
    const { w, h } = bbox;
    const pixelData = new Uint8ClampedArray(w * h * 4);
    pixelData.fill(0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;

        let finalHsl;
        if (regionIdTexture) {
          const baseIdx = regionIdTexture[idx] - 1;
          if (baseIdx < 0 || baseIdx >= baseColors.length) continue;
          const base = baseColors[baseIdx];
          const dH = dequantize(deltaTexture[idx * 3], 0.5);
          const dS = dequantize(deltaTexture[idx * 3 + 1], 1.0);
          const dL = dequantize(deltaTexture[idx * 3 + 2], 1.0);

          let finalH = base.h + dH;
          if (finalH < 0) finalH += 1.0;
          if (finalH > 1.0) finalH -= 1.0;
          const finalS = Math.max(0, Math.min(1, base.s + dS));
          const finalL = Math.max(0, Math.min(1, base.l + dL));
          finalHsl = { h: finalH, s: finalS, l: finalL };
        } else if (baseColors.length > 0) {
          finalHsl = baseColors[0];
        } else {
          continue;
        }

        const rgb = hslToRgb(finalHsl.h, finalHsl.s, finalHsl.l);
        const outIdx = (y * w + x) * 4;
        pixelData[outIdx] = rgb.r;
        pixelData[outIdx + 1] = rgb.g;
        pixelData[outIdx + 2] = rgb.b;
        pixelData[outIdx + 3] = 255;
      }
    }
    return pixelData;
  }

  public exportFtxBinary(): Uint8Array | null {
    if (!this._ftxData) return null;
    const result: CompressionResultV2 = {
      version: 2,
      resolution: [512, 512],
      regionCount: 1,
      regions: [{
        id: this.id,
        bbox: this._ftxData.bbox,
        baseColors: this._ftxData.baseColors,
        regionIdTexture: this._ftxData.regionIdTexture
          ? uint8ToBase64(this._ftxData.regionIdTexture)
          : undefined,
        deltaTexture: uint8ToBase64(this._ftxData.deltaTexture),
      }],
      quantization: 'uint8',
      hueThreshold: 0.05,
    };
    return compressToBinary(result);
  }

  public serialize(): any {
    return {
      id: this.id,
      layerId: this.layerId,
      boundary: this.boundary,
      transform: this.transform,
      maskEffect: this.maskEffect,
      ftxData: this._ftxData ? {
        version: this._ftxData.version,
        baseColors: this._ftxData.baseColors,
        deltaTexture: Array.from(this._ftxData.deltaTexture),
        regionIdTexture: this._ftxData.regionIdTexture ? Array.from(this._ftxData.regionIdTexture) : undefined,
        textureSize: this._ftxData.textureSize,
        bbox: this._ftxData.bbox,
      } : null,
      ftxId: `ftx_${this.id}_${this.layerId}`,
    };
  }

  public dispose(): void {
    if (this._gpuTexture) {
      this._gpuTexture.dispose();
      this._gpuTexture = null;
    }
    this._ftxData = null;
  }

  public restoreFromSerialized(data: any): void {
    if (data.transform) {
      this.transform = {
        position: data.transform.position || { x: 0, y: 0 },
        rotation: data.transform.rotation || 0,
        scale: data.transform.scale || { x: 1, y: 1 },
        anchor: data.transform.anchor || null,
      };
    }
    if (data.maskEffect) {
      this.maskEffect = data.maskEffect;
    }
    if (data.ftxData) {
      this._ftxData = {
        version: data.ftxData.version,
        baseColors: data.ftxData.baseColors,
        deltaTexture: new Uint8Array(data.ftxData.deltaTexture),
        regionIdTexture: data.ftxData.regionIdTexture
          ? new Uint8Array(data.ftxData.regionIdTexture)
          : undefined,
        textureSize: data.ftxData.textureSize,
        bbox: data.ftxData.bbox,
      };
      this._textureVersion++;
    }
  }

  public get bbox(): { x: number; y: number; w: number; h: number } | null {
    return this._ftxData?.bbox || null;
  }
}