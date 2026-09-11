// ============================================================
// DynamicIconAnimator —— 动态图标统一封装（离屏渲染 → 活动画布）
// ============================================================
// 通用生产线：任意素材（VAT 区域实体 + 流体）→ 克隆网格/材质离屏渲染 → 回读上屏。
//   · 每个素材一份 Producer：克隆素材本帧的区域实体（fill 模板 + color 采样）、
//     独立流体实例（周期 reset 循环，不会衰减黑屏）、自身 RT 与适配参数；
//   · 多画布共享同一 Producer；断连画布自动回收；无画布停 RAF；
//   · 克隆网格/材质 → 与战斗中的同素材实例（BulletVisual / DroneCompositeRender）零干扰。
//
// 图标家族（ItemIconRegistry 统一出口 createIconElement 按 itemId 路由）：
//   · 无人机        → DroneIconAnimator（三图层 + 翅膀 VAT 专线）
//   · 祖宗          → FluidIconAnimator（与世界实体共享同一份流体，只求解一次）
//   · 其它注册素材  → 本类（registerDynamicIcon：VAT + 流体通用线）
// ============================================================

import * as THREE from 'three';
import type { FtxAsset } from '../../vendor/player/FtxAsset';
import type { Asset } from '../../vendor/player';
import type { FrameAssetSource } from '../fx/AssetSource';
import type { EntityMeshData } from '../../vendor/player/gl/renderer';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import { OffscreenBake } from '../render/OffscreenBake';
import { FTXQuad } from '../render/FTXQuad';
import { getGameRenderer } from '../render/GameRenderer';
import { fluidSteppedRecently } from '../fx/FluidShared';

const ICON_SIZE = 128;
const FPS = 24;
const FRAME_MS = 1000 / FPS;
/** 循环周期（秒）：到点 reset 流体，恢复初始残差重新流动（像连发） */
const LOOP_SEC = 1.5;
/** ★ 兜底路径（无区域实体素材）的帧序列播放速度（如 3 帧装饰类图标） */
const FRAME_FPS = 8;

/** 公开 begin/end/RT 的离屏烘焙（OffscreenBake 设计为子类使用） */
class IconBake extends OffscreenBake {
  beginBake(): void { this.begin(); }
  endBake(): void { this.end(); }
  get target(): THREE.WebGLRenderTarget { return this.rt; }
}

/** 单素材的离屏生产线 + 其上挂载的活动画布 */
interface Producer {
  fluid: FluidEffect | null;
  /** true = 资产缓存共享实例（与世界同一份；世界驱动时图标让出驱动权） */
  sharedFluid: boolean;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  bake: IconBake;
  /** VAT 实体路径（克隆体） */
  fillObjs: THREE.Mesh[];
  meshObjs: THREE.Mesh[];
  meshMats: THREE.ShaderMaterial[];
  fillMats: THREE.ShaderMaterial[];
  /** 兜底两贴片路径（无区域实体） */
  quadBase: FTXQuad | null;
  quadFluid: FTXQuad | null;
  baseTex: THREE.Texture | null;
  residualTex: THREE.Texture | null;
  /** ★ 素材总帧数（兜底路径按 FRAME_FPS 循环播放；VAT 路径由 uTime 驱动） */
  frameCount: number;
  /** RT 尺寸与回读/适配缓冲 */
  srcW: number;
  srcH: number;
  buf: Uint8Array;
  flip: Uint8ClampedArray;
  srcCanvas: HTMLCanvasElement;
  srcCtx: CanvasRenderingContext2D | null;
  srcPixels: ImageData;
  fitX: number;
  fitY: number;
  fitW: number;
  fitH: number;
  /** 挂载的画布 */
  canvases: HTMLCanvasElement[];
  loopAccum: number;
  lastPaint: number;
}

class DynamicIconAnimator {
  private static instance: DynamicIconAnimator | null = null;

  /** 素材 → 生产线（WeakMap：随素材回收，不泄漏） */
  private producers = new WeakMap<object, Producer>();
  private rafId = 0;
  private lastT = 0;

