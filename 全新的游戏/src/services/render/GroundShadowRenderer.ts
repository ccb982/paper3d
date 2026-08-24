// ============================================================
// GroundShadowRenderer —— 实体贴地剪影影子渲染器（单例）
// ============================================================
// 实体基类在 LOD 范围内把自己的纹理轮廓提交到这里。
// 本类负责：为每个实体维护一个贴地的黑色剪影面片。
//
// 每个实体的影子 = 一个 PlaneGeometry(W, D, 6, 8) 躺平的网格，
//   逐顶点 y = surfaceHeightAt(wx, wz) + 0.03（贴地爬坡），
//   材质 = 黑色 + 实体提供的剪影遮罩纹理作为 map（alpha 裁形）。
// ============================================================

import * as THREE from 'three';
import type { RasterMap } from '../map/RasterMap';

interface ShadowEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export class GroundShadowRenderer {
  private scene: THREE.Scene | null = null;
  private raster: RasterMap | null = null;
  private entries = new Map<number, ShadowEntry>();

  /** 世界初始化时调用一次 */
  init(scene: THREE.Scene, raster: RasterMap): void {
    this.scene = scene;
    this.raster = raster;
  }

  register(id: number): void {
    if (!this.entries.has(id)) {
      // 延迟创建：首次 submit 时才知道尺寸
      this.entries.set(id, null as unknown as ShadowEntry);
    }
  }

  unregister(id: number): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.scene?.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mat.dispose();
      this.entries.delete(id);
    }
  }

  /**
   * 实体每帧调用：更新影子的位置、尺寸和遮罩纹理。
   * 首次调用时自动创建贴地网格面片。
   *
   * @param w 影子宽度（世界单位）≈ 角色宽
   * @param d 影子深度（世界单位）≈ 角色高 × 0.7（朝背后延伸）
   * @param alphaCanvas 剪影遮罩画布（RGB=黑, A=剪影形状），可为 null 表示用默认圆形
   */
  updateEntry(
    id: number,
    x: number,
    z: number,
    w: number,
    d: number,
    alphaCanvas: HTMLCanvasElement | null,
    yaw: number,
  ): void {
    let entry = this.entries.get(id);
    if (!entry || !this.scene || !this.raster) return;

    // ---- 首次创建 ----
    if (!entry.mesh) {
      const geo = new THREE.PlaneGeometry(w, d, 6, 8);
      geo.rotateX(-Math.PI / 2); // 躺平
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.40,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      entry.mesh = mesh;
      entry.mat = mat;
    }

    // ---- 同步位置 + 逐顶点贴地 ----
    entry.mesh.position.set(x, 0, z);
    entry.mesh.rotation.y = yaw;

    // 逐顶点贴地：y = surfaceHeightAt(worldX, worldZ) + 0.03
    const geo = entry.mesh.geometry as THREE.PlaneGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = x + lx;
      const wz = z + lz;
      const gy = this.raster.surfaceHeightAt(wx, wz) + 0.03;
      pos.setY(i, gy);
    }
    pos.needsUpdate = true;

    // ---- 更新 alphaMap（如果实体提供了新的遮罩画布）----
    if (alphaCanvas && entry.mat.alphaMap?.image !== alphaCanvas) {
      // 把实体画布内容绘制到一张共享 CanvasTexture 上
      if (!entry.mat.alphaMap) {
        const tex = new THREE.CanvasTexture(alphaCanvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        entry.mat.alphaMap = tex;
        entry.mat.needsUpdate = true;
      } else {
        // 复制像素到已有纹理
        const tex = entry.mat.alphaMap as THREE.CanvasTexture;
        const tctx = (tex.image as HTMLCanvasElement).getContext('2d');
        if (tctx) {
          tctx.clearRect(0, 0, tex.image.width, tex.image.height);
          tctx.drawImage(alphaCanvas, 0, 0);
          tex.needsUpdate = true;
        }
      }
    }
  }

  dispose(): void {
    for (const [, entry] of this.entries) {
      if (entry.mesh) {
        this.scene?.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mat.dispose();
      }
    }
    this.entries.clear();
    this.scene = null;
    this.raster = null;
  }
}

/** 全局单例 */
export const groundShadowRenderer = new GroundShadowRenderer();


// ============================================================
// 剪影遮罩提取工具（供任何实体调用）
// ============================================================

/**
 * 从 FTX DataTexture 的 bbox 区域提取 alpha 通道到低分辨率遮罩画布。
 * 二值化：alpha > threshold → 白，否则透明。
 * 返回的 CanvasTexture 可直接用作 MeshBasicMaterial.alphaMap。
 */
export function extractSilhouetteMask(
  base: { image: { width: number; height: number; data?: unknown } },
  bx: number, by: number, bw: number, bh: number,
  threshold?: number,
  resW?: number,
): THREE.CanvasTexture | null {
  const th = threshold ?? 0.5;
  const rw = resW ?? 16;
  const data = base.image.data as unknown as Float32Array | undefined;
  if (!data) return null;

  const SW = rw;
  const SH = Math.max(2, Math.round(SW * bh / bw)) || 2;
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(SW, SH);

  for (let sy = 0; sy < SH; sy++) {
    const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh) + by);
    for (let sx = 0; sx < SW; sx++) {
      const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw) + bx);
      const o = (ay * bw + ax) * 4;
      const a = Math.max(0, Math.min(1, data[o + 3]));
      const v = a > th ? 255 : 0;
      const di = (sy * SW + sx) * 4;
      img.data[di]     = v;
      img.data[di + 1] = v;
      img.data[di + 2] = v;
      img.data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  return tex;
}
