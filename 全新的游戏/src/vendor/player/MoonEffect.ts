// ============================================================
// MoonEffect —— 月亮特效播放器桥接层
// 用特效播放器（Asset + renderFrameData）渲染月亮到离屏纹理，
// 供 SkyDome 采样显示，实现 VAT 顶点动画/扭曲/区域实体等效果。
// ★ 不创建独立 WebGLRenderer，使用主渲染器（避免跨上下文纹理共享问题）。
// ============================================================

import * as THREE from 'three';
import { Asset } from './index';
import { renderFrameData } from './gl/renderer';
import { FramePlaybackController } from './core/controller';

export class MoonEffect {
  readonly asset: Asset;
  /** 离屏渲染目标，每帧由 FX Player 渲染后供 SkyDome 采样 */
  readonly renderTarget: THREE.WebGLRenderTarget;

  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private controller: FramePlaybackController;
  private _vatTime = 0;
  private _vatFps = 30;
  private _disposed = false;
  /** 主渲染器（由 RenderManager.setup 注入），必须与主渲染器共享同一 WebGL 上下文 */
  private _renderer: THREE.WebGLRenderer | null = null;
  /** clear color 恢复缓存（避免每帧 new） */
  private _prevClearColor = new THREE.Color();
  /** 月亮本体宽高比（最长边归一化为 1；SkyDome quad 按此缩放防椭圆变形） */
  private _contentScale = { x: 1, y: 1 };

  constructor(asset: Asset) {
    this.asset = asset;

    // ★ 计算月亮本体包围盒（遍历所有帧所有 region 顶点；标注空间 0..1，Y 向下）
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const frame of asset.frames) {
      for (const ent of frame.regionEntities ?? []) {
        for (const ring of ent.boundary) {
          for (const p of ring) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
        }
      }
    }
    // 兜底：无实体数据 → 全帧
    if (minX >= maxX || minY >= maxY) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    // 外扩 5% 余量：VAT 呼吸位移不裁边
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);

    // 内容宽高比（0..1 标注空间是各向同性的，比例即显示比例）
    const cw = maxX - minX;
    const ch = maxY - minY;
    const m = Math.max(cw, ch);
    this._contentScale = { x: cw / m, y: ch / m };

    // 渲染目标尺寸 = 月亮 bbox 尺寸（与残差纹理对齐）
    const ftx0 = asset.getFtxFrame(0);
    const rtW = ftx0?.bbox.w ?? asset.resolution;
    const rtH = ftx0?.bbox.h ?? asset.resolution;

    // 场景和相机（独立于主渲染器场景，但渲染目标共享上下文）
    this.scene = new THREE.Scene();
    // ★ 相机只覆盖月亮本体包围盒 → 内容填满渲染目标，无空白边缘
    //   （top=minY < bottom=maxY，匹配顶点 Y 向下约定，与全帧 (0,1,0,1) 同形式）
    this.camera = new THREE.OrthographicCamera(minX, maxX, minY, maxY, -1, 1);

    this.renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      stencilBuffer: true,
    });

    // 控制器：循环播放全部帧
    this.controller = asset.createController({ mode: 'loop', speed: 1 });
  }

  /** 月亮本体宽高比（最长边 = 1；SkyDome quad 按此缩放防变形） */
  getContentScale(): { x: number; y: number } {
    return this._contentScale;
  }

  /** 注入主渲染器（由 RenderManager.setup 在创建 Renderer 后调用） */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    this._renderer = renderer;
  }

  /** 每帧推进：更新 VAT 时间 + 帧播放 + 渲染到离屏纹理 */
  update(dt: number): void {
    if (this._disposed) return;
    const renderer = this._renderer;
    if (!renderer) return;

    this._vatTime += dt;
    this.controller.advance(dt);

    const frameIdx = this.controller.frameIndex;
    const data = this.asset.getFrameRenderData(frameIdx);
    if (!data || data.entities.length === 0) return;

    // 保存主渲染器状态
    const prevRt = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    // ★ RT 必须清成透明黑：主渲染器的 clear color 是场景背景色（不透明），
    //   不改会导致月亮圆形外整个方形区域带背景色 → quad 显示出方形边缘
    renderer.setClearColor(0x000000, 0);

    // 先清空渲染目标（确保能看到结果，哪怕是透明背景）
    renderer.setRenderTarget(this.renderTarget);
    renderer.autoClear = true;
    renderer.clear();

    const transform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    renderer.autoClear = false;
    renderFrameData(
      data,
      this._vatTime,
      this._vatFps,
      transform,
      renderer,
      this.scene,
      this.camera,
    );
    renderer.setRenderTarget(prevRt);
    renderer.autoClear = prevAutoClear;
    // 恢复主渲染器背景色（透明黑会破坏场景天空背景 clear）
    renderer.setClearColor(this._prevClearColor, prevClearAlpha);
  }

  /** 供 SkyDome 采样的月亮纹理（每帧由 renderTarget 更新） */
  getMoonTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.asset.disposeController(this.controller);
    this.renderTarget.dispose();
  }
}