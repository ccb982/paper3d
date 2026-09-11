// ============================================================
// DroneIcon.ts —— 可露希尔的无人机动态图标
// ★ 复用战斗纹理绘制路径：与战斗实体同款 Asset(scene.zip) +
//   FrameAnimatorBase + DroneCompositeRender（主体 FTXQuad + 双翼
//   VAT），用主渲染器（GameRenderer，main.ts 注入的战斗渲染器）+
//   OffscreenBake（战斗的离屏烘焙 RT 管线）画进 RT → readRenderTargetPixels
//   回读到图标画布。绝不另开 WebGLRenderer（多上下文 = 状态孤岛）。
//  - 背包格子用 toDataURL 快照 → 每次 register 都拷贝最新 staticCanvas
//  - 加工台模块槽是活动 canvas → 30fps 逐帧刷新（翅膀持续抖动）
//  - 无活动画布时停 RAF（保留最后一帧 staticCanvas，重开即续）
//  - 素材/渲染失败 → 色块兜底（不再依赖 fetch 成败，boot 已预热）
// ============================================================

import * as THREE from 'three';
import { FtxAsset, Asset } from '../../vendor/player';
import type { CharacterFxAssetSource } from '../fx/AssetSource';
import { FrameAnimatorBase } from '../fx/FrameAnimatorBase';
import { DroneCompositeRender } from '../render/DroneCompositeRender';
import { OffscreenBake } from '../render/OffscreenBake';
import { getGameRenderer } from '../render/GameRenderer';
import type { ItemManager } from '../../systems/inventory/ItemManager';

/** 图标烘焙分辨率（像素，方形；128 足够 38~64px 显示，回读/拷贝量比 256 少 4 倍） */
const ICON_SIZE = 128;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

/** 素材 / 渲染失败时兜底色（深蓝块，不闪） */
const FALLBACK = { h: 0.6, s: 0.55, l: 0.3 };

/** 公开 begin/end/RT 的离屏烘焙（OffscreenBake 设计为子类使用） */
class IconBake extends OffscreenBake {
  beginBake(): void { this.begin(); }
  endBake(): void { this.end(); }
  get target(): THREE.WebGLRenderTarget { return this.rt; }
}

export class DroneIconAnimator {
  private static instance: DroneIconAnimator | null = null;

  /** 战斗同款素材（main.ts 预热注入，避免重复加载） */
  private asset: Asset | FtxAsset | null = null;
  /** 活动图标画布（断连的由 tick 自动回收） */
  private readonly living: HTMLCanvasElement[] = [];
  /** 最近一帧烘焙结果（静态兜底拷贝源） */
  private staticCanvas: HTMLCanvasElement | null = null;
  /** 最后一次 success 标记（控制错误文本只在从未成功时显示） */
  private everPainted = false;
  private errText = '';

  private anim: FrameAnimatorBase | null = null;
  private drone: DroneCompositeRender | null = null;
  private bake: IconBake | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;

  private rafId = 0;
  private lastT = 0;
  private lastPaint = 0;
  private buf: Uint8Array | null = null;
  /** 像素回读进行中（异步 PBO 路径；防重入，慢时自动降频） */
  private painting = false;
  /** 翻转/上屏复用缓冲（避免每次烘焙都分配） */
  private flipBuf: Uint8ClampedArray | null = null;
  private pixels: ImageData | null = null;

  private constructor() { /* 单例 */ }

  static getInstance(): DroneIconAnimator {
    if (!DroneIconAnimator.instance) DroneIconAnimator.instance = new DroneIconAnimator();
    return DroneIconAnimator.instance;
  }

  /** ★ boot 预热：传入战斗的无人机素材（Asset|FtxAsset），构造渲染并首次烘焙 */
  warm(asset: Asset | FtxAsset): void {
    if (this.asset) return;
    this.asset = asset;
    try {
      this.init();
    } catch (err) {
      this.errText = String(err);
      console.warn('[DroneIcon] 无人机动态图标初始化失败，回退色块:', err);
    }
  }

