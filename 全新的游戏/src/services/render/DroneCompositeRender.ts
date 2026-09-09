// ============================================================
// DroneCompositeRender —— 无人机多图层复合渲染器（主体固定 + 双翼 VAT）
// ============================================================
// 可露希尔的无人机特效包三帧实为三图层（主体/左翅膀/右翅膀）。
//   - 主体（frame_0，无区域实体）：FTXQuad 静态贴片
//   - 左/右翅膀（frame_1/2，带区域实体+maskEffect）：★ 独立走播放器管线——
//     按整块美术 bbox 重建矩形网格（作者画的小区域多边形会裁掉大半翅膀）
//     → buildEntityMesh 建 VAT 网格（maskEffect 驱动顶点呼吸）
//     → renderFrameData 渲到各自离屏 RT → 世界 billboard quad 采样
//     （与 MoonEffect→SkyDome 同范式）。
//   - VAT 连续时间取实体基类动画播放器（FrameAnimatorBase.localTime），不另造计时器。
// ★ uv 恒等采样：播放器 base/residual 纹理本身已按 bbox 裁剪（尺=bbox.w×bbox.h），
//   0..1 即整幅翅膀。绝不能沿用 Asset 的整画布基准 texBbox/frameSize 映射，
//   否则采样区间被推到纹理边缘 → 翅膀跑到画布顶部/大面积偏移。
// 三个图层同时显示（不做帧序切换）。
// 画布坐标 → 世界：统一按 canvasW 宽比例缩放，像素保持方形。
// ============================================================

import * as THREE from 'three';
import { FxRendererBase } from './FxRendererBase';
import { FTXQuad } from './FTXQuad';
import { buildDisplacementTextureData } from '../../vendor/player/core/entity';
import { buildEntityMesh, renderFrameData } from '../../vendor/player/gl/renderer';
import type { CharacterFxAssetSource } from '../fx/AssetSource';
import type { FrameAnimatorBase } from '../fx/FrameAnimatorBase';
import type { Asset } from '../../vendor/player';

/** 元数据：图层在共享画布中的位置（归一化 0~1，中心相对画布中心） */
interface LayerLayout {
  offX: number; // 画布中心 → 图层中心（横向，右正）
  offY: number; // 画布中心 → 图层中心（纵向，上正）
  w: number;    // 图层宽 / 画布宽
  h: number;    // 图层高 / 画布宽（同 kx → 像素方形）
}

/** 翅膀 VAT 层：离屏 RT + 区域实体网格 + 世界采样 quad */
interface WingVatLayer {
  quad: RtSamplerQuad;
  rt: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  data: NonNullable<ReturnType<Asset['getFrameRenderData']>>;
  cs: number;  // 画布像素宽（cw * canvasW）
  chh: number; // 画布像素高（ch * canvasH）
  offX: number;
  offY: number;
}

/** RT 采样贴片：离屏渲染结果贴到世界 quad（与 SkyDome 月亮同款——
 *  ShaderMaterial 原样输出 sRGB，不触发内置颜色空间转换（避免二次增亮）；
 *  顶点着色器翻转 v：RT 纹理 row0=底部，直接采样会上下颠倒） */
