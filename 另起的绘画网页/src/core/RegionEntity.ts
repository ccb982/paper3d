import type { Point } from '../types';
import * as THREE from 'three';
import { processMaskRingCPU } from '../utils/gpuMaskProcessor';
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

  private _displacementTexture: THREE.DataTexture | null = null;
  private _numFrames: number = 60;
  private _totalVertices: number = 0;
  private _lastMaskEffectHash: string = '';
  private _lastCanvasWidth: number = 0;
  private _lastCanvasHeight: number = 0;

  public fixedVertices: Set<number> = new Set();

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
    console.log(`[RegionEntity] 区域 ${this.id} - 开始纹理提取...`);
    
    // 直接从 boundary 计算世界坐标包围盒（与边框点处理方式一致，Y向上）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of this.boundary) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    
    // worldBbox 使用世界坐标（Y向上），与相机一致
    this.worldBbox = {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };

    console.log(`[RegionEntity] 区域 ${this.id} - 世界坐标边界: (${minX.toFixed(4)}, ${minY.toFixed(4)}) ~ (${maxX.toFixed(4)}, ${maxY.toFixed(4)}), worldBbox: (${this.worldBbox.x.toFixed(4)}, ${this.worldBbox.y.toFixed(4)}) w=${this.worldBbox.w.toFixed(4)}, h=${this.worldBbox.h.toFixed(4)}`);

    const pixelBbox = computeBBoxAllRings(this.boundary);

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

    console.log(`[RegionEntity] 区域 ${this.id} - 颜色聚类完成: ${baseColors.length} 个基础色, 残差纹理大小: ${deltaTex.length}`);

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

    console.log(`[RegionEntity] 区域 ${this.id} - FTX编码完成: 纹理尺寸 ${textureSize}x${textureSize}, 数据量 ${resampledDelta.length} 字节`);

    this._textureVersion++;
  }

  public getGPUTexture(): THREE.DataTexture | null {
    if (!this._ftxData) return null;

    if (this._gpuTexture && this._textureVersion === this._cachedVersion) {
      console.log(`[RegionEntity] 区域 ${this.id} - 使用缓存的GPU纹理`);
      return this._gpuTexture;
    }

    console.log(`[RegionEntity] 区域 ${this.id} - 开始解压FTX数据生成GPU纹理...`);
    
    const { baseColors, deltaTexture, regionIdTexture, textureSize, bbox } = this._ftxData;
    const pixelData = this._decompressToRGBA(baseColors, deltaTexture, regionIdTexture, textureSize, bbox);

    // 【调试】统计纹理像素
    let opaquePixels = 0;
    let totalPixels = pixelData.length / 4;
    for (let i = 3; i < pixelData.length; i += 4) {
      if (pixelData[i] > 0) opaquePixels++;
    }
    console.log(`[RegionEntity] 区域 ${this.id} - 纹理统计: 总像素 ${totalPixels}, 不透明像素 ${opaquePixels}, 透明像素 ${totalPixels - opaquePixels}`);

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
    // canvas.getImageData() 返回的是 sRGB 编码，解压后仍为 sRGB
    // 设置 SRGBColorSpace 让 Three.js 采样时自动解码为线性，渲染时再编码
    if ('SRGBColorSpace' in THREE) {
      this._gpuTexture.colorSpace = (THREE as any).SRGBColorSpace;
    } else {
      this._gpuTexture.colorSpace = 'srgb';
    }
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
          const base = baseColors[0];
          const dH = dequantize(deltaTexture[deltaIdx], 0.5);
          const dS = dequantize(deltaTexture[deltaIdx + 1], 1.0);
          const dL = dequantize(deltaTexture[deltaIdx + 2], 1.0);
          
          let finalH = base.h + dH;
          if (finalH < 0) finalH += 1.0;
          if (finalH > 1.0) finalH -= 1.0;
          const finalS = Math.max(0, Math.min(1, base.s + dS));
          const finalL = Math.max(0, Math.min(1, base.l + dL));
          finalHsl = { h: finalH, s: finalS, l: finalL };
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

  public buildDisplacementTexture(
    canvasWidth: number,
    canvasHeight: number,
    maskEffect?: any,
    numFrames: number = 60
  ): THREE.DataTexture {
    const effect = maskEffect || this.maskEffect;
    if (!effect) {
      throw new Error('RegionEntity: 缺少扭曲参数');
    }

    const allRings = this.boundary;
    if (allRings.length === 0 || allRings[0].length < 3) {
      throw new Error('区域外环顶点不足3个');
    }

    const allVertices = allRings.flat();
    const vertexCount = allVertices.length;
    this._totalVertices = vertexCount;
    this._numFrames = numFrames;

    const basePixels = allVertices.map(p => ({
      x: p.x * canvasWidth,
      y: (1 - p.y) * canvasHeight,
    }));

    const totalFrames = numFrames + 1;
    const data = new Float32Array(totalFrames * vertexCount * 2);
    const hasFixed = this.fixedVertices.size > 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      const t = (frame / numFrames) * 2 * Math.PI;

      const distortedWorldAll: Point[] = [];
      for (const ring of allRings) {
        const distorted = processMaskRingCPU(ring, effect, t);
        distortedWorldAll.push(...distorted);
      }

      for (let globalIdx = 0; globalIdx < vertexCount; globalIdx++) {
        const idx = (frame * vertexCount + globalIdx) * 2;
        if (hasFixed && this.fixedVertices.has(globalIdx)) {
          data[idx] = 0;
          data[idx + 1] = 0;
        } else {
          const base = basePixels[globalIdx];
          const distortedPx = {
            x: distortedWorldAll[globalIdx].x * canvasWidth,
            y: (1 - distortedWorldAll[globalIdx].y) * canvasHeight,
          };
          data[idx] = distortedPx.x - base.x;
          data[idx + 1] = distortedPx.y - base.y;
        }
      }
    }

    const texture = new THREE.DataTexture(
      data,
      vertexCount,
      totalFrames,
      THREE.RGFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    this._lastMaskEffectHash = JSON.stringify(effect);
    this._lastCanvasWidth = canvasWidth;
    this._lastCanvasHeight = canvasHeight;
    if (this._displacementTexture) this._displacementTexture.dispose();
    this._displacementTexture = texture;
    return texture;
  }

  public getDisplacementTexture(
    canvasWidth: number,
    canvasHeight: number,
    forceRebuild: boolean = false
  ): THREE.DataTexture | null {
    if (!this.maskEffect) return null;

    const currentHash = JSON.stringify(this.maskEffect);
    const paramsChanged =
      forceRebuild ||
      this._lastCanvasWidth !== canvasWidth ||
      this._lastCanvasHeight !== canvasHeight ||
      this._lastMaskEffectHash !== currentHash;

    if (paramsChanged || !this._displacementTexture) {
      this.buildDisplacementTexture(canvasWidth, canvasHeight, this.maskEffect, this._numFrames);
    }
    return this._displacementTexture;
  }

  public getTotalVertices(): number {
    return this._totalVertices;
  }

  public getNumFrames(): number {
    return this._numFrames + 1;
  }

  public toggleFixedVertex(globalIndex: number): boolean {
    if (this.fixedVertices.has(globalIndex)) {
      this.fixedVertices.delete(globalIndex);
      return false;
    } else {
      this.fixedVertices.add(globalIndex);
      return true;
    }
  }

  public toggleFixedVertices(indices: number[]): void {
    for (const idx of indices) {
      this.toggleFixedVertex(idx);
    }
    this._textureVersion++;
  }

  public setFixedVertices(indices: number[], fixed: boolean): void {
    for (const idx of indices) {
      if (fixed) {
        this.fixedVertices.add(idx);
      } else {
        this.fixedVertices.delete(idx);
      }
    }
    this._textureVersion++;
  }

  public getVerticesNearPoint(
    worldX: number,
    worldY: number,
    threshold: number = 0.02
  ): Array<{ globalIndex: number; point: Point }> {
    const result: Array<{ globalIndex: number; point: Point }> = [];
    let globalIdx = 0;
    for (const ring of this.boundary) {
      for (const p of ring) {
        const dist = Math.hypot(p.x - worldX, p.y - worldY);
        if (dist < threshold) {
          result.push({ globalIndex: globalIdx, point: p });
        }
        globalIdx++;
      }
    }
    return result;
  }

  public dispose(): void {
    if (this._gpuTexture) {
      this._gpuTexture.dispose();
      this._gpuTexture = null;
    }
    if (this._displacementTexture) {
      this._displacementTexture.dispose();
      this._displacementTexture = null;
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
        y: pb.y / 512,
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