  /** 注册一个图标画布（立即填最近烘焙帧；未就绪 → 色块兜底） */
  register(itemManager: ItemManager): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d')!;
    if (this.staticCanvas) {
      ctx.drawImage(this.staticCanvas, 0, 0, ICON_SIZE, ICON_SIZE);
    } else {
      // 色块兜底（未就绪或失败时可见）
      const arch = itemManager.getArchetype('kaltsit_drone');
      const c = arch?.color ?? FALLBACK;
      ctx.fillStyle = `hsl(${c.h * 360}, ${c.s * 100}%, ${c.l * 100}%)`;
      ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
      if (this.errText) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.fillText(this.errText.slice(0, 40), 4, 14);
      }
      if (!this.asset) this.warmIfAvailable();
    }

    this.living.push(canvas);
    this.startLoop();
    return canvas;
  }

  /** renderer/素材已就绪但由于某原因未 init 时，尝试补 init */
  private warmIfAvailable(): void {
    if (!this.asset && getGameRenderer()) {
      // 素材还没由 boot 预热（异常路径）：自行加载
      Asset.load(encodeURI('/fx/可露希尔的无人机.scene.zip'))
        .then((a) => { this.asset = a; this.warm(a); })
        .catch((e) => { this.errText = String(e); });
    }
  }

  private init(): void {
    if (!this.asset) return;
    const renderer = getGameRenderer();
    if (!renderer) return; // 主渲染器未注入（不应发生；register 会再试）

    this.scene = new THREE.Scene();
    // ★ 世界单位 ↔ 素材画布像素 1:1：worldWidth = canvasW，相机窗口 = 整幅画布
    //   （双翼按作者摆放位置落在图标两侧，与战斗/原始画布一致）
    const f0 = this.asset.getFtxFrame(0);
    const canvasW = f0?.width || 512;
    this.camera = new THREE.OrthographicCamera(
      -canvasW / 2, canvasW / 2,
      canvasW / 2, -canvasW / 2, -1, 1,
    );

    const anim = new FrameAnimatorBase(this.asset);
    anim.play();
    this.anim = anim;

    this.drone = new DroneCompositeRender(this.scene, this.asset, anim);
    this.drone.setScaleKeepAspect(canvasW);
    this.drone.setPosition(0, 0, 0);
    this.drone.setRenderer(renderer);

    this.bake = new IconBake(renderer, ICON_SIZE, ICON_SIZE);
    this.buf = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);

    this.lastT = performance.now();
    this.lastPaint = 0;
    if (this.living.length > 0) this.startLoop();
    else void this.paintFrame(); // 预热：立刻烘焙一帧供 register 快照
  }

  private startLoop(): void {
    if (this.rafId) return;
    if (!this.anim || !this.drone || !this.bake) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.rafId = 0;
    // 回收断连画布（DOM replaceChildren 后自动移除）
    for (let i = this.living.length - 1; i >= 0; i--) {
      if (!this.living[i].isConnected) this.living.splice(i, 1);
    }
    if (this.living.length === 0) return; // 无活动画布 → 停转（RAF 不再续约）

    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this.lastT) / 1000));
    this.lastT = now;
    if (this.anim) this.anim.update(dt);

    // 30fps 烘焙节流
    if (now - this.lastPaint >= FRAME_MS) {
      void this.paintFrame();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  /** 烘焙一帧：advance → VAT 双翼 → 主渲染器渲进 OffscreenBake RT → 回读像素
   *  ★ 异步 PBO 回读（fence 轮询）替代同步 readRenderTargetPixels，避免卡住 GPU 管线；
   *    回读未完成时跳过本次烘焙（自动降频，不重入） */
  private async paintFrame(): Promise<void> {
    if (this.painting) return;
    const anim = this.anim;
    const drone = this.drone;
    const bake = this.bake;
    const buf = this.buf;
    const scene = this.scene;
    const camera = this.camera;
    if (!anim || !drone || !bake || !buf || !scene || !camera) return;
    const renderer = getGameRenderer();
    if (!renderer) return;
    this.painting = true;

    try {
      const t = performance.now();
      bake.beginBake();
      drone.render({ frameIndex: anim.frameIndex }, null);
      renderer.render(scene, camera);
      bake.endBake();
      this.lastPaint = t;

      try {
        await renderer.readRenderTargetPixelsAsync(
          bake.target, 0, 0,
          ICON_SIZE, ICON_SIZE, buf,
        );
      } catch {
        // 异步路径不可用 → 退回同步（老设备）
        renderer.readRenderTargetPixels(
          bake.target, 0, 0,
          ICON_SIZE, ICON_SIZE, buf,
        );
      }

      // ★ GL 行 0=底部 → canvas 行 0=顶部（与 ftxFrameToCanvas 图标朝向一致）；复用缓冲
      const rowBytes = ICON_SIZE * 4;
      if (!this.flipBuf) this.flipBuf = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
      const flipped = this.flipBuf;
      for (let y = 0; y < ICON_SIZE; y++) {
        const srcRow = y * rowBytes;
        const dstRow = (ICON_SIZE - 1 - y) * rowBytes;
        flipped.set(buf.subarray(srcRow, srcRow + rowBytes), dstRow);
      }
      this.pixels ??= new ImageData(flipped, ICON_SIZE, ICON_SIZE);

      if (!this.staticCanvas) {
        this.staticCanvas = document.createElement('canvas');
        this.staticCanvas.width = ICON_SIZE;
        this.staticCanvas.height = ICON_SIZE;
      }
      this.staticCanvas.getContext('2d')!.putImageData(this.pixels, 0, 0);

      for (const c of this.living) {
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.putImageData(this.pixels, 0, 0);
      }
      this.everPainted = true;
    } catch (err) {
      if (!this.everPainted) this.errText = String(err);
      console.warn('[DroneIcon] 无人机图标烘焙失败，保留色块兜底:', err);
    } finally {
      this.painting = false;
    }
  }

  dispose(): void {
    this.rafId = 0;
    this.drone?.dispose();
    this.drone = null;
    this.bake?.dispose();
    this.bake = null;
    this.scene = null;
    this.camera = null;
    this.anim?.dispose();
    this.anim = null;
    this.asset = null;
    this.living.length = 0;
  }
}

/** 单例访问（main.ts 预热 / 图标注册处用） */
export function getDroneIconAnimator(): DroneIconAnimator {
  return DroneIconAnimator.getInstance();
}