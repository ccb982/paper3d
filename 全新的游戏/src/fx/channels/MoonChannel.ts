// ============================================================
// src/fx/channels/MoonChannel —— 月亮 VAT 播放 + 离屏 RT（vat 通道特例）
// ============================================================
// 播放生命周期（帧控制器 / VAT 时间 / RT / 相机 / 渲染器状态保存）归本类所有；
// 数据来源通过 MoonSource 抽象（由 MoonSourceFromAsset 包装 vendor Asset）。
// ============================================================

import * as THREE from 'three';
import { MOON_PROBE, moonProbe, nowMs } from '../../services/debug/RuntimeProbe';

/** 帧控制器最小契约（与 vendor FramePlaybackController 结构兼容） */
export interface MoonControllerLike {
  advance(dt: number): void;
  readonly frameIndex: number;
}

/** 帧渲染数据最小契约（运行时只关心是否有实体可画） */
export interface MoonFrameDataLike {
  readonly entities: readonly unknown[];
}

/** 月亮区域实体（标注空间 0..1，Y 向下） */
export interface MoonRegionEntityLike {
  readonly boundary: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
}

export interface MoonFrameLike {
  readonly regionEntities?: ReadonlyArray<MoonRegionEntityLike>;
}

/** 数据侧抽象：由 MoonSourceFromAsset 包装 vendor Asset */
export interface MoonSource {
  readonly frameCount: number;
  readonly resolution: number;
  readonly frames: ReadonlyArray<MoonFrameLike>;
  getFtxBBox(index: number): { w: number; h: number } | null;
  createController(): MoonControllerLike;
  getFrameRenderData(index: number): MoonFrameDataLike | null;
  disposeController(controller: MoonControllerLike): void;
}

/** GPU 后端：由 MoonSourceFromAsset 桥接 vendor 的 renderFrameData */
export interface MoonRenderBackend {
  renderFrameData(
    data: MoonFrameDataLike,
    vatTime: number,
    vatFps: number,
    transform: {
      position: { x: number; y: number; z: number };
      scale: { x: number; y: number };
      rotation: number;
    },
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.OrthographicCamera,
    /** ★ 呼吸扭曲时间（与 VAT 几何帧解耦；缺省=vatTime） */
    distortTime?: number,
  ): void;
}

/** SkyDome / RenderManager 只依赖这个接口，不再依赖 vendor MoonEffect 类型 */
export interface MoonView {
  setRenderer(renderer: THREE.WebGLRenderer): void;
  /** animate=false：低耗期（航行/舰内）冻结动画；但未产出首帧内容前仍必须渲染一次 */
  update(dt: number, animate?: boolean): void;
  getMoonTexture(): THREE.Texture;
  getContentScale(): { x: number; y: number };
  dispose(): void;
}

export class MoonChannel implements MoonView {
  /** 离屏渲染目标，每帧由本通道渲染后供 SkyDome 采样 */
  readonly renderTarget: THREE.WebGLRenderTarget;

  private readonly source: MoonSource;
  private readonly backend: MoonRenderBackend;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controller: MoonControllerLike;
  private readonly _vatFps = 30;
  private readonly _contentScale: { x: number; y: number };
  /** VAT 几何帧时间：可冻结在「能画出内容」的相位（不再随帧推进） */
  private _vatTime = 0;
  /** ★ 呼吸扭曲时间：与几何帧解耦，始终按真实时间推进（保住动态观感） */
  private _distortTime = 0;
  private _disposed = false;
  /** 是否已成功产出至少一帧 RT 内容（插桩/健康检查；不再用于跳过渲染） */
  private _hasFrame = false;
  /** 插桩：RT 像素采样节流计数 */
  private _probeFrame = 0;
  /** 主渲染器（由 SkyDome.setup 注入），必须与主渲染器共享同一 WebGL 上下文 */
  private _renderer: THREE.WebGLRenderer | null = null;
  private _prevClearColor = new THREE.Color();

