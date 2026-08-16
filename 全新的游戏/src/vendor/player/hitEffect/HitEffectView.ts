// ============================================================
// HitEffectView —— 游戏端矢量动画（击中特效）播放器
// ============================================================
// 与 FTX 贴片管线平行：素材包 hit_effects.json 的形状定义
// （纯色 / FTX 帧纹理填充 + 可选外置残差层）→ 每次播放生成随机
// 变体（旋转 + 径向扭曲 + 外扩）→ 离屏 2D 逐帧烘焙 → 纹理 →
// 世界空间 billboard quad。
// 独立于实体槽：play(x,y,z) 在任何世界坐标播放，播完自回收。

import * as THREE from 'three';
import type { HitEffectShapeExport } from '../core/types';
import { generateVariant, randomSeed, shapeSeed, tickVariant, variantDuration } from './variantGenerator';
import type { EffectShapeDef } from './types';

export interface HitEffectViewOptions {
  /** 世界尺寸（quad 边长，默认 1.5） */
  worldSize?: number;
  /** 离屏 2D 烘焙分辨率（默认 256） */
  bakeSize?: number;
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** FTX 嵌入（baseHsl + 量化残差）→ RGB 画布（CPU 合成一次） */
function buildFtxImage(ftx: NonNullable<HitEffectShapeExport['ftx']>): HTMLCanvasElement {
  const hsl = new Float32Array(base64ToBytes(ftx.baseHslBase64).buffer);
  const res = base64ToBytes(ftx.residualBase64);
  const w = ftx.width, h = ftx.height;
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const baseA = hsl[o + 3];
    if (baseA < 0.5) continue;
    const dH = (res[o] / 255 * 2 - 1) * 0.5;
    const dS = (res[o + 1] / 255 * 2 - 1) * 0.5;
    const dL = (res[o + 2] / 255 * 2 - 1) * 0.5;
    const fh = (hsl[o] + dH + 1) % 1;
    const fs = Math.max(0, Math.min(1, hsl[o + 1] + dS));
    const fl = Math.max(0, Math.min(1, hsl[o + 2] + dL));
    const [r, g, b] = hsl2rgb(fh, fs, fl);
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** 外置残差层 base64 → 画布 */
function buildResidualImage(res: NonNullable<HitEffectShapeExport['residualLayer']>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = res.width; c.height = res.height;
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(base64ToBytes(res.dataBase64)), res.width, res.height),
    0, 0,
  );
  return c;
}

export class HitEffectView {
  private group: THREE.Group;
  private mesh: THREE.Mesh;
  private texture: THREE.Texture;
  private bakeCanvas: HTMLCanvasElement;
  private c2d: CanvasRenderingContext2D;
  private defs: EffectShapeDef[] = [];
  private ftxImages = new Map<string, HTMLCanvasElement>();
  private residualImages = new Map<string, HTMLCanvasElement>();
  private variants: ReturnType<typeof generateVariant>[] = [];
  private totalDuration = 0;
  private elapsed = -1; // <0 = 未开始
  private worldSize: number;
  private bakeSize: number;
  /** ★ 统一烘焙缩放：按「最大轮廓跨度 × 最大外扩 × 旋转余量」预计算，
   *   保证任何变体/任意旋转角都完整落在画布内（不再裁剪溢出） */
  private fitScale = 1;
  /** ★ 跟随偏移（击中点相对被跟随实体的偏移；实体槽每帧传实体位置时叠加） */
  private followOffset = { x: 0, y: 0, z: 0 };

