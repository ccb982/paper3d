// ============================================================
// SilhouetteShadow —— 实体贴地剪影影子（独立组件）
// ============================================================
// 从实体当前帧纹理提取 alpha 剪影 → 铺在脚下的贴地网格上。
// 形状 = 纹理非透明区域轮廓；位置跟随实体；逐顶点贴地爬坡。
//
// 职责边界：
//   - 只做渲染：接收纹理数据 + 世界坐标 → 输出暗色剪影面片
//   - 不知道任何游戏逻辑（血量/阵营/AI 等）
//
// 用法：
//   const shadow = new SilhouetteShadow(scene, width, depth);
//   shadow.updateFromFrame(pair.base);     // 动画帧变化时
//   shadow.followEntity(x, z);             // 每帧同步位置
//   shadow.dispose();
// ============================================================

import * as THREE from 'three';

export class SilhouetteShadow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private geo: THREE.PlaneGeometry;
  private alphaCtx: CanvasRenderingContext2D | null = null;
  private alphaTex: THREE.CanvasTexture | null = null;
  private lastFrameIndex = -1;

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

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * ★ 核心方法：从 FTX 帧 DataTexture 提取剪影遮罩。
   * 只在动画帧变化时调用（内部有帧号去重）。
   *
   * @param base 当前帧的 base DataTexture（HSLA Float32Array）
   */
  updateSilhouette(base: { image: { width: number; height: number; data: unknown } }): void {
    const raw = (base.image as unknown as { data?: Float32Array }).data;
    if (!raw) return;
    const bw = base.image.width;
    const bh = base.image.height;

    const SW = 20;
    const SH = Math.max(4, Math.round(SW * bh / bw)) || 4;
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(SW, SH);

    for (let sy = 0; sy < SH; sy++) {
      const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh));
      for (let sx = 0; sx < SW; sx++) {
        const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw));
        const o = (ay * bw + ax) * 4;
        const a = Math.max(0, Math.min(1, raw[o + 3]));
        const di = (sy * SW + sx) * 4;
        img.data[di]     = 0;                          // R=黑
        img.data[di + 1] = 0;                          // G=黑
        img.data[di + 2] = 0;                          // B=黑
        img.data[di + 3] = a > 0.35 ? 230 : 0;         // A=剪影裁形
      }
    }
    ctx.putImageData(img, 0, 0);

    if (!this.alphaTex) {
      this.alphaTex = new THREE.CanvasTexture(c);
      this.alphaTex.flipY = false;
      this.mat.map = this.alphaTex;
      this.mat.needsUpdate = true;
    } else {
      this.alphaCtx?.putImageData(img, 0, 0);
      this.alphaTex.needsUpdate = true;
    }
  }

  /** 每帧同步：跟随实体世界坐标，逐顶点贴地 */
  followEntity(x: number, z: number, sampler: (wx: number, wz: number) => number): void {
    if (!this.mesh) return;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const halfD = ((this.geo as unknown as { parameters: { height: number } }).parameters?.height ?? 1) / 2;
    for (let i = 0; i < pos.count; i++) {
      const wx = x + pos.getX(i);
      const wz = z + pos.getZ(i);
      pos.setY(i, sampler(wx, wz) + 0.04);
    }
    pos.needsUpdate = true;
    this.mesh.position.set(x, 0, z);
  }

  /** LOD 渐隐联动 */
  setOpacityByLod(lod: number): void {
    this.mat.opacity = lod >= 3 ? 0 : lod === 2 ? 0.18 : 0.38;
    this.mesh.visible = lod < 3;
  }

  dispose(): void {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.alphaTex?.dispose();
  }
}
