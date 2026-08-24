// ============================================================
// SilhouetteShadow —— 实体贴地剪影影子（独立组件，所有实体统一使用）
// ============================================================
// 从实体当前帧纹理提取 alpha 剪影 → 铺在脚下的贴地网格上。
// 形状 = 纹理非透明区域轮廓；位置跟随实体；逐顶点贴地爬坡；可绕 Y 旋转。
//
// 职责边界：
//   - 只做渲染：接收剪影源 + 世界坐标 → 输出暗色剪影面片
//   - 不知道任何游戏逻辑（血量/阵营/AI 等）
//
// 用法（EntityBase.syncShadow 统一驱动，子类只做声明）：
//   const shadow = new SilhouetteShadow(scene, width, depth);
//   shadow.setSource(src);                     // 剪影源变化时（内部去重）
//   shadow.followEntity(x, z, yaw, sampler);   // 每帧同步位置/贴地/朝向
//   shadow.dispose();
// ============================================================

import * as THREE from 'three';

/** ★ 剪影数据源：
 *   - { base }  FTX 帧 DataTexture 数据（每帧提取，内部去重）
 *   - { canvas} 现成剪影画布（多实例共享，如子弹共享一张） */
export type ShadowFrameSource =
  | { base: { width: number; height: number; data: Float32Array } }
  | { canvas: HTMLCanvasElement };

/** 剪影像素（黑色 + alpha 裁形，可直接 putImageData） */
export interface SilhouettePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** ★ 公共工具：从 FTX 帧 DataTexture 逐像素提取 alpha → 黑色剪影像素。
 *  全项目唯一实现（此前 EntityBase/ItemBase/BulletManager/SilhouetteShadow 各有一份拷贝）。
 *  阈值 0.5 与 FTXQuad 的 alpha<0.5 discard 对齐 → 影子形状 = 实际可见像素轮廓。 */
export function extractSilhouette(
  raw: Float32Array,
  bw: number,
  bh: number,
  targetW = 20,
): SilhouettePixels {
  const SW = targetW;
  const SH = Math.max(2, Math.round(SW * bh / bw)) || 2;
  const data = new Uint8ClampedArray(SW * SH * 4);
  for (let sy = 0; sy < SH; sy++) {
    const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh));
    for (let sx = 0; sx < SW; sx++) {
      const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw));
      const o = (ay * bw + ax) * 4;
      const a = Math.max(0, Math.min(1, raw[o + 3]));
      const di = (sy * SW + sx) * 4;
      data[di]     = 0;                          // R=黑（影子色）
      data[di + 1] = 0;                          // G=黑
      data[di + 2] = 0;                          // B=黑
      data[di + 3] = a > 0.5 ? 255 : 0;          // A=剪影裁形
    }
  }
  return { data, width: SW, height: SH };
}

/** ★ 公共工具：提取 → 独立画布（供多实例共享一张剪影，如子弹池） */
export function makeSilhouetteCanvas(
  raw: Float32Array,
  bw: number,
  bh: number,
  targetW = 16,
): HTMLCanvasElement {
  const px = extractSilhouette(raw, bw, bh, targetW);
  const c = document.createElement('canvas');
  c.width = px.width;
  c.height = px.height;
  c.getContext('2d')!.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  return c;
}

export class SilhouetteShadow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private geo: THREE.PlaneGeometry;
  /** 持久内部画布（帧提取写入目标，避免每次新建 canvas） */
  private silCanvas: HTMLCanvasElement | null = null;
  private silCtx: CanvasRenderingContext2D | null = null;
  private alphaTex: THREE.CanvasTexture | null = null;
  /** ★ 去重标记：同一源对象不重复提取 */
  private lastSource: unknown = null;
  private baseOpacity: number;

  constructor(
    scene: THREE.Scene,
    width: number,
    depth: number,
    opacity = 0.38,
  ) {
    // 躺平的网格：宽×深，带分段用于贴地起伏
    this.geo = new THREE.PlaneGeometry(width, depth, 6, 10);
    this.geo.rotateX(-Math.PI / 2);

    this.mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -3,
    });

    this.baseOpacity = opacity;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * ★ 设置剪影源（帧纹理数据或现成画布）。
   * 同一源对象自动跳过（动画帧未变 / 共享画布重复喂入均零开销）。
   */
  setSource(src: ShadowFrameSource | null): void {
    if (!src || src === this.lastSource) return;
    this.lastSource = src;
    if ('canvas' in src) {
      if (this.alphaTex && this.alphaTex.image === src.canvas) return;
      this.alphaTex?.dispose();
      this.alphaTex = new THREE.CanvasTexture(src.canvas);
      this.alphaTex.flipY = false;
      this.mat.map = this.alphaTex;
      this.mat.needsUpdate = true;
      return;
    }
    const b = src.base;
    if (!b?.data) return;
    this.applyPixels(extractSilhouette(b.data, b.width, b.height));
  }

  /** 提取结果写入持久内部画布（尺寸变化时自适应重建贴图） */
  private applyPixels(px: SilhouettePixels): void {
    if (!this.silCanvas) {
      this.silCanvas = document.createElement('canvas');
      this.silCanvas.width = px.width;
      this.silCanvas.height = px.height;
      this.silCtx = this.silCanvas.getContext('2d');
      this.alphaTex = new THREE.CanvasTexture(this.silCanvas);
      this.alphaTex.flipY = false;
      this.mat.map = this.alphaTex;
      this.mat.needsUpdate = true;
    } else if (this.silCanvas.width !== px.width || this.silCanvas.height !== px.height) {
      this.silCanvas.width = px.width;
      this.silCanvas.height = px.height;
    }
    this.silCtx?.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
    this.alphaTex!.needsUpdate = true;
  }

  /**
   * 每帧同步：跟随实体世界坐标，逐顶点贴地爬坡。
   * yaw = 影子绕世界 Y 旋转（弧度）；采样点按同一旋转映射到世界，
   * 保证旋转后的影子仍严格贴合地形。
   */
  followEntity(
    x: number,
    z: number,
    yaw: number,
    sampler: (wx: number, wz: number) => number,
  ): void {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = x + lx * cy + lz * sy;
      const wz = z - lx * sy + lz * cy;
      pos.setY(i, sampler(wx, wz) + 0.04);
    }
    pos.needsUpdate = true;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;
  }

  /** LOD 渐隐（只调透明度；可见性由 EntityBase 统一控制） */
  setLodOpacity(lod: number): void {
    this.mat.opacity = lod >= 3 ? 0 : lod === 2 ? this.baseOpacity * 0.45 : this.baseOpacity;
  }

  dispose(): void {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.alphaTex?.dispose();
    this.silCanvas = null;
    this.silCtx = null;
    this.alphaTex = null;
    this.lastSource = null;
  }
}