  constructor(scene: THREE.Scene, shapes: HitEffectShapeExport[], options?: HitEffectViewOptions) {
    this.worldSize = options?.worldSize ?? 1.5;
    this.bakeSize = options?.bakeSize ?? 128;

    // 导出形状 → 生成器可消费的 def
    this.defs = shapes.map((sh, i) => ({
      id: i,
      name: sh.name,
      outline: sh.outline,
      fill: sh.solid ?? { h: 0.55, s: 0.8, l: 0.6, a: 1 },
      params: sh.params,
    }));
    for (const sh of shapes) {
      if (sh.fillMode === 'ftx' && sh.ftx) this.ftxImages.set(sh.name, buildFtxImage(sh.ftx));
      if (sh.residualLayer) this.residualImages.set(sh.name, buildResidualImage(sh.residualLayer));
    }

    // ★ 预计算统一缩放基准：最大「轮廓跨度 × 最大外扩目标」，再加旋转余量（√2 ≈ 1.42 + 裕度）。
    //   所有变体/任意旋转角/最大外扩时都不超出画布（修复特效超出纹理边界被裁剪）
    let maxSpan = 1e-6;
    for (const sh of shapes) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of sh.outline) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const span = Math.max(maxX - minX, maxY - minY);
      const maxExpand = Math.max(sh.params.expand.xMax, sh.params.expand.yMax);
      maxSpan = Math.max(maxSpan, span * maxExpand);
    }
    // 画布可用区 = bakeSize - 2×pad；旋转最坏 √2 倍跨度 + 10% 裕度
    const pad = 16;
    this.fitScale = ((this.bakeSize - pad * 2) / (maxSpan * 1.42 * 1.1));

    // 离屏 2D 画布 + 纹理
    this.bakeCanvas = document.createElement('canvas');
    this.bakeCanvas.width = this.bakeSize;
    this.bakeCanvas.height = this.bakeSize;
    this.c2d = this.bakeCanvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.bakeCanvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // 世界空间 billboard quad（深度测试开：被地形遮挡时正确隐藏）
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    // ★ 世界尺寸：quad 缩放 = worldSize（此前漏设，特效一直是 1×1 单位 → 看起来极小）
    this.mesh.scale.set(this.worldSize, this.worldSize, 1);
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    scene.add(this.group);
  }

  /** 在世界坐标开始播放（新随机变体）；可随时重复调用 */
  play(x: number, y: number, z: number): void {
    const seed = randomSeed();
    this.variants = this.defs.map((d, i) => generateVariant(d, shapeSeed(seed, i)));
    this.totalDuration = Math.max(...this.defs.map(variantDuration));
    this.elapsed = 0;
    this.group.position.set(x, y, z);
    this.mesh.visible = true;
  }

  /** ★ 设置跟随偏移：特效位置 = 跟随点 + 偏移。
   *  实体命中时 = 击中点相对实体的偏移（击中点跟着实体走）；
   *  地形/固定点 = 不调用（偏移 0，传固定坐标） */
  setFollowOffset(dx: number, dy: number, dz: number): void {
    this.followOffset.x = dx;
    this.followOffset.y = dy;
    this.followOffset.z = dz;
  }

  /** 每帧推进并跟随传入坐标（EntityEffect 契约：实体槽传入实体位置 = 跟随；
   *  位置 = 传入坐标 + 跟随偏移，命中点随实体移动）。返回 true = 播完（调用方可回收） */
  update(dt: number, x: number, y: number, z: number): boolean {
    if (this.elapsed < 0) return true;
    this.elapsed += dt;
    this.group.position.set(x + this.followOffset.x, y + this.followOffset.y, z + this.followOffset.z);
    if (this.elapsed >= this.totalDuration) {
      this.elapsed = -1;
      this.mesh.visible = false;
      return true;
    }
    this.drawFrame(this.elapsed);
    this.texture.needsUpdate = true;
    return false;
  }

  /** 渲染：billboard 面相机（实体 render 时调用；全轴对相机，玩家视角最大化可见） */
  render(camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
  }

  /** 逐帧 2D 烘焙：所有形状叠加绘制（纯色/FTX 填充 + 残差层 + 轮廓）。
   *  ★ 统一用预计算 fitScale：任意变体/旋转/外扩都不超出画布边界 */
  private drawFrame(t: number): void {
    const c2d = this.c2d;
    const S = this.bakeSize;
    c2d.clearRect(0, 0, S, S);
    const s = this.fitScale;
    for (let i = 0; i < this.defs.length; i++) {
      const sh = this.defs[i];
      const v = this.variants[i];
      const pose = tickVariant(v, t, sh);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of v.vertices) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      c2d.save();
      c2d.translate(S / 2, S / 2);
      c2d.rotate(pose.angle);
      c2d.scale(pose.scaleX, pose.scaleY);
      c2d.translate(-cx * s, -cy * s);
      c2d.beginPath();
      v.vertices.forEach((p, j) => {
        const px = p.x * s, py = p.y * s;
        if (j === 0) c2d.moveTo(px, py); else c2d.lineTo(px, py);
      });
      c2d.closePath();
      const ftxImg = this.ftxImages.get(sh.name);
      const solid = this.defs[i].fill;
      if (ftxImg) {
        c2d.save();
        c2d.clip();
        c2d.imageSmoothingEnabled = false;
        c2d.drawImage(ftxImg, 0, 0, S, S);
        c2d.restore();
      } else {
        const [fr, fg, fb] = hsl2rgb(solid.h, solid.s, solid.l);
        c2d.fillStyle = `rgba(${fr},${fg},${fb},${solid.a ?? 1})`;
        c2d.fill();
      }
      const resImg = this.residualImages.get(sh.name);
      if (resImg) {
        c2d.save();
        c2d.clip();
        c2d.imageSmoothingEnabled = false;
        c2d.drawImage(resImg, 0, 0, S, S);
        c2d.restore();
      }
      c2d.strokeStyle = 'rgba(255,255,255,0.35)';
      c2d.lineWidth = 1;
      c2d.stroke();
      c2d.restore();
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
