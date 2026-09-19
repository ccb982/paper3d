// ============================================================
// CoverRenderer —— 掩体渲染器（程序化灰砖 + 射击孔留缝）
// ============================================================
// 与 CoverEntity 的复合碰撞体**同布局**（下段 / 上段 / 左右立柱；中间留竖向射击孔）：
//   物理上只有穿过孔带才能打到后方，视觉上也是同一面"带孔砖墙"。
// 建造插值：group.scale.y 由 buildProgress 驱动（地基 → 逐渐长高）。
// 贴图：程序化灰色砖块（模块级缓存，所有掩体共享一张）。
// ============================================================

import * as THREE from 'three';
import { FxRendererBase } from './FxRendererBase';

/** 掩体尺寸（世界米；与碰撞体同口径） */
export const COVER_W = 4.0;
export const COVER_H = 3.0;
export const COVER_T = 0.8;
/** 射击孔：宽 / 高度带（★ 对齐**武器/枪口射击线**而非第一人称相机高度：
 *  玩家枪口 ≈ 脚底 +1.1，站立在掩体后 1~3m 时弹道高度 ≈ 1.0~1.3；
 *  孔带 1.0~1.5 让"站姿直射"能穿缝，蹲/远距离仍会被墙挡） */
export const COVER_SLIT_W = 0.5;
export const COVER_SLIT_Y0 = 1.0;
export const COVER_SLIT_Y1 = 1.5;

/** 程序化灰砖贴图（模块级缓存；所有掩体/掩体弹共享） */
let _brickTex: THREE.CanvasTexture | null = null;
export function coverBrickTexture(): THREE.CanvasTexture {
  if (_brickTex) return _brickTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (ctx) {
    // 底：水泥灰
    ctx.fillStyle = '#8b9096';
    ctx.fillRect(0, 0, S, S);
    // 砖块（错缝）+ 深灰勾缝
    const rows = 8;
    const bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 8);
      for (let x = -S / 8; x < S; x += S / 4) {
        const bx = x + off + 2;
        const by = r * bh + 2;
        const bw = S / 4 - 4;
        const bhh = bh - 4;
        const shade = 128 + Math.floor(Math.random() * 26);
        ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 7})`;
        ctx.fillRect(bx, by, bw, bhh);
        // 砖面噪点（旧化）
        ctx.fillStyle = 'rgba(60,62,66,0.16)';
        for (let k = 0; k < 10; k++) {
          ctx.fillRect(bx + Math.random() * bw, by + Math.random() * bhh, 2, 2);
        }
      }
    }
    // 勾缝线
    ctx.strokeStyle = 'rgba(52,55,60,0.55)';
    ctx.lineWidth = 2;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * bh);
      ctx.lineTo(S, r * bh);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  _brickTex = tex;
  return tex;
}

export class CoverRenderer extends FxRendererBase {
  private group: THREE.Group;
  private parts: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    super();
    const g = new THREE.Group();
    this.group = g;
    this.mesh = g as unknown as THREE.Mesh;
    scene.add(g);
    const mat = new THREE.MeshStandardMaterial({
      map: coverBrickTexture(),
      roughness: 0.92,
      metalness: 0.04,
    });
    const add = (w: number, h: number, x: number, y: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, COVER_T), mat);
      m.position.set(x, y, 0);
      g.add(m);
      this.parts.push(m);
    };
    // 与碰撞体同布局：下段 / 上段 / 左右立柱（中间 = 射击孔）
    add(COVER_W, COVER_SLIT_Y0, 0, COVER_SLIT_Y0 / 2);
    add(COVER_W, COVER_H - COVER_SLIT_Y1, 0, (COVER_SLIT_Y1 + COVER_H) / 2);
    const pillarW = (COVER_W - COVER_SLIT_W) / 2;
    const midY = (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2;
    add(pillarW, COVER_SLIT_Y1 - COVER_SLIT_Y0, -(COVER_SLIT_W / 2 + pillarW / 2), midY);
    add(pillarW, COVER_SLIT_Y1 - COVER_SLIT_Y0, +(COVER_SLIT_W / 2 + pillarW / 2), midY);
  }

  /** 朝向（局部 +Z = 墙厚轴/正面法线） */
  setYaw(rad: number): void {
    this.group.rotation.y = rad;
  }

  /** 建造插值（0→1；从地基逐渐长高） */
  setBuildProgress(p: number): void {
    this.group.scale.y = Math.max(0.05, Math.min(1, p));
  }

  override setPosition(x: number, y: number, z = 0): void {
    this.group.position.set(x, y, z);
  }

  override dispose(): void {
    for (const m of this.parts) m.geometry.dispose();
    this.parts = [];
    this.group.parent?.remove(this.group);
    this.mesh = null;
  }
}