  static getInstance(): DynamicIconAnimator {
    if (!DynamicIconAnimator.instance) DynamicIconAnimator.instance = new DynamicIconAnimator();
    return DynamicIconAnimator.instance;
  }

  /** 注册活动画布（未注入渲染器/构建失败 → null，调用方回退静态图标） */
  register(asset: Asset | FtxAsset, frameIndex = 0): HTMLCanvasElement | null {
    const renderer = getGameRenderer();
    if (!renderer) return null;
    const key = asset as unknown as object;
    let p = this.producers.get(key);
    if (!p) {
      let built: Producer | null = null;
      try {
        built = this.buildProducer(asset, frameIndex, renderer);
      } catch (e) {
        console.warn('[DynamicIcon] 生产线构建失败:', e);
        return null;
      }
      if (!built) return null;
      this.producers.set(key, built);
      p = built;
    }
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    p.canvases.push(canvas);
    this.paint(p);
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

    let alive = false;
    // WeakMap 不可枚举 → 用强引用列表遍历（条目 = 已注册素材数，极少）
    for (const p of this.list) {
      for (let i = p.canvases.length - 1; i >= 0; i--) {
        if (!p.canvases[i].isConnected) p.canvases.splice(i, 1);
      }
      if (p.canvases.length === 0) continue;
      alive = true;
      this.advance(p, dt);
      if (now - p.lastPaint >= FRAME_MS) {
        this.paint(p);
        p.lastPaint = now;
      }
    }
    if (alive) this.rafId = requestAnimationFrame(this.tick);
  };

  /** 流体推进 + 周期 reset（连发式循环；无流体则纯 VAT/base 静态画面）
   *  ★ 共享流体且世界侧正在驱动（BulletManager 等）→ 图标只显示，不 step/不 reset：
   *    避免双份求解、也避免把飞行中的弹体流体重置。 */
  private advance(p: Producer, dt: number): void {
    if (!p.fluid) return;
    if (p.sharedFluid && fluidSteppedRecently(p.fluid)) return;
    p.loopAccum += dt;
    if (p.loopAccum >= LOOP_SEC) {
      p.loopAccum = 0;
      try { p.fluid.solver.reset(); } catch { /* 保持现状 */ }
      p.fluid.step(1 / 60);
      return;
    }
    p.fluid.step(dt);
  }

  /** 渲染（VAT 两遍 / 兜底两贴片）→ 回读 → contain 上屏 */
  private paint(p: Producer): void {
    const renderer = getGameRenderer();
    if (!renderer) return;
    const useFluid = !!p.fluid;
    const fluidTex = p.fluid?.getCompositeTexture() ?? null;
    const time = performance.now() / 1000;
    try {
      if (p.meshObjs.length > 0) {
        // 与 BulletVisual 同款 uniforms
        for (let i = 0; i < p.meshObjs.length; i++) {
          const fm = p.fillMats[i];
          if (fm.uniforms.uTime) fm.uniforms.uTime.value = time;
          if (fm.uniforms.uFramesPerSecond) fm.uniforms.uFramesPerSecond.value = 30;
          const cm = p.meshMats[i];
          if (cm.uniforms.uTime) cm.uniforms.uTime.value = time;
          if (cm.uniforms.uFramesPerSecond) cm.uniforms.uFramesPerSecond.value = 30;
          if (cm.uniforms.uBaseTexture) cm.uniforms.uBaseTexture.value = p.baseTex;
          if (cm.uniforms.uResidual) cm.uniforms.uResidual.value = p.residualTex;
          if (cm.uniforms.uUseFluid) cm.uniforms.uUseFluid.value = useFluid ? 1 : 0;
          if (useFluid && cm.uniforms.uFluidTex) cm.uniforms.uFluidTex.value = fluidTex;
          if (cm.uniforms.uDistortEnabled) cm.uniforms.uDistortEnabled.value = 0;
        }
        // ① fill 遍（写模板） ② color 遍（模板裁剪内采样）
        const gl = renderer.getContext();
        gl.enable(gl.STENCIL_TEST);
        p.bake.beginBake();
        for (const m of p.fillObjs) m.visible = true;
        renderer.render(p.scene, p.camera);
        for (const m of p.fillObjs) m.visible = false;
        renderer.render(p.scene, p.camera);
        for (const m of p.fillObjs) m.visible = true;
        p.bake.endBake();
        gl.disable(gl.STENCIL_TEST);
      } else {
        // ★ 多帧素材：按 FRAME_FPS 循环帧序列（3 帧装饰类等；单帧恒 0）
        const fi = p.frameCount > 1 ? Math.floor(time * FRAME_FPS) % p.frameCount : 0;
        p.quadBase?.render({ frameIndex: fi });
        p.quadFluid?.render({ frameIndex: fi }, fluidTex);
        p.bake.beginBake();
        renderer.render(p.scene, p.camera);
        p.bake.endBake();
      }

      renderer.readRenderTargetPixels(p.bake.target, 0, 0, p.srcW, p.srcH, p.buf);
      // GL 行 0=底部 → canvas 行 0=顶部
      const row = p.srcW * 4;
      for (let y = 0; y < p.srcH; y++) {
        const srcY = y * row;
        const dstY = (p.srcH - 1 - y) * row;
        p.flip.set(p.buf.subarray(srcY, srcY + row), dstY);
      }
      p.srcPixels.data.set(p.flip);
      p.srcCtx?.putImageData(p.srcPixels, 0, 0);
      for (const c of p.canvases) {
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(p.srcCanvas, p.fitX, p.fitY, p.fitW, p.fitH);
      }
    } catch (e) {
      console.warn('[DynamicIcon] 烘焙失败:', e);
    }
  }

