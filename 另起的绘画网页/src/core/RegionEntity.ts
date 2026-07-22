import type { Point } from '../types';
import * as THREE from 'three';
import { processMaskRingCPU } from '../utils/gpuMaskProcessor';

export class RegionEntity {
  public readonly id: number;
  public readonly layerId: string;
  public readonly boundary: Point[][];

  public worldBbox: { x: number; y: number; w: number; h: number } | null = null;

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

  // ========== 位移纹理 ==========

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

    // 转换为 HalfFloat (16位浮点) 以节省 GPU 显存
    const halfData = THREE.DataUtils.toHalfFloat(data);

    const texture = new THREE.DataTexture(
      halfData,
      vertexCount,
      totalFrames,
      THREE.RGFormat,
      THREE.HalfFloatType
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
      const allRings = this.boundary;
      if (allRings.length === 0 || allRings[0].length < 3) return null;

      const allVertices = allRings.flat();
      const vertexCount = allVertices.length;
      this._totalVertices = vertexCount;
      const totalFrames = 60;
      this._numFrames = totalFrames;

      const data = new Float32Array(totalFrames * vertexCount * 2);
      const halfData = THREE.DataUtils.toHalfFloat(data);

      if (this._displacementTexture) this._displacementTexture.dispose();
      this._displacementTexture = new THREE.DataTexture(
        halfData,
        vertexCount,
        totalFrames,
        THREE.RGFormat,
        THREE.HalfFloatType
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
