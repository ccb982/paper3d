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
import { stepFluidShared } from '../fx/FluidShared';

const ICON_SIZE = 128;
const FPS = 24;
const FRAME_MS = 1000 / FPS;

/** 最小资产接口（Asset 提供共享/独立流体；FtxAsset 无 → 回退静态图标） */
export interface FluidIconAsset {
  getFtxFrame(i: number): { width?: number; height?: number } | null;
  createAmbientFluidEffect?(renderer: THREE.WebGLRenderer, i: number): FluidEffect | null;
}

interface Group {
  effect: FluidEffect;
  /** ★ true = 本动画器自建（可释放）；false = 资产缓存共享实例（不得 dispose） */
  owned: boolean;
  rt: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.MeshBasicMaterial;
  /** ★ 回读缓冲（ImageData 直接背在其上，零拷贝上屏） */
  buf: Uint8ClampedArray;
  pixels: ImageData;
  canvases: HTMLCanvasElement[];
  /** ★ 异步 PBO 回读进行中（防重入；慢时自动跳过本次烘焙） */
  painting: boolean;
}

class FluidIconAnimator {
  private static instance: FluidIconAnimator | null = null;
  private groups = new Map<FluidIconAsset, Group>();
  private rafId = 0;
  private lastT = 0;
  private lastPaint = 0;
  /** ★ 画布可见性（IntersectionObserver：不可见的生产线跳过推进/烘焙 → 零开销） */
  private io: IntersectionObserver | null = null;
  private visible = new WeakSet<HTMLCanvasElement>();

  static getInstance(): FluidIconAnimator {
    if (!FluidIconAnimator.instance) FluidIconAnimator.instance = new FluidIconAnimator();
    return FluidIconAnimator.instance;
  }

  /** ★ 注册画布可见性跟踪（默认可见，IO 首回调后修正）；可见恢复时若无 RAF 补启动 */
  private trackVisibility(canvas: HTMLCanvasElement): void {
    this.visible.add(canvas);
    if (!this.io && typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        let gained = false;
        for (const en of entries) {
          const c = en.target as HTMLCanvasElement;
          if (en.isIntersecting) {
            if (!this.visible.has(c)) gained = true;
            this.visible.add(c);
          } else {
            this.visible.delete(c);
          }
        }
        if (gained && !this.rafId) this.startLoop();
      });
    }
    this.io?.observe(canvas);
  }

  /** 注册活体流体图标画布；返回 null = 无法建流体（无渲染器/该帧无流体参数）→ 调用方回退静态合成 */
  register(asset: FluidIconAsset, frameIndex = 0): HTMLCanvasElement | null {
    const renderer = getGameRenderer();
    if (!renderer || typeof asset.createAmbientFluidEffect !== 'function') return null;
    let g = this.groups.get(asset);
    if (!g) {
      // ★ 优先复用资产缓存共享实例（与世界里祖宗实体同一份流体 → 全局只一次求解）；
      //   共享不可用时才自建独立实例（并标记 owned，断连后释放）。
      //   注：FtxAsset 的 getFluidEffect 是三参版本（需要 physics），不能直接当共享口用 → 仅认两参版本。
      const src = asset as unknown as {
        getFluidEffect?: (...a: unknown[]) => FluidEffect | null;
        createAmbientFluidEffect?: (r: THREE.WebGLRenderer, i: number) => FluidEffect | null;
      };
      const fxFn = src.getFluidEffect;
      const shared = fxFn && fxFn.length <= 2 ? fxFn.call(asset, frameIndex, renderer) : null;
      const effect = shared
        ?? (src.createAmbientFluidEffect ? src.createAmbientFluidEffect.call(asset, renderer, frameIndex) : null);
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
      const buf = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
      g = {
        effect, owned: !shared, rt, scene, camera, material,
        buf,
        pixels: new ImageData(buf, ICON_SIZE, ICON_SIZE),
        canvases: [],
        painting: false,
      };
      this.groups.set(asset, g);
      this.lastT = performance.now();
      this.lastPaint = 0;
    }
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    g.canvases.push(canvas);
    this.trackVisibility(canvas);
    this.paint(g, true); // 立即出一帧（同步；不等 RAF）
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
        if (!g.canvases[i].isConnected) {
          this.io?.unobserve(g.canvases[i]);
          this.visible.delete(g.canvases[i]);
          g.canvases.splice(i, 1);
        }
      }
      if (g.canvases.length === 0) {
        // ★ 异步回读进行中 → 等它落地再释放（防读到已释放 RT）；下一拍再来
        if (g.painting) { alive = true; continue; }
        // 无画布：自有实例释放；共享实例只丢引用（由资产缓存/世界侧持有）
        if (g.owned) g.effect.dispose();
        g.rt.dispose();
        g.material.dispose();
        this.groups.delete(key);
        continue;
      }
      // ★ 不可见（面板隐藏/滚出视口）→ 跳过推进与烘焙（IO 恢复时补启动）
      let shown = false;
      for (const c of g.canvases) {
        if (this.visible.has(c)) { shown = true; break; }
      }
      if (!shown) continue;
      alive = true;
      stepFluidShared(g.effect, dt);
      if (paintDue) this.paint(g);
    }
    if (paintDue) this.lastPaint = now;
    if (alive) this.rafId = requestAnimationFrame(this.tick);
  };

  /** 合成纹理 → 离屏 RT → 回读像素 → 上屏。
   *  ★ 不做行翻转：合成纹理本就是"显示正确"朝向（世界贴片同纹理直接采样即正），
   *    再翻一次会上下颠倒。
   *  ★ 异步 PBO 回读（fence 轮询）替代同步 readRenderTargetPixels，避免卡住 GPU 管线；
   *    回读未完成时本次烘焙跳过（painting 防重入，自动降频）。
   *  sync=true 仅注册首帧用（同步出一帧，画布立即有内容）。 */
  private paint(g: Group, sync = false): void {
    if (g.painting) return;
    const renderer = getGameRenderer();
    if (!renderer) return;
    g.painting = true;
    try {
      const prev = renderer.getRenderTarget();
      // ★ 透明清屏：图标 RT 背景必须 alpha=0（主渲染器 clearColor 是不透明灰）
      const prevColor = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(g.rt);
      renderer.render(g.scene, g.camera);
      renderer.setRenderTarget(prev);
      renderer.setClearColor(prevColor, prevAlpha);
      if (sync) {
        renderer.readRenderTargetPixels(g.rt, 0, 0, ICON_SIZE, ICON_SIZE, g.buf);
        for (const c of g.canvases) c.getContext('2d')?.putImageData(g.pixels, 0, 0);
        g.painting = false;
        return;
      }
      renderer.readRenderTargetPixelsAsync(g.rt, 0, 0, ICON_SIZE, ICON_SIZE, g.buf)
        .then(() => {
          for (const c of g.canvases) c.getContext('2d')?.putImageData(g.pixels, 0, 0);
        })
        .catch(() => {
          // 异步路径不可用（老设备）→ 退回同步
          try {
            renderer.readRenderTargetPixels(g.rt, 0, 0, ICON_SIZE, ICON_SIZE, g.buf);
            for (const c of g.canvases) c.getContext('2d')?.putImageData(g.pixels, 0, 0);
          } catch { /* RT 可能已释放：忽略 */ }
        })
        .finally(() => { g.painting = false; });
    } catch (e) {
      g.painting = false;
      console.warn('[FluidIcon] 烘焙失败:', e);
    }
  }
}

/** 单例访问（ItemIconRegistry 用） */
export function getFluidIconAnimator(): FluidIconAnimator {
  return FluidIconAnimator.getInstance();
}
