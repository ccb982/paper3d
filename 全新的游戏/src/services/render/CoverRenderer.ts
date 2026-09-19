// ============================================================
// CoverRenderer —— 城墙/墙渲染器（程序化灰砖；城墙留射击孔、墙实心）
// ============================================================
// 与 CoverEntity 的复合碰撞体**同布局**（下段 / 上段 / 左右立柱；中间留竖向射击孔）：
//   城墙：物理上只有穿过孔带才能打到后方，视觉上也是同一面"带孔砖墙"；墙：整面实心。
// 建造插值：group.scale.y 由 buildProgress 驱动（地基 → 逐渐长高）。
// 贴图：程序化灰色砖块（模块级缓存，所有掩体共享一张）。
// ============================================================

import * as THREE from 'three';
import { FxRendererBase } from './FxRendererBase';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../item/BasicMaterialsIcons';

/** ★ 背面道具图标贴图缓存（按 URL；异步加载完成后回填材质） */
const _iconTexCache = new Map<string, THREE.CanvasTexture>();
function loadIconTexture(url: string, onReady: (tex: THREE.CanvasTexture) => void): void {
  const cached = _iconTexCache.get(url);
  if (cached) { onReady(cached); return; }
  FtxAsset.load(encodeURI(url))
    .then((asset) => {
      const canvas = compositeFrameToCanvas(asset, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      _iconTexCache.set(url, tex);
      onReady(tex);
    })
    .catch((err) => console.warn(`[CoverRenderer] 背面图标载入失败: ${url}`, err));
}

/** 城墙/墙尺寸（世界米；与碰撞体同口径） */
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
  /** 自建材质（砖面 / 背面图标海报；dispose 时释放） */
  private ownMats: THREE.Material[] = [];

  /** @param slit 是否带射击孔（false = 实心墙「墙」）
   *  @param iconUrl 背面道具图标（城墙 = 不许笑 / 墙 = 土木老姐；null = 不放） */
  constructor(scene: THREE.Scene, slit = true, iconUrl: string | null = null) {
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
    this.ownMats.push(mat);
    const add = (w: number, h: number, x: number, y: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, COVER_T), mat);
      m.position.set(x, y, 0);
      g.add(m);
      this.parts.push(m);
    };
    if (!slit) {
      // 实心墙（土木老姐）：整面
      add(COVER_W, COVER_H, 0, COVER_H / 2);
    } else {
      // 与碰撞体同布局：下段 / 上段 / 左右立柱（中间 = 射击孔）
      add(COVER_W, COVER_SLIT_Y0, 0, COVER_SLIT_Y0 / 2);
      add(COVER_W, COVER_H - COVER_SLIT_Y1, 0, (COVER_SLIT_Y1 + COVER_H) / 2);
      const pillarW = (COVER_W - COVER_SLIT_W) / 2;
      const midY = (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2;
      add(pillarW, COVER_SLIT_Y1 - COVER_SLIT_Y0, -(COVER_SLIT_W / 2 + pillarW / 2), midY);
      add(pillarW, COVER_SLIT_Y1 - COVER_SLIT_Y0, +(COVER_SLIT_W / 2 + pillarW / 2), midY);
    }
    // ★ 背面道具图标（2026-09-19 用户定调）：贴在墙背面（-Z 侧）的"海报"
    //   城墙放在射击孔上方，墙放正中；异步载入，未就绪前不显示
    if (iconUrl) {
      const posterSize = slit ? 1.3 : 2.2;
      const posterY = slit ? 2.2 : 1.5;
      const pm = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide,
      });
      this.ownMats.push(pm);
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(posterSize, posterSize), pm);
      poster.position.set(0, posterY, -COVER_T / 2 - 0.02);
      poster.rotation.y = Math.PI;   // 面向 -Z（背面）
      g.add(poster);
      this.parts.push(poster);
      loadIconTexture(iconUrl, (tex) => {
        pm.map = tex;
        pm.opacity = 0.96;   // 载入完成才显形（未就绪时不出现白方块）
        pm.needsUpdate = true;
      });
    }
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
    for (const m of this.ownMats) m.dispose();
    this.ownMats = [];
    this.group.parent?.remove(this.group);
    this.mesh = null;
  }
}
