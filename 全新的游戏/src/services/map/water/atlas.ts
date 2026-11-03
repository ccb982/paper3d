// ============================================================
// WaterAtlas —— ★「只有一张水纹理」的图集（2026-11-03 用户定）
// ============================================================
// 用户原话：「我要的是**只有一张水纹理**，然后依据**实际的纹理形状**进行裁剪，
//   **渲染全用的同一个离屏水纹理上的一部分**」
//
// ⇒ 设计：
//   · 一张 atlas 纹理（RGBA8 / 或 RGBA16F），所有**小 body** 的水面各占一个 tile。
//   · tile 内容 = 该 body 的**实际水面形状**（水的地方 mask=1）+ 水深 + 岸距。
//   · 主 pass 的几何 = 每个 body 一张**大 quad**（覆盖它在 atlas 里的 tile），
//     顶点带 atlas uv 偏移/缩放；片元按 atlas 采样，mask=0 ⇒ discard。
//   ⇒ 形状来自纹理而不是几何 ⇒ 远景小 body 的几何退化到 4 顶点，
//     且所有远景 body 可合并成 **1 个 mesh / 1 次 draw call**。
//
// ★ 为什么用图集打包（而不是"玩家周围窗口"）：
//   窗口方案下不同 body 会互相重叠（同深度 z-fighting），且窗口外的 body 采不到。
//   打包 ⇒ 每个 body 一块不重叠的矩形，采样毫无歧义。
// ============================================================

import * as THREE from 'three';

export interface AtlasTile {
  /** tile 在 atlas 里的左上角（像素） */
  ox: number; oy: number;
  /** tile 尺寸（像素） */
  sw: number; sh: number;
  /** tile 对应的世界矩形（米） */
  wx0: number; wz0: number; wx1: number; wz1: number;
}

export interface WaterAtlasOpts {
  /** atlas 边长（像素；默认 2048） */
  size?: number;
  /** 每个 body 的 tile 最大边长（像素；默认 128） */
  maxTile?: number;
}

/** 水面 atlas（一张纹理；body → tile） */
export class WaterAtlas {
  readonly size: number;
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  private readonly maxTile: number;
  /** bodyId → tile */
  private readonly tiles = new Map<number, AtlasTile>();
  /** shelf packing 的当前行 */
  private shelfY = 0;
  private shelfX = 0;
  private shelfH = 0;
  /** 下一个可用 tile 的序号（用于稳定排序） */
  private seq = 0;
  private readonly order: { bodyId: number; area: number; seq: number }[] = [];

  constructor(opts: WaterAtlasOpts = {}) {
    this.size = opts.size ?? 2048;
    this.maxTile = opts.maxTile ?? 128;
    this.data = new Uint8Array(this.size * this.size * 4);
    this.texture = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat);
    this.texture.needsUpdate = true;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /** 已分配的 tile 数 */
  get tileCount(): number { return this.tiles.size; }

  /** 取某 body 的 tile */
  tileOf(bodyId: number): AtlasTile | undefined { return this.tiles.get(bodyId); }

  /**
   * 申请一个 tile（按 body 的世界包围盒比例分配像素尺寸）。
   * @param bodyId 水体 id
   * @param wx0/wz0/wx1/wz1 世界矩形
   * @returns tile（分配失败 ⇒ null：atlas 满了）
   */
  alloc(bodyId: number, wx0: number, wz0: number, wx1: number, wz1: number): AtlasTile | null {
    if (this.tiles.has(bodyId)) return this.tiles.get(bodyId)!;
    const w = Math.max(1, wx1 - wx0);
    const h = Math.max(1, wz1 - wz0);
    // 像素尺寸：按世界尺寸等比缩放，受 maxTile 限制（长边）
    const scale = Math.min(this.maxTile / Math.max(w, h), 1 / Math.max(w, h) * 8);
    const sw = Math.max(1, Math.min(this.maxTile, Math.round(w * scale)));
    const sh = Math.max(1, Math.min(this.maxTile, Math.round(h * scale)));
    // shelf packing：当前行放不下 ⇒ 换行
    if (this.shelfX + sw > this.size) { this.shelfY += this.shelfH; this.shelfX = 0; this.shelfH = 0; }
    if (this.shelfY + sh > this.size) return null;   // atlas 满了
    const tile: AtlasTile = { ox: this.shelfX, oy: this.shelfY, sw, sh, wx0, wz0, wx1, wz1 };
    this.shelfX += sw;
    if (sh > this.shelfH) this.shelfH = sh;
    this.tiles.set(bodyId, tile);
    this.order.push({ bodyId, area: w * h, seq: this.seq++ });
    this.texture.needsUpdate = true;
    return tile;
  }

  /**
   * ★ 把某 body 的**实际水面形状**写进它的 tile。
   * @param bodyId 水体 id
   * @param isWater (x,z) → 该点是否在水面上（世界米坐标）
   * @param depthAt (x,z) → 该点的水深（米；不在水上 ⇒ 0）
   * @param worldToPixel tile 内：世界坐标 → 像素坐标
   */
  writeShape(
    bodyId: number,
    isWater: (x: number, z: number) => boolean,
    depthAt: (x: number, z: number) => number,
    worldToPixel: (wx: number, wz: number, tile: AtlasTile) => { px: number; py: number },
  ): void {
    const tile = this.tiles.get(bodyId);
    if (!tile) return;
    const { sw, sh } = tile;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const { wx, wz } = this.pixelToWorld(px, py, tile);
        const i = ((tile.oy + py) * this.size + (tile.ox + px)) * 4;
        const on = isWater(wx, wz);
        if (!on) {
          // 透明（形状外）⇒ 片元 discard
          this.data[i] = 0; this.data[i + 1] = 0; this.data[i + 2] = 0; this.data[i + 3] = 0;
          continue;
        }
        const d = Math.max(0, depthAt(wx, wz));
        this.data[i] = Math.min(255, Math.round((d / 6) * 255));       // R = 水深
        this.data[i + 1] = 255;                                        // G = 形状 mask
        this.data[i + 2] = 0;                                          // B = 备用
        this.data[i + 3] = 255;                                        // A = 有效
      }
    }
    void worldToPixel;
    this.texture.needsUpdate = true;
  }

  /** tile 内：像素 → 世界坐标 */
  pixelToWorld(px: number, py: number, tile: AtlasTile): { wx: number; wz: number } {
    const wx = tile.wx0 + ((px + 0.5) / tile.sw) * (tile.wx1 - tile.wx0);
    const wz = tile.wz0 + ((py + 0.5) / tile.sh) * (tile.wz1 - tile.wz0);
    return { wx, wz };
  }

  /** ★ 顶点用的 atlas uv 变换（偏移 + 缩放；供顶点属性 atlasUv = (off.xy, scale.xy)） */
  uvTransformOf(bodyId: number): { offX: number; offY: number; scaleX: number; scaleY: number } | null {
    const tile = this.tiles.get(bodyId);
    if (!tile) return null;
    return {
      offX: tile.ox / this.size,
      // ★ atlas 的 y 轴向上（DataTexture 默认 flipY=false ⇒ 纹理行号 = v 从上往下）
      offY: 1 - (tile.oy + tile.sh) / this.size,
      scaleX: tile.sw / this.size,
      scaleY: tile.sh / this.size,
    };
  }

  /** 释放 */
  dispose(): void {
    this.texture.dispose();
    this.tiles.clear();
  }
}
