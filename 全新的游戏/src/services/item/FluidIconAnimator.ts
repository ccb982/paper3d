// ============================================================
// FluidIconAnimator —— 资产流体图标的活体画布（背包/加工台/友军列表）
// ============================================================
// 背景：「祖宗」= 单帧 + 流体参数。静态合成帧（compositeFrameToCanvas）没有流体求解，
//   图标是死的。本动画器为资产建独立 FluidEffect（帧自带参数），
//   每拍 step → 合成纹理渲进 128² RT → 回读像素 → putImageData 到注册画布。
// 与 DroneIconAnimator 同构：同资产多画布共享一份求解；断连画布自动回收；
// 无画布 → 停 RAF 并释放该资产的求解/RT。
// ============================================================

import * as THREE from 'three';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import { getGameRenderer } from '../render/GameRenderer';

const ICON_SIZE = 128;
const FPS = 24;
const FRAME_MS = 1000 / FPS;

/** 最小资产接口（Asset 提供 createAmbientFluidEffect；FtxAsset 无 → 回退静态图标） */
export interface FluidIconAsset {
  getFtxFrame(i: number): { width?: number; height?: number } | null;
  createAmbientFluidEffect?(renderer: THREE.WebGLRenderer, i: number): FluidEffect | null;
}

interface Group {
  effect: FluidEffect;
  rt: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.MeshBasicMaterial;
  buf: Uint8Array;
  pixels: ImageData;
  canvases: HTMLCanvasElement[];
}

class FluidIconAnimator {
  private static instance: FluidIconAnimator | null = null;
  private groups = new Map<FluidIconAsset, Group>();
  private rafId = 0;
  private lastT = 0;
  private lastPaint = 0;

  static getInstance(): FluidIconAnimator {
    if (!FluidIconAnimator.instance) FluidIconAnimator.instance = new FluidIconAnimator();
    return FluidIconAnimator.instance;
  }

  /** 注册活体流体图标画布；返回 null = 无法建流体（无渲染器/该帧无流体参数）→ 调用方回退静态合成 */
  register(asset: FluidIconAsset, frameIndex = 0): HTMLCanvasElement | null {
    const renderer = getGameRenderer();
    if (!renderer || typeof asset.createAmbientFluidEffect !== 'function') return null;
    let g = this.groups.get(asset);
    if (!g) {
      const effect = asset.createAmbientFluidEffect(renderer, frameIndex);
      if (!effect) return null;
      const rt = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, { depthBuffer: false });
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: effect.getCompositeTexture() as THREE.Texture | null,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      material.toneMapped = false; // 图标不走 ACES（避免色偏）
      // 帧宽高比适配（contain 到正方形图标）
      const f = asset.getFtxFrame(frameIndex);
      const aspect = f && f.height ? (f.width ?? 1) / f.height : 1;
      const qw = aspect >= 1 ? 1 : aspect;
      const qh = aspect >= 1 ? 1 / aspect : 1;
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(qw, qh), material));
      g = {
        effect, rt, scene, camera, material,
        buf: new Uint8Array(ICON_SIZE * ICON_SIZE * 4),
        pixels: new ImageData(ICON_SIZE, ICON_SIZE),
        canvases: [],
      };
      this.groups.set(asset, g);
      this.lastT = performance.now();
      this.lastPaint = 0;
    }
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    g.canvases.push(canvas);
    this.paint(g); // 立即出一帧（不等 RAF）
    this.startLoop();
    return canvas;
  }

  private startLoop(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.rafId = 0;
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this.lastT) / 1000));
    this.lastT = now;
    const paintDue = now - this.lastPaint >= FRAME_MS;
    let alive = false;
    for (const key of [...this.groups.keys()]) {
      const g = this.groups.get(key);
      if (!g) continue;
      // 断连画布回收（面板关闭）
      for (let i = g.canvases.length - 1; i >= 0; i--) {
        if (!g.canvases[i].isConnected) g.canvases.splice(i, 1);
      }
      if (g.canvases.length === 0) {
        // 无画布：释放该资产的求解/RT（下次注册重建）
        g.effect.dispose();
        g.rt.dispose();
        g.material.dispose();
        this.groups.delete(key);
        continue;
      }
      alive = true;
      g.effect.step(dt);
      if (paintDue) this.paint(g);
    }
    if (paintDue) this.lastPaint = now;
    if (alive) this.rafId = requestAnimationFrame(this.tick);
  };

  /** 合成纹理 → 离屏 RT → 回读像素 → 上屏。
   *  ★ 不做行翻转：合成纹理本就是"显示正确"朝向（世界贴片同纹理直接采样即正），
   *    再翻一次会上下颠倒。 */
  private paint(g: Group): void {
    const renderer = getGameRenderer();
    if (!renderer) return;
    const prev = renderer.getRenderTarget();
    // ★ 透明清屏：图标 RT 背景必须 alpha=0（主渲染器 clearColor 是不透明灰）
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(g.rt);
    renderer.render(g.scene, g.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.readRenderTargetPixels(g.rt, 0, 0, ICON_SIZE, ICON_SIZE, g.buf);
    g.pixels.data.set(g.buf);
    for (const c of g.canvases) {
      c.getContext('2d')?.putImageData(g.pixels, 0, 0);
    }
  }
}

/** 单例访问（ItemIconRegistry 用） */
export function getFluidIconAnimator(): FluidIconAnimator {
  return FluidIconAnimator.getInstance();
}
