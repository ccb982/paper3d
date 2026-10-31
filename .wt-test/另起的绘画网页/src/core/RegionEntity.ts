import type { Point } from '../types';
import * as THREE from 'three';
import { processMaskRingCPU } from '../utils/gpuMaskProcessor';

export class RegionEntity {
  public readonly id: number;
  public readonly layerId: string;
  public readonly boundary: Point[][];

  public worldBbox: { x: number; y: number; w: number; h: number } | null = null;

  // ★ 帧坐标环境：设置后顶点/位移使用「世界坐标 → bbox 局部像素坐标」
  //   （缩放基准 = bbox 尺寸，绑定后画布尺寸即 bbox 尺寸）的映射，
  //   与 2D 注释覆盖层 worldToCanvas 一致（正圆大小/位置/形状完全重合）。
  public frameContext: {
    rawBbox: { x: number; y: number; w: number; h: number };
  } | null = null;

  public transform = {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    anchor: null as { x: number; y: number } | null,
  };
  public maskEffect: any = null;

  public fixedVertices: Set<number> = new Set();

  private _displacementTexture: THREE.DataTexture | null = null;
  private _numFrames: number = 60;
  private _totalVertices: number = 0;
  private _lastMaskEffectHash: string = '';
  private _lastCanvasWidth: number = 0;
  private _lastCanvasHeight: number = 0;
  private _lastFrameCtxHash: string = '';

  constructor(id: number, layerId: string, boundary: Point[][]) {
    this.id = id;
    this.layerId = layerId;
    this.boundary = boundary;
    this.computeWorldBbox();
  }

