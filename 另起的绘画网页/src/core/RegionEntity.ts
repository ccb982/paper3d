import type { Point } from '../types';
import * as THREE from 'three';
import { processMaskRingCPU } from '../utils/gpuMaskProcessor';
import {
  computeBBoxAllRings,
  rasterizeRegionMaskLocal,
  clusterAndGenerateTexturesV2,
  hslToRgb,
} from '../utils/colorCompressor';
import {
  dequantizeH,
  dequantizeS,
  dequantizeL,
  getAdaptiveBlockIndex,
  getRangeForBlock,
  uint8ToBase64,
  packRGB565,
} from '../core/ftxCore';
import { compressToBinary } from '../utils/binaryCompression';
import type { CompressionResultV2 } from '../utils/colorCompressor';

export interface FtxTextureData {
  version: 2 | 3;
  baseColors: Array<{ h: number; s: number; l: number }>;
  deltaTexture: Uint8Array;
  regionIdTexture?: Uint8Array;
  textureSize: number;
  bbox: { x: number; y: number; w: number; h: number };
  blockFlags: number;
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
    hueThreshold: number = 0.025,
    textureSize: number = 128
  ): void {
    
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

    const pixelBbox = computeBBoxAllRings(this.boundary);

    const mask = rasterizeRegionMaskLocal(this.boundary, pixelBbox);
    const { w, h } = pixelBbox;

    const smallComposited = document.createElement('canvas');
    smallComposited.width = 512;
    smallComposited.height = 512;
    const ctx = smallComposited.getContext('2d')!;
    ctx.putImageData(paintBuffer, 0, 0);

    const { baseColors, regionIdTex, deltaTex, blockFlags } = clusterAndGenerateTexturesV2(
      mask,
      pixelBbox,
      ctx.getImageData(0, 0, 512, 512),
      hueThreshold,
      512
    );

    console.log(`[FTX管道] 区域 ${this.id} → paintBuffer→FTX: ${baseColors.length}基础色, 残差${deltaTex.length}字节, blockFlags=${blockFlags}`);

    const resampledDelta = new Uint8Array(textureSize * textureSize * 3);
    const resampledRegionId = regionIdTex ? new Uint8Array(textureSize * textureSize) : null;

    for (let ty = 0; ty < textureSize; ty++) {
      for (let tx = 0; tx < textureSize; tx++) {
        const u = (tx + 0.5) / textureSize;
        const v = (ty + 0.5) / textureSize;
        const srcX = Math.floor(u * w);
        const srcY = Math.floor((1 - v) * h);
        const srcIdx = srcY * w + srcX;

        const hVal = deltaTex[srcIdx * 3];
        const sVal = deltaTex[srcIdx * 3 + 1];
        const lVal = deltaTex[srcIdx * 3 + 2];

        const packed = packRGB565(sVal, hVal, lVal);
        const decodedH = (packed >> 5) & 0x3F;
        const decodedS = (packed >> 11) & 0x1F;
        const decodedL = packed & 0x1F;

        resampledDelta[(ty * textureSize + tx) * 3] = decodedH;
        resampledDelta[(ty * textureSize + tx) * 3 + 1] = decodedS;
        resampledDelta[(ty * textureSize + tx) * 3 + 2] = decodedL;

        if (resampledRegionId && regionIdTex) {
          resampledRegionId[ty * textureSize + tx] = regionIdTex[srcIdx];
        }
      }
    }

    this._ftxData = {
      version: 3,
      baseColors,
      deltaTexture: resampledDelta,
      regionIdTexture: resampledRegionId || undefined,
      textureSize,
      bbox: pixelBbox,
      blockFlags,
    };

    this._textureVersion++;
  }

  public setFtxData(data: FtxTextureData): void {
    this._ftxData = data;
    this._textureVersion++;
  }

  public getFtxData(): FtxTextureData | null {
    return this._ftxData;
  }

  public getGPUTexture(): THREE.DataTexture | null {
    if (!this._ftxData) return null;

    if (this._gpuTexture && this._textureVersion === this._cachedVersion) {
      return this._gpuTexture;
    }

    const { baseColors, deltaTexture, regionIdTexture, textureSize, bbox, blockFlags } = this._ftxData;
    const pixelData = this._decompressToRGBA(baseColors, deltaTexture, regionIdTexture, textureSize, bbox, blockFlags);

    let opaquePixels = 0;
    let totalPixels = pixelData.length / 4;
    for (let i = 3; i < pixelData.length; i += 4) {
      if (pixelData[i] > 0) opaquePixels++;
    }

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
    // 注意：_decompressToRGBA 返回的已经是 sRGB 显示值（hslToRgb 生成的是 sRGB）
    // 如果设置 SRGBColorSpace，会导致 GPU 做 sRGB→linear 逆校正，渲染器又做 linear→sRGB 正校正
    // 双重校正会压缩暗部，导致颜色发黑。此处不设置 colorSpace，让数据按线性传递即可。
    // 渲染器最终输出时会统一做一次 linear→sRGB 校正，颜色就能正确还原。
    this._gpuTexture.needsUpdate = true;
    this._gpuTexture.minFilter = THREE.LinearFilter;
    this._gpuTexture.magFilter = THREE.LinearFilter;
    this._gpuTexture.wrapS = THREE.ClampToEdgeWrapping;
    this._gpuTexture.wrapT = THREE.ClampToEdgeWrapping;

    this._cachedVersion = this._textureVersion;
    
    console.log(`[FTX管道] 区域 ${this.id} → GPU纹理: ${textureSize}x${textureSize}, 不透明${opaquePixels}/${totalPixels}像素`);
    return this._gpuTexture;
  }

  private _decompressToRGBA(
    baseColors: Array<{ h: number; s: number; l: number }>,
    deltaTexture: Uint8Array,
    regionIdTexture: Uint8Array | undefined,
    textureSize: number,
    _bbox: { w: number; h: number },
    blockFlags: number = 0
  ): Uint8ClampedArray {
    const pixelData = new Uint8ClampedArray(textureSize * textureSize * 4);
    pixelData.fill(0);

    for (let ty = 0; ty < textureSize; ty++) {
      for (let tx = 0; tx < textureSize; tx++) {
        const idx = ty * textureSize + tx;
        const deltaIdx = idx * 3;

        const blockIdx = getAdaptiveBlockIndex(tx, ty, textureSize, textureSize);
        const range = getRangeForBlock(blockFlags, blockIdx);

        let finalHsl;
        if (regionIdTexture) {
          const baseIdx = regionIdTexture[idx] - 1;
          if (baseIdx < 0 || baseIdx >= baseColors.length) continue;
          const base = baseColors[baseIdx];
          const dH = dequantizeH(deltaTexture[deltaIdx], range);
          const dS = dequantizeS(deltaTexture[deltaIdx + 1], range);
          const dL = dequantizeL(deltaTexture[deltaIdx + 2], range);

          let finalH = base.h + dH;
          finalH = ((finalH % 1) + 1) % 1;
          const finalS = Math.max(0, Math.min(1, base.s + dS));
          const finalL = Math.max(0, Math.min(1, base.l + dL));
          finalHsl = { h: finalH, s: finalS, l: finalL };
        } else if (baseColors.length > 0) {
          const base = baseColors[0];
          const dH = dequantizeH(deltaTexture[deltaIdx], range);
          const dS = dequantizeS(deltaTexture[deltaIdx + 1], range);
          const dL = dequantizeL(deltaTexture[deltaIdx + 2], range);
          
          let finalH = base.h + dH;
          finalH = ((finalH % 1) + 1) % 1;
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
      hueThreshold: 0.025,
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
    loopFrames: number = 30
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

    const basePixels = allVertices.map(p => ({
      x: p.x * canvasWidth,
      y: (1 - p.y) * canvasHeight,
    }));

    const totalFrames = 2 * loopFrames;
    this._numFrames = totalFrames;
    const data = new Float32Array(totalFrames * vertexCount * 2);
    const hasFixed = this.fixedVertices.size > 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      let t: number;
      if (frame < loopFrames) {
        t = (frame / loopFrames) * 2 * Math.PI;
      } else {
        const reverseIndex = frame - loopFrames;
        t = (1 - (reverseIndex + 1) / loopFrames) * 2 * Math.PI;
      }

      const distortedWorldAll: Point[] = [];
      for (const ring of allRings) {
        const distorted = processMaskRingCPU(ring, effect, t);
        distortedWorldAll.push(...distorted);
      }

      const rawDeltas = new Float32Array(vertexCount * 2);
      for (let globalIdx = 0; globalIdx < vertexCount; globalIdx++) {
        const base = basePixels[globalIdx];
        const distortedPx = {
          x: distortedWorldAll[globalIdx].x * canvasWidth,
          y: (1 - distortedWorldAll[globalIdx].y) * canvasHeight,
        };
        rawDeltas[globalIdx * 2] = distortedPx.x - base.x;
        rawDeltas[globalIdx * 2 + 1] = distortedPx.y - base.y;
      }

      let avgDx = 0, avgDy = 0;
      let fixedCount = 0;
      if (hasFixed) {
        for (let globalIdx = 0; globalIdx < vertexCount; globalIdx++) {
          if (this.fixedVertices.has(globalIdx)) {
            avgDx += rawDeltas[globalIdx * 2];
            avgDy += rawDeltas[globalIdx * 2 + 1];
            fixedCount++;
          }
        }
        if (fixedCount > 0) {
          avgDx /= fixedCount;
          avgDy /= fixedCount;
        }
      }

      for (let globalIdx = 0; globalIdx < vertexCount; globalIdx++) {
        const idx = (frame * vertexCount + globalIdx) * 2;
        if (hasFixed && this.fixedVertices.has(globalIdx)) {
          data[idx] = 0;
          data[idx + 1] = 0;
        } else {
          data[idx] = rawDeltas[globalIdx * 2] - avgDx;
          data[idx + 1] = rawDeltas[globalIdx * 2 + 1] - avgDy;
        }
      }
    }

    const frameSize = vertexCount * 2;
    data.copyWithin((totalFrames - 1) * frameSize, 0, frameSize);

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
    texture.wrapT = THREE.ClampToEdgeWrapping;

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
    if (!this.maskEffect) {
      if (!this._ftxData) return null;
      
      const allRings = this.boundary;
      if (allRings.length === 0 || allRings[0].length < 3) return null;
      
      const allVertices = allRings.flat();
      const vertexCount = allVertices.length;
      this._totalVertices = vertexCount;
      const totalFrames = 60;
      this._numFrames = totalFrames;
      
      const data = new Float32Array(totalFrames * vertexCount * 2);
      
      if (this._displacementTexture) this._displacementTexture.dispose();
      this._displacementTexture = new THREE.DataTexture(
        data,
        vertexCount,
        totalFrames,
        THREE.RGFormat,
        THREE.FloatType
      );
      this._displacementTexture.needsUpdate = true;
      this._displacementTexture.wrapS = THREE.ClampToEdgeWrapping;
      this._displacementTexture.wrapT = THREE.ClampToEdgeWrapping;
      this._displacementTexture.minFilter = THREE.LinearFilter;
      this._displacementTexture.magFilter = THREE.NearestFilter;
      
      this._lastMaskEffectHash = '__default_zero__';
      this._lastCanvasWidth = canvasWidth;
      this._lastCanvasHeight = canvasHeight;
      
      return this._displacementTexture;
    }

    const currentHash = JSON.stringify(this.maskEffect);
    const paramsChanged =
      forceRebuild ||
      this._lastCanvasWidth !== canvasWidth ||
      this._lastCanvasHeight !== canvasHeight ||
      this._lastMaskEffectHash !== currentHash;

    if (paramsChanged || !this._displacementTexture) {
      this.buildDisplacementTexture(canvasWidth, canvasHeight, this.maskEffect, 30);
    }
    return this._displacementTexture;
  }

  public getTotalVertices(): number {
    return this._totalVertices;
  }

  public getNumFrames(): number {
    return this._numFrames + 1;
  }

  public updateDisplacementOnly(canvasWidth: number, canvasHeight: number): void {
    if (!this.maskEffect) return;

    const effectHash = JSON.stringify(this.maskEffect);
    
    if (effectHash === this._lastMaskEffectHash && 
        canvasWidth === this._lastCanvasWidth && 
        canvasHeight === this._lastCanvasHeight &&
        this._displacementTexture) {
      return;
    }

    this.buildDisplacementTexture(canvasWidth, canvasHeight, this.maskEffect, this._numFrames);
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