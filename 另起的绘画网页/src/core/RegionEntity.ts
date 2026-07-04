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
  public worldBbox: { x: number; y: number; w: number; h: number } | null = null;

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
    const pixelBbox = computeBBoxAllRings(this.boundary);

    this.worldBbox = {
      x: pixelBbox.x / 512,
      y: 1 - (pixelBbox.y + pixelBbox.h) / 512,
      w: pixelBbox.w / 512,
      h: pixelBbox.h / 512,
    };

    const mask = rasterizeRegionMaskLocal(this.boundary, pixelBbox);
    const { w, h } = pixelBbox;

    const smallComposited = document.createElement('canvas');
    smallComposited.width = 512;
    smallComposited.height = 512;
    const ctx = smallComposited.getContext('2d')!;
    ctx.putImageData(paintBuffer, 0, 0);

    const { baseColors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(
      mask,
      pixelBbox,
      ctx.getImageData(0, 0, 512, 512),
      hueThreshold,
      512
    );

    const resampledDelta = new Uint8Array(textureSize * textureSize * 3);
    const resampledRegionId = regionIdTex ? new Uint8Array(textureSize * textureSize) : null;

    for (let ty = 0; ty < textureSize; ty++) {
      for (let tx = 0; tx < textureSize; tx++) {
        const u = (tx + 0.5) / textureSize;
        const v = (ty + 0.5) / textureSize;
        const srcX = Math.floor(u * w);
        const srcY = Math.floor((1 - v) * h);
        const srcIdx = srcY * w + srcX;

        resampledDelta[(ty * textureSize + tx) * 3] = deltaTex[srcIdx * 3];
        resampledDelta[(ty * textureSize + tx) * 3 + 1] = deltaTex[srcIdx * 3 + 1];
        resampledDelta[(ty * textureSize + tx) * 3 + 2] = deltaTex[srcIdx * 3 + 2];

        if (resampledRegionId && regionIdTex) {
          resampledRegionId[ty * textureSize + tx] = regionIdTex[srcIdx];
        }
      }
    }

    this._ftxData = {
      version: 2,
      baseColors,
      deltaTexture: resampledDelta,
      regionIdTexture: resampledRegionId || undefined,
      textureSize,
      bbox: pixelBbox,
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
      textureSize,
      textureSize,
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
    textureSize: number,
    _bbox: { w: number; h: number }
  ): Uint8ClampedArray {
    const pixelData = new Uint8ClampedArray(textureSize * textureSize * 4);
    pixelData.fill(0);

    for (let ty = 0; ty < textureSize; ty++) {
      for (let tx = 0; tx < textureSize; tx++) {
        const idx = ty * textureSize + tx;
        const deltaIdx = idx * 3;

        let finalHsl;
        if (regionIdTexture) {
          const baseIdx = regionIdTexture[idx] - 1;
          if (baseIdx < 0 || baseIdx >= baseColors.length) continue;
          const base = baseColors[baseIdx];
          const dH = dequantize(deltaTexture[deltaIdx], 0.5);
          const dS = dequantize(deltaTexture[deltaIdx + 1], 1.0);
          const dL = dequantize(deltaTexture[deltaIdx + 2], 1.0);

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
        const outIdx = (ty * textureSize + tx) * 4;
        pixelData[outIdx] = rgb.r;
        pixelData[outIdx + 1] = rgb.g;
        pixelData[outIdx + 2] = rgb.b;
        pixelData[outIdx + 3] = 255;
      }
    }
    return pixelData;
  }

  public exportFtxBinary(): Uint8Array | null {
    if (!this._ftxData || !this.worldBbox) return null;
    const bboxPixels = {
      x: Math.round(this.worldBbox.x * 512),
      y: Math.round((1 - this.worldBbox.y - this.worldBbox.h) * 512),
      w: Math.round(this.worldBbox.w * 512),
      h: Math.round(this.worldBbox.h * 512),
    };
    const result: CompressionResultV2 = {
      version: 2,
      resolution: [512, 512],
      regionCount: 1,
      regions: [{
        id: this.id,
        bbox: bboxPixels,
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
      worldBbox: this.worldBbox,
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
    if (data.worldBbox) {
      this.worldBbox = data.worldBbox;
    } else if (data.ftxData?.bbox) {
      const pb = data.ftxData.bbox;
      this.worldBbox = {
        x: pb.x / 512,
        y: 1 - (pb.y + pb.h) / 512,
        w: pb.w / 512,
        h: pb.h / 512,
      };
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
    return this.worldBbox;
  }
}