  /** 构建单素材生产线（克隆网格/材质；独立流体） */
  private buildProducer(asset: Asset | FtxAsset, frameIndex: number, renderer: THREE.WebGLRenderer): Producer | null {
    const src = asset as unknown as FrameAssetSource & {
      getFtxFrame?: (i: number) => { bbox: { x: number; y: number; w: number; h: number } } | null;
      getFrameRenderData?: (i: number) => { entities?: EntityMeshData[] } | null;
    };
    const f = src.getFtxFrame?.(frameIndex);
    if (!f?.bbox) return null;
    const srcW = Math.max(1, f.bbox.w);
    const srcH = Math.max(1, f.bbox.h);

    const pair = (src as unknown as {
      getFramePair?: (i: number) => { base?: THREE.Texture; residual?: THREE.Texture } | null;
    }).getFramePair?.(frameIndex) ?? null;
    if (!pair?.base) return null;

    // ★ 优先复用资产缓存共享流体（与世界子弹/实体同一实例 → 全局只一次求解）；
    //   不可用（无两参 getFluidEffect / 异常）才自建独立实例。
    const anyAsset = asset as unknown as {
      getFluidEffect?: (...a: unknown[]) => FluidEffect | null;
      createAmbientFluidEffect?: (r: THREE.WebGLRenderer, i: number) => FluidEffect | null;
    };
    let fluid: FluidEffect | null = null;
    let sharedFluid = false;
    try {
      const fx = anyAsset.getFluidEffect;
      if (fx && fx.length <= 2) {
        fluid = fx.call(asset, frameIndex, renderer);
        sharedFluid = !!fluid;
      }
      if (!fluid) fluid = anyAsset.createAmbientFluidEffect?.(renderer, frameIndex) ?? null;
    } catch {
      fluid = null;
      sharedFluid = false;
    }

    const scene = new THREE.Scene();
    const fillObjs: THREE.Mesh[] = [];
    const meshObjs: THREE.Mesh[] = [];
    const meshMats: THREE.ShaderMaterial[] = [];
    const fillMats: THREE.ShaderMaterial[] = [];
    let quadBase: FTXQuad | null = null;
    let quadFluid: FTXQuad | null = null;
    let camera: THREE.OrthographicCamera;

    const srcEntities = src.getFrameRenderData?.(frameIndex)?.entities ?? [];
    if (srcEntities.length > 0) {
      // ★ VAT 实体路径：克隆网格/材质（不干扰战斗中的同素材实例）
      camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
      for (const em of srcEntities) {
        const mesh = em.mesh.clone();
        const mm = (em.mesh.material as THREE.ShaderMaterial).clone();
        mesh.material = mm;
        const fill = em.fillMesh.clone();
        const fm = (em.fillMesh.material as THREE.ShaderMaterial).clone();
        fill.material = fm;
        // 与 BulletVisual 同款规范化（贴片空间 0..1、无 UV 变换、扭曲交给 shader/VAT）
        if (mm.uniforms.uBboxOffset) (mm.uniforms.uBboxOffset.value as THREE.Vector2).set(0, 0);
        if (mm.uniforms.uBboxScale) (mm.uniforms.uBboxScale.value as THREE.Vector2).set(1, 1);
        if (mm.uniforms.uTexOffset) (mm.uniforms.uTexOffset.value as THREE.Vector2).set(0, 0);
        if (mm.uniforms.uTexScale) (mm.uniforms.uTexScale.value as THREE.Vector2).set(1, 1);
        if (mm.uniforms.uTexRotation) mm.uniforms.uTexRotation.value = 0;
        if (mm.uniforms.uDistortEnabled) mm.uniforms.uDistortEnabled.value = 0;
        fill.position.set(0, 0, 0);
        fill.scale.set(1, 1, 1);
        fill.quaternion.identity();
        mesh.position.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        mesh.quaternion.identity();
        scene.add(fill);
        scene.add(mesh);
        fillObjs.push(fill);
        meshObjs.push(mesh);
        meshMats.push(mm);
        fillMats.push(fm);
      }
    } else {
      // ★ 兜底：无区域实体 → 底座 + 流体两层贴片（正方形视口）
      const half = Math.max(srcW, srcH) / 2;
      camera = new THREE.OrthographicCamera(-half, half, half, -half, -1, 1);
      const mapping = { width: srcW, height: srcH };
      quadBase = new FTXQuad(scene, src as never);
      quadBase.setAnchorBottom(false);
      quadBase.setPosition(0, 0, 0);
      quadBase.setFrameMapping(mapping, { x: 0, y: 0, w: srcW, h: srcH });
      quadBase.setScale(srcW, srcH);
      quadFluid = new FTXQuad(scene, src as never);
      quadFluid.setAnchorBottom(false);
      quadFluid.setPosition(0, 0, 0);
      quadFluid.setFrameMapping(mapping, { x: 0, y: 0, w: srcW, h: srcH });
      quadFluid.setScale(srcW, srcH);
      quadFluid.setFluidClipToBase(true);
    }

    // 源画布（RT 像素）→ contain 适配到 128²
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const s = Math.min(ICON_SIZE / srcW, ICON_SIZE / srcH);
    const fitW = Math.max(1, Math.round(srcW * s));
    const fitH = Math.max(1, Math.round(srcH * s));

    const producer: Producer = {
      fluid, sharedFluid, scene, camera,
      bake: new IconBake(renderer, srcW, srcH),
      fillObjs, meshObjs, meshMats, fillMats, quadBase, quadFluid,
      baseTex: pair.base, residualTex: pair.residual ?? null,
      frameCount: Math.max(1, src.frameCount ?? 1),
      srcW, srcH,
      buf: new Uint8Array(srcW * srcH * 4),
      flip: new Uint8ClampedArray(srcW * srcH * 4),
      srcCanvas,
      srcCtx: srcCanvas.getContext('2d'),
      srcPixels: new ImageData(srcW, srcH),
      fitX: Math.round((ICON_SIZE - fitW) / 2),
      fitY: Math.round((ICON_SIZE - fitH) / 2),
      fitW, fitH,
      canvases: [],
      loopAccum: LOOP_SEC, // 首帧先恢复初始态
      lastPaint: 0,
    };
    this.list.push(producer);
    return producer;
  }

  /** 强引用列表（WeakMap 不可遍历；生命周期与素材同在，条目极少） */
  private list: Producer[] = [];
}

/** 单例访问（ItemIconRegistry） */
export function getDynamicIconAnimator(): DynamicIconAnimator {
  return DynamicIconAnimator.getInstance();
}