  private computeWorldBbox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of this.boundary) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (isFinite(minX)) {
      this.worldBbox = {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      };
    }
  }

  public forceDisplacementRebuild() {
    this._lastMaskEffectHash = '';
    this._lastFrameCtxHash = '';
    this._lastCanvasWidth = -1;
    this._lastCanvasHeight = -1;
    if (this._displacementTexture) this._displacementTexture.dispose();
    this._displacementTexture = null;
  }

  // ========== 位移纹理 ==========

  public buildDisplacementTexture(
    canvasWidth: number,
    canvasHeight: number,
    maskEffect?: any,
    loopFrames: number = 30
  ): THREE.DataTexture {
    // ★ 调试日志：定位参数传递问题
    console.log(`[RegionEntity.buildDisplacementTexture] 输入参数:`);
    console.log(`  loopFrames=${loopFrames}, canvasWidth=${canvasWidth}, canvasHeight=${canvasHeight}`);
    console.log(`  maskEffect:`, JSON.stringify(maskEffect));
    
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
    
    // ★ 调试日志：确认纹理尺寸计算
    console.log(`[RegionEntity.buildDisplacementTexture] 计算结果:`);
    console.log(`  vertexCount=${vertexCount}, totalFrames=${totalFrames}, 纹理尺寸=${vertexCount}×${totalFrames}`);
    
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

      // ★ CPU计算调试：记录第0帧和第1帧的关键数据
      if (frame === 0 || frame === 1) {
        console.log(`[VAT CPU计算] frame=${frame}, t=${t.toFixed(4)}`);
      }

      const distortedWorldAll: Point[] = [];
      for (const ring of allRings) {
        const distorted = processMaskRingCPU(ring, effect, t);
        distortedWorldAll.push(...distorted);
      }

      // ★ CPU计算调试：检查第0帧和第1帧的扭曲结果
      if (frame === 0 || frame === 1) {
        const firstDistorted = distortedWorldAll[0];
        const firstOriginal = allVertices[0];
        console.log(`[VAT CPU计算] frame=${frame} 第1个顶点:`);
        console.log(`  原始坐标: (${firstOriginal.x.toFixed(4)}, ${firstOriginal.y.toFixed(4)})`);
        console.log(`  扭曲后坐标: (${firstDistorted.x.toFixed(4)}, ${firstDistorted.y.toFixed(4)})`);
        console.log(`  偏移: (${(firstDistorted.x - firstOriginal.x).toFixed(6)}, ${(firstDistorted.y - firstOriginal.y).toFixed(6)})`);
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

      // ★ CPU计算调试：检查rawDeltas是否全零
      if (frame === 0 || frame === 1) {
        const hasNonZeroDelta = rawDeltas.some(v => Math.abs(v) > 0.0001);
        const maxDelta = Math.max(...rawDeltas.map(v => Math.abs(v)));
        console.log(`[VAT CPU计算] frame=${frame} rawDeltas:`);
        console.log(`  是否有非零值: ${hasNonZeroDelta}`);
        console.log(`  最大绝对值: ${maxDelta.toFixed(6)}`);
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

    // 使用 FloatType (32位浮点) 确保兼容性，避免 HalfFloatType 在某些浏览器中上传失败
    const texture = new THREE.DataTexture(
      data,
      vertexCount,
      totalFrames,
      THREE.RGFormat,
      THREE.FloatType
    );
    texture.flipY = false; // 关键修复：禁用 Y 轴翻转，保持数据行序与帧索引一致
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    this._lastMaskEffectHash = JSON.stringify(effect);
    this._lastCanvasWidth = canvasWidth;
    this._lastCanvasHeight = canvasHeight;
    this._lastFrameCtxHash = this.frameContext ? JSON.stringify(this.frameContext) : '';
    if (this._displacementTexture) this._displacementTexture.dispose();
    this._displacementTexture = texture;
    
    // ★ 调试日志：确认纹理创建结果
    console.log(`[RegionEntity.buildDisplacementTexture] 纹理创建完成:`);
    console.log(`  纹理尺寸: ${vertexCount} × ${totalFrames}`);
    console.log(`  数据长度: ${data.length}, 期望长度: ${totalFrames * vertexCount * 2}`);
    
    return texture;
  }

  public getDisplacementTexture(
    canvasWidth: number,
    canvasHeight: number,
    forceRebuild: boolean = false
  ): THREE.DataTexture | null {
    if (!this.maskEffect) {
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
      this._displacementTexture.flipY = false; // 关键修复：禁用 Y 轴翻转，保持数据行序与帧索引一致
      this._displacementTexture.needsUpdate = true;
      this._displacementTexture.wrapS = THREE.ClampToEdgeWrapping;
      this._displacementTexture.wrapT = THREE.ClampToEdgeWrapping;
      this._displacementTexture.minFilter = THREE.LinearFilter;
      this._displacementTexture.magFilter = THREE.NearestFilter;

      this._lastMaskEffectHash = '__default_zero__';
      this._lastCanvasWidth = canvasWidth;
      this._lastCanvasHeight = canvasHeight;
      this._lastFrameCtxHash = this.frameContext ? JSON.stringify(this.frameContext) : '';

      return this._displacementTexture;
    }

    const currentHash = JSON.stringify(this.maskEffect);
    const ctxHash = this.frameContext ? JSON.stringify(this.frameContext) : '';
    const paramsChanged =
      forceRebuild ||
      this._lastCanvasWidth !== canvasWidth ||
      this._lastCanvasHeight !== canvasHeight ||
      this._lastMaskEffectHash !== currentHash ||
      this._lastFrameCtxHash !== ctxHash;

    if (paramsChanged || !this._displacementTexture) {
      this.buildDisplacementTexture(canvasWidth, canvasHeight, this.maskEffect, 30);
    }
    return this._displacementTexture;
  }

  public getTotalVertices(): number {
    return this._totalVertices;
  }

  public getNumFrames(): number {
    return this._numFrames;
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

    this.buildDisplacementTexture(canvasWidth, canvasHeight, this.maskEffect, 30);
  }

  // ========== 固定顶点 ==========

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
  }

  public setFixedVertices(indices: number[], fixed: boolean): void {
    for (const idx of indices) {
      if (fixed) {
        this.fixedVertices.add(idx);
      } else {
        this.fixedVertices.delete(idx);
      }
    }
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

  // ========== 序列化 / 生命周期 ==========

  public dispose(): void {
    if (this._displacementTexture) {
      this._displacementTexture.dispose();
      this._displacementTexture = null;
    }
  }

  public serialize(): any {
    return {
      id: this.id,
      layerId: this.layerId,
      boundary: this.boundary,
      transform: this.transform,
      maskEffect: this.maskEffect,
      worldBbox: this.worldBbox,
    };
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
    }
  }

  public get bbox(): { x: number; y: number; w: number; h: number } | null {
    return this.worldBbox;
  }
}