class RtSamplerQuad extends FxRendererBase {
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, texture: THREE.Texture) {
    super();
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, 1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          gl_FragColor = vec4(c.rgb, c.a);
        }
      `,
      uniforms: { uMap: { value: texture } },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.material = material;
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, 0, 0);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** yaw-only billboard（立牌式，同 FTXQuad） */
  setBillboard(camera: THREE.Camera): void {
    if (!this.mesh) return;
    const dir = new THREE.Vector3().subVectors(camera.position, this.mesh.position);
    dir.y = 0;
    if (dir.lengthSq() > 1e-8) {
      dir.normalize();
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    }
    this.applyFlip();
  }
}

const IDENTITY_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
};

export class DroneCompositeRender extends FxRendererBase {
  /** 画布世界宽（米；scale 传入） */
  private worldWidth = 1.2;
  private canvasW = 512;
  private canvasH = 512;
  /** FTXQuad 贴片（主体 + 兜底翼）：[0]=主体, [1]=左翼, [2]=右翼 */
  private quads: FTXQuad[] = [];
  private layout: LayerLayout[] = [];
  /** VAT 翅膀层（区域实体 → 离屏 RT → 世界 quad） */
  private vatWings: WingVatLayer[] = [];
  /** 主渲染器（WorldMode 注入；离屏 RT 共享 WebGL 上下文） */
  private renderer: THREE.WebGLRenderer | null = null;
  private _prevClearColor = new THREE.Color();
  private readonly vatFps = 30;

  constructor(
    scene: THREE.Scene,
    private source: CharacterFxAssetSource,
    private anim: FrameAnimatorBase | null = null,
  ) {
    super();
    // ---- 读取各图层 bbox（画布坐标系统一） ----
    const frames: { bbox: { x: number; y: number; w: number; h: number } }[] = [];
    for (let i = 0; i < source.frameCount; i++) {
      const f = source.getFtxFrame(i);
      if (f?.bbox && f.bbox.w > 0 && f.bbox.h > 0) {
        if (frames.length === 0) {
          this.canvasW = f.width || 512;
          this.canvasH = f.height || 512;
        }
        frames.push({ bbox: f.bbox });
      }
    }

    const asset = source as unknown as Asset;
    const hasEntityPath = typeof (asset as { getFrameRenderData?: unknown }).getFrameRenderData === 'function';

    frames.forEach((fr, i) => {
      const b = fr.bbox;
      const cx = (b.x + b.w / 2) / this.canvasW - 0.5;
      const cy = 0.5 - (b.y + b.h / 2) / this.canvasH;

      // 翅膀：优先走区域实体 VAT 管线（落点/尺寸用美术 bbox = 与旧 FTXQuad 同锚点）
      if (i > 0 && hasEntityPath) {
        const data = asset.getFrameRenderData!(i);
        if (data && data.entities.length > 0) {
          const wing = this.buildWingVat(scene, data, b, cx, cy);
          if (wing) {
            this.vatWings.push(wing);
            return;
          }
        }
      }

      // 主体 / 兜底：FTXQuad 静态贴片（兜底翼仍开启 shader 扭曲）
      this.layout.push({ offX: cx, offY: cy, w: b.w / this.canvasW, h: b.h / this.canvasW });
      const quad = new FTXQuad(scene, source as never);
      quad.setAnchorBottom(false);
      quad.setFrameMapping(
        { width: b.w, height: b.h },
        { x: 0, y: 0, w: b.w, h: b.h },
      );
      if (i > 0) {
        quad.setDistort({
          enabled: true,
          amplitude: 0.06,
          frequency: 5.0,
          speed: 1.2,
          rotation: 0,
        });
        quad.setTurbulance(1);
      }
      this.quads.push(quad);
    });
    // 兜底：缺翅膀帧时补齐占位
    while (this.quads.length + this.vatWings.length < 3 && frames.length > 0) {
      this.layout.push({ offX: 0, offY: 0, w: 1, h: 0 });
      const quad = new FTXQuad(scene, source as never);
      quad.setAnchorBottom(false);
      this.quads.push(quad);
    }
  }

  /** ★ 区域实体 VAT 翅膀：离屏 RT + 覆盖该翼美术 bbox 的正交相机。
   *  ① 网格重建：作者画的小区域多边形只罩住翅膀下小半 → 按整块美术 bbox 矩形
   *     ring（标注空间、首尾闭合）重建；顶点走播放器位移管线（buildDisplacementTextureData
   *     + buildEntityMesh），maskEffect 原样驱动顶点呼吸，矩形随位移自然扑扇。
   *  ② uv 恒等：base/residual 纹理按 bbox 裁剪 → texBbox/scale 组合 offset=(art.x/canvasW,
   *     1-(art.y+art.h)/canvasH)、scale=(art.w/canvasW, art.h/canvasH)，vUv=(x,1-y) 归一化
   *     到 0..1，与直接绘制 FTX 像素级一致。
   *  ③ 相机窗口 = 美术 bbox（外扩 5%，VAT 呼吸不裁边）；RT 尺寸按窗口像素×1.5。 */
  private buildWingVat(
    scene: THREE.Scene,
    data: NonNullable<ReturnType<Asset['getFrameRenderData']>>,
    art: { x: number; y: number; w: number; h: number },
    cx: number,
    cy: number,
  ): WingVatLayer | null {
    const ent = data.entities[0].entity;
    if (!ent?.boundary?.length) return null;

    // ---- 整块美术 bbox 矩形（标注空间，含闭合顶点，与播放器 ring 约定一致） ----
    const x0 = art.x / this.canvasW;
    const y0 = art.y / this.canvasH;
    const x1 = (art.x + art.w) / this.canvasW;
    const y1 = (art.y + art.h) / this.canvasH;
    const ring = [
      { x: x0, y: y0 }, { x: x1, y: y0 },
      { x: x1, y: y1 }, { x: x0, y: y1 },
      { x: x0, y: y0 },
    ];

    const dispResult = buildDisplacementTextureData(
      [ring],
      ent.maskEffect || null,
      this.canvasW,
      this.canvasH,
      [],
      30,
    );
    if (!dispResult) return null;

    const dispTex = new THREE.DataTexture(
      dispResult.data, dispResult.width, dispResult.height,
      THREE.RGFormat, THREE.FloatType,
    );
    dispTex.needsUpdate = true;
    dispTex.minFilter = THREE.NearestFilter;
    dispTex.magFilter = THREE.NearestFilter;
    dispTex.wrapS = THREE.ClampToEdgeWrapping;
    dispTex.wrapT = THREE.ClampToEdgeWrapping;
    dispTex.flipY = false;

    // ★ uv 映射 = 恒等（base 纹理已是按 bbox 裁剪的翅膀图，0..1 即整幅翅膀）：
    //   texBbox/frameSize 组合成 shader 的 offset/scale：
    //     offset=(art.x/canvasW, 1-(art.y+art.h)/canvasH)，scale=(art.w/canvasW, art.h/canvasH)
    //   → 矩形网格 vUv=(x,1-y) 归一化到 0..1，与直接绘制 FTX 一致
    const uvw = art.w / this.canvasW;
    const uvh = art.h / this.canvasH;
    const uxo = art.x / this.canvasW;
    const uyo = 1 - (art.y + art.h) / this.canvasH;
    const meshData = buildEntityMesh(
      { ...ent, boundary: [ring] },
      { x: uxo, y: uyo, w: uvw, h: uvh },
      dispTex,
      dispResult.width,
      dispResult.height,
      1,
      1,
    );
    if (!meshData) {
      dispTex.dispose();
      return null;
    }

    // ---- 相机窗口 = 美术 bbox（外扩 5% 余量，VAT 呼吸位移不裁边） ----
    const padX = (x1 - x0) * 0.05;
    const padY = (y1 - y0) * 0.05;
    const minX = Math.max(0, x0 - padX);
    const maxX = Math.min(1, x1 + padX);
    const minY = Math.max(0, y0 - padY);
    const maxY = Math.min(1, y1 + padY);

    const rt = new THREE.WebGLRenderTarget(
      Math.max(8, Math.round((maxX - minX) * this.canvasW * 1.5)),
      Math.max(8, Math.round((maxY - minY) * this.canvasH * 1.5)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        stencilBuffer: true,
      },
    );

    const wingScene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(minX, maxX, minY, maxY, -1, 1);

    const quad = new RtSamplerQuad(scene, rt.texture);
    const wing: WingVatLayer = {
      quad, rt, scene: wingScene, camera,
      data: { ...data, entities: [meshData] },
      cs: (maxX - minX) * this.canvasW,
      chh: (maxY - minY) * this.canvasH,
      offX: cx,
      offY: cy,
    };
    return wing;
  }

  /** 画布世界宽（米）；各图层按 bbox 比例随之缩放 */
  setScaleKeepAspect(baseSize: number): void {
    this.worldWidth = baseSize;
    this.applyScale();
  }

  private applyScale(): void {
    const kx = this.worldWidth / this.canvasW;
    for (let i = 0; i < this.quads.length; i++) {
      const l = this.layout[i];
      if (!l) continue;
      this.quads[i].setScale(l.w * kx * this.canvasW, l.h * kx * this.canvasW);
    }
    for (const w of this.vatWings) {
      w.quad.setScale(w.cs * kx, w.chh * kx);
    }
  }

  override setPosition(x: number, y: number, z = 0): void {
    const kx = this.worldWidth / this.canvasW;
    for (let i = 0; i < this.quads.length; i++) {
      const l = this.layout[i];
      if (!l) continue;
      this.quads[i].setPosition(x + l.offX * kx * this.canvasW, y + l.offY * kx * this.canvasH, z);
    }
    for (const w of this.vatWings) {
      w.quad.setPosition(x + w.offX * kx * this.canvasW, y + w.offY * kx * this.canvasH, z);
    }
  }

  setBillboard(camera: THREE.Camera): void {
    for (const q of this.quads) q.setBillboard(camera);
    for (const w of this.vatWings) w.quad.setBillboard(camera);
  }

  override setFlip(flipX: boolean, flipY: boolean): void {
    for (const q of this.quads) q.setFlip(flipX, flipY);
    for (const w of this.vatWings) w.quad.setFlip(flipX, flipY);
  }

  setVisible(visible: boolean): void {
    for (const q of this.quads) q.setVisible(visible);
    for (const w of this.vatWings) w.quad.setVisible(visible);
  }

  override setLodLevel(level: number): void {
    super.setLodLevel(level);
    for (const q of this.quads) q.setLodLevel(level);
    for (const w of this.vatWings) w.quad.setLodLevel(level);
  }

  /** ★ 注入主渲染器（WorldMode 创建无人机后调用；与主渲染器共享上下文） */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  private renderWingVat(w: WingVatLayer, t: number): void {
    const renderer = this.renderer!;
    const prevRt = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(w.rt);
    renderer.autoClear = true;
    renderer.clear();
    renderer.autoClear = false;
    renderFrameData(
      w.data,
      t,
      this.vatFps,
      IDENTITY_TRANSFORM,
      renderer,
      w.scene,
      w.camera,
    );

    renderer.setRenderTarget(prevRt);
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this._prevClearColor, prevClearAlpha);
  }

  override render(_state: { frameIndex: number }, fluidTexture?: THREE.Texture | null): void {
    // 三图层同时显示
    for (let i = 0; i < this.quads.length; i++) {
      this.quads[i].render({ frameIndex: i }, fluidTexture);
    }
    // 翅膀 VAT：时间源 = 实体基类动画播放器的连续时钟
    if (this.renderer && this.anim) {
      const t = this.anim.localTime;
      for (const w of this.vatWings) this.renderWingVat(w, t);
    }
  }

  override dispose(): void {
    for (const q of this.quads) q.dispose();
    for (const w of this.vatWings) {
      const em = w.data.entities[0];
      em.mesh.geometry.dispose();
      (em.mesh.material as THREE.Material).dispose();
      em.fillMesh.geometry.dispose();
      (em.fillMesh.material as THREE.Material).dispose();
      em.displacementTexture.dispose();
      w.quad.dispose();
      w.rt.dispose();
    }
    this.quads = [];
    this.layout = [];
    this.vatWings = [];
  }
}