  constructor(source: MoonSource, backend: MoonRenderBackend) {
    this.source = source;
    this.backend = backend;

    // 月亮本体包围盒（遍历所有帧所有 region 顶点；标注空间 0..1，Y 向下）
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const frame of source.frames) {
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

    // 内容宽高比（0..1 标注空间各向同性，比例即显示比例）
    const cw = maxX - minX;
    const ch = maxY - minY;
    const m = Math.max(cw, ch);
    this._contentScale = { x: cw / m, y: ch / m };

    // 渲染目标尺寸 = 月亮 bbox 尺寸（与残差纹理对齐）
    const bbox = source.getFtxBBox(0);
    const rtW = bbox?.w ?? source.resolution;
    const rtH = bbox?.h ?? source.resolution;

    // 相机只覆盖月亮本体包围盒 → 内容填满渲染目标，无空白边缘
    this.camera = new THREE.OrthographicCamera(minX, maxX, minY, maxY, -1, 1);

    this.renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      stencilBuffer: true,
    });

    this.controller = source.createController();
  }

  getContentScale(): { x: number; y: number } {
    return this._contentScale;
  }

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this._renderer = renderer;
  }

  /** 每帧推进 + 渲染到离屏纹理
   *  ★ 时间推进与几何帧解耦（2026-11-09）：
   *    - 呼吸扭曲(_distortTime)每帧推进 —— 低耗期也推进，否则 shader 扭曲被冻住；
   *    - VAT 几何帧(_vatTime)只在 animate=true 时推进；当前 RenderManager 固定传 false，
   *      即几何帧锁定在 vat≈0（实测该相位 RT alpha 满，不出现周期性清空窗口）。
   *  ⚠️ 低耗期不能跳过渲染：RT 是「更新即渲染」型，跳过会让扭曲一起停住
   *     （用户已确认"月亮 UV 扭曲没了"就是这个原因）。 */
  update(dt: number, animate = true): void {
    if (this._disposed) return;
    const renderer = this._renderer;
    if (MOON_PROBE) {
      moonProbe.updateCalls++;
      moonProbe.rtW = this.renderTarget.width;
      moonProbe.rtH = this.renderTarget.height;
    }
    if (!renderer) {
      if (MOON_PROBE) moonProbe.updateNoRenderer++;
      return;
    }
    // ★ 插桩：无论本帧是否渲染，都定期读回 RT —— 直接回答「RT 到底是不是全 0」，
    //   而不是只在渲染成功时采样（那样恰好会漏掉「从没画过」的情况）。
    if (MOON_PROBE) this._probeSampleRT(renderer);

    // ★ 扭曲时间：始终推进（与几何帧无关）
    this._distortTime += dt;
    if (MOON_PROBE) moonProbe.distortTime = this._distortTime;
    // ★ 几何帧：仅在 animate=true 时推进（生产路径固定 false → 锁定在安全相位）
    if (animate) {
      this._vatTime += dt;
      this.controller.advance(dt);
    }
    // ★ 插桩强制值（?fxProbe=1 时通过 window.__moonProbe 注入；默认 null=不干预）
    if (MOON_PROBE) {
      if (moonProbe.forceVat !== null) this._vatTime = moonProbe.forceVat;
      if (moonProbe.forceDistort !== null) this._distortTime = moonProbe.forceDistort;
    }

    const data = this.source.getFrameRenderData(this.controller.frameIndex);
    if (MOON_PROBE) moonProbe.entries = data ? data.entities.length : -1;
    if (!data || data.entities.length === 0) {
      if (MOON_PROBE) moonProbe.updateNoEntities++;
      return;
    }

    const t0 = MOON_PROBE ? nowMs() : 0;

    // 保存主渲染器状态
    const prevRt = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    // RT 必须清成透明黑：主渲染器 clear color 是场景背景色（不透明），
    // 不改会导致月亮圆形外整个方形区域带背景色 → quad 显示方形边缘
    renderer.setClearColor(0x000000, 0);

    renderer.setRenderTarget(this.renderTarget);
    renderer.autoClear = true;
    renderer.clear();

    renderer.autoClear = false;
    this.backend.renderFrameData(
      data,
      this._vatTime,
      this._vatFps,
      {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      },
      renderer,
      this.scene,
      this.camera,
      this._distortTime,
    );

    renderer.setRenderTarget(prevRt);
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this._prevClearColor, prevClearAlpha);
    this._hasFrame = true;

    if (MOON_PROBE) {
      const ms = nowMs() - t0;
      moonProbe.renders++;
      moonProbe.renderMs += ms;
      moonProbe.lastRenderMs = ms;
      moonProbe.hasFrame = true;
    }
  }

  /** ★ 插桩（?fxMoonDebug / ?fxProbe）：每 30 次 update 读回 RT 中心 32×32，
   *  统计「非零 alpha 像素数 / 最大 RGB / 像素签名 / 读回耗时」
   *  → 判断是画进去了还是全 0，以及扭曲是否真的在动（sig 变化）。 */
  private _probeSampleRT(renderer: THREE.WebGLRenderer): void {
    this._probeFrame++;
    if (this._probeFrame % Math.max(1, moonProbe.sampleEvery) !== 0) return;
    moonProbe.vat = this._vatTime;
    moonProbe.frame = this.controller.frameIndex;
    const w = Math.min(32, this.renderTarget.width);
    const h = Math.min(32, this.renderTarget.height);
    const buf = new Uint8Array(w * h * 4);
    const rt0 = nowMs();
    try {
      // ★ 先绑回默认帧缓冲再读，避免与当前绑定的 RT 形成反馈
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(null);
      renderer.readRenderTargetPixels(
        this.renderTarget,
        Math.floor((this.renderTarget.width - w) / 2),
        Math.floor((this.renderTarget.height - h) / 2),
        w, h, buf,
      );
      renderer.setRenderTarget(prev);
      let alphaHits = 0;
      let maxRgb = 0;
      // ★ 像素签名：扭曲在动 ⇔ 同一区域的像素值随时间变化（alpha 不能证明"在动"）
      let sig = 0;
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i + 3] > 0) alphaHits++;
        const rgb = Math.max(buf[i], buf[i + 1], buf[i + 2]);
        if (rgb > maxRgb) maxRgb = rgb;
        sig = (sig * 31 + buf[i] + buf[i + 1] * 3 + buf[i + 2] * 7 + buf[i + 3] * 11) >>> 0;
      }
      moonProbe.sample = { alphaHits, total: w * h, maxRgb, ms: nowMs() - rt0, sig };
    } catch {
      moonProbe.sample = { alphaHits: -1, total: w * h, maxRgb: -1, ms: nowMs() - rt0, sig: -1 };
    }
  }

  /** 供 SkyDome 采样的月亮纹理（每帧由 renderTarget 更新） */
  getMoonTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.source.disposeController(this.controller);
    this.renderTarget.dispose();
  }
}
