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
/** ★ 共享翅膀烘焙（同素材全局一份）：离屏 RT + VAT 场景/网格 + 尺寸/偏移/连续时钟 */
interface WingBake {
  rt: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  data: NonNullable<ReturnType<Asset['getFrameRenderData']>>;
  cs: number;  // 画布像素宽（cw * canvasW）
  chh: number; // 画布像素高（ch * canvasH）
  offX: number;
  offY: number;
  /** 共享连续时钟（秒）——避免多实例 localTime 交替导致扇动相位跳变 */
  time: number;
  lastTimeMs: number;
  /** 上次烘焙时刻：同帧去重，所有实例每帧只离屏渲染一次 */
  lastBakeMs: number;
}

/** 每实例的翅膀采样贴片（指向共享烘焙 RT；位置/翻转各自独立） */
interface WingVatLayer {
  quad: RtSamplerQuad;
  bake: WingBake;
}

/** ★ 共享翅膀烘焙缓存（key = 素材对象；value = 按帧序的烘焙） */
const wingBakeCache = new WeakMap<object, WingBake[]>();

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
          // ★ 丢弃透明背景（与 RT 内颜色着色器同阈值 base.a<0.5）：
          //   discard 的像素不写深度 → 水能透过翅膀背景显示；
          //   实心翅膀像素仍写深度 → 水被翅膀正确遮挡（保留 2026-09-07 语义）
          if (c.a < 0.5) discard;
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

  /** ★ 魂体模式：不写深度（透明背景不挡水/子弹） */
  setDepthWrite(v: boolean): void {
    this.material.depthWrite = v;
    this.material.needsUpdate = true;
  }
}

/**
 * ★ 数据驱动的翅膀根边顶点固定（自动检测导出数据标注的 fixedVertices）：
 * 作者在小多边形上钉住"身体侧根边"（如左翼右边缘）。原索引不直接映射到
 * 重建矩形 → 用固定点质心判定离矩形哪条边最近，返回该边整排顶点索引
 * （ring 分段约定：seg0 顶 0..K-1 / seg1 右 K..2K-1 / seg2 底 2K..3K-1 /
 * seg3 左 3K..4K-1 / 闭合 4K）。无 fixedVertices → []（全翼扇动）。
 */
function computeWingFixedIndices(
  ent: { boundary?: { x: number; y: number }[][] | undefined; fixedVertices?: number[] },
  ring: { x: number; y: number }[],
  K: number,
): number[] {
  const fixed = ent.fixedVertices;
  const b0 = ent.boundary?.[0];
  if (!fixed || fixed.length === 0 || !b0 || b0.length === 0) return [];
  // 固定点质心（原多边形顶点）
  let mx = 0, my = 0, n = 0;
  for (const idx of fixed) {
    const p = b0[idx];
    if (!p) continue;
    mx += p.x; my += p.y; n++;
  }
  if (n === 0) return [];
  mx /= n; my /= n;
  // 质心到矩形四边的距离（标注空间 y 向下）
  const x0 = ring[0].x, y0 = ring[0].y;
  const x1 = ring[K].x, y1 = ring[2 * K].y;
  const dRight = Math.abs(x1 - mx);
  const dLeft = Math.abs(mx - x0);
  const dTop = Math.abs(my - y0);
  const dBottom = Math.abs(y1 - my);
  const min = Math.min(dRight, dLeft, dTop, dBottom);
  let out: number[] = [];
  if (min === dRight) { for (let i = K; i < 2 * K; i++) out.push(i); }
  else if (min === dLeft) { for (let i = 3 * K; i < 4 * K; i++) out.push(i); }
  else if (min === dTop) { for (let i = 0; i < K; i++) out.push(i); }
  else { for (let i = 2 * K; i < 3 * K; i++) out.push(i); }
  // 闭合顶点 == idx0：若首边被钉住，闭合点一并钉住（同一位置）
  if (min === dTop) out.push(4 * K);
  return out;
}

const IDENTITY_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
};

/** 立牌初始朝向（yaw-only billboard 的 from 轴，与 FTXQuad/RtSamplerQuad 同约定） */
const _Z_AXIS = new THREE.Vector3(0, 0, 1);

/** ★ 反转时视觉右侧翅膀的内收量（画布比例；用户定调 2026-09-09）：
 *  翅膀按 bbox 中心镜像换边后，落在 sprite 右侧的翅膀会稍显外飘，
 *  再往身体方向内收该量。0.07 ≈ 画布宽 7%。 */
const FLIP_TUCK = 0.079; // 0.07 + 2px + 2px（441 画布）/441

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
  /** 合成 billboard 基准点（setPosition 传入的实体锚点） */
  private _basePos = new THREE.Vector3();
  private _tmpDir = new THREE.Vector3();
  private _tmpV = new THREE.Vector3();
  private _tmpQ = new THREE.Quaternion();
  /** ★ 左右朝向：翻转向 → 翅膀交换左右侧（根部仍朝身体），身体各自镜像 */
  private flipX = false;
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
          // ★ 共享烘焙：同素材全局只建一份 RT/VAT 场景（首见者构建，后续实例只挂采样贴片）
          const key = source as unknown as object;
          let list = wingBakeCache.get(key);
          if (!list) { list = []; wingBakeCache.set(key, list); }
          let bake: WingBake | undefined = list[i - 1];
          if (!bake) {
            const built = this.buildWingBake(data, b, cx, cy);
            if (built) { bake = built; list[i - 1] = built; }
          }
          if (bake) {
            const quad = new RtSamplerQuad(scene, bake.rt.texture);
            this.vatWings.push({ quad, bake });
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
   *   ① 网格重建：作者画的小区域多边形只罩住翅膀下小半 → 按整块美术 bbox 矩形
   *      ring（标注空间、首尾闭合）重建，每边细分 K 段（位移分辨率 + 固定点锚定用）；
   *      顶点走播放器位移管线（buildDisplacementTextureData + buildEntityMesh），
   *      maskEffect 原样驱动顶点呼吸，矩形随位移自然扑扇。
   *   ② ★ 顶点固定（数据驱动）：导出数据标注了 fixedVertices（作者把"身体侧根边"
   *      钉住实现铰接扇动）。原索引指向作者小多边形、不直接映射到本矩形——改为
   *      检测 fixedVertices 非空 → 取其质心 → 判定离矩形哪条边最近（身体侧）
   *      → 该条边整排顶点钉住（位移清零），其余顶点相对锚点呼吸 → 铰接效果。
   *   ③ uv 恒等：base/residual 纹理按 bbox 裁剪 → texBbox/scale 组合
   *      offset=(art.x/canvasW, 1-(art.y+art.h)/canvasH)、scale=(art.w/canvasW, art.h/canvasH)，
   *      vUv=(x,1-y) 归一化 0..1，与直接绘制 FTX 像素级一致。
   *   ④ 相机窗口 = 美术 bbox（外扩 5%，VAT 呼吸不裁边）；RT 尺寸按窗口像素×1.5。 */
  private buildWingBake(
    data: NonNullable<ReturnType<Asset['getFrameRenderData']>>,
    art: { x: number; y: number; w: number; h: number },
    cx: number,
    cy: number,
  ): WingBake | null {
    const ent = data.entities[0].entity;
    if (!ent?.boundary?.length) return null;

    // ---- 整块美术 bbox 矩形：每边细分 K 段（标注空间，首尾闭合，ring 约定一致） ----
    const x0 = art.x / this.canvasW;
    const y0 = art.y / this.canvasH;
    const x1 = (art.x + art.w) / this.canvasW;
    const y1 = (art.y + art.h) / this.canvasH;
    const K = 8;
    const ring: { x: number; y: number }[] = [];
    const seg = (ax: number, ay: number, bx: number, by: number): void => {
      for (let i = 0; i < K; i++) {
        const t = i / K;
        ring.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
      }
    };
    seg(x0, y0, x1, y0); // 0..K-1   顶边
    seg(x1, y0, x1, y1); // K..2K-1  右边（右翼身体侧）
    seg(x1, y1, x0, y1); // 2K..3K-1 底边
    seg(x0, y1, x0, y0); // 3K..4K-1 左边（左翼身体侧）
    ring.push(ring[0]);  // 闭合顶点（== idx0）

    // ★ 顶点固定（数据驱动）：fixedVertices 非空 → 质心判最近边 → 该边整排钉住
    const fixedIndices = computeWingFixedIndices(ent, ring, K);

    const dispResult = buildDisplacementTextureData(
      [ring],
      ent.maskEffect || null,
      this.canvasW,
      this.canvasH,
      fixedIndices,
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

    const bake: WingBake = {
      rt, scene: wingScene, camera,
      data: { ...data, entities: [meshData] },
      cs: (maxX - minX) * this.canvasW,
      chh: (maxY - minY) * this.canvasH,
      offX: cx,
      offY: cy,
      time: 0,
      lastTimeMs: 0,
      lastBakeMs: -1e9,
    };
    return bake;
  }

  /** 画布世界宽（米）；各图层按 bbox 比例随之缩放 */
  /** ★ 魂体渲染模式（祖宗）：流体 alpha 裁到基础色轮廓——
   *  背景像素 discard（不写深度、不混合 → 水/子弹可透过）；
   *  本体像素保持正常深度写入（水面按深度正确遮挡，不会被水"盖到前面"） */
  setSoulMode(): void {
    for (const q of this.quads) {
      q.setFluidClipToBase(true);
    }
  }

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
      w.quad.setScale(w.bake.cs * kx, w.bake.chh * kx);
    }
  }

  override setPosition(x: number, y: number, z = 0): void {
    this._basePos.set(x, y, z);
    const kx = this.worldWidth / this.canvasW;
    const fx = this.flipX ? -1 : 1;
    for (let i = 0; i < this.quads.length; i++) {
      const l = this.layout[i];
      if (!l) continue;
      // ★ 翅膀（i>0）朝另一面时交换左右侧：offX 取反（根部仍朝身体）
      let off = i > 0 ? l.offX * fx : l.offX;
      // ★ 反转时视觉右侧的翅膀内收（换边后外飘修正）
      if (this.flipX && off > 0) off -= FLIP_TUCK;
      this.quads[i].setPosition(x + off * kx * this.canvasW, y + l.offY * kx * this.canvasH, z);
    }
    for (const w of this.vatWings) {
      let off = w.bake.offX * fx;
      if (this.flipX && off > 0) off -= FLIP_TUCK;
      w.quad.setPosition(x + off * kx * this.canvasW, y + w.bake.offY * kx * this.canvasH, z);
    }
  }

  /** ★ 合成 billboard：三图层当同一立牌 —— 画布水平轴偏移随整机 yaw 旋转，
   *  画布竖直偏移（世界高）不变。这样相机绕飞时翅膀始终贴在身体两侧，
   *  不会因固定世界偏移而脱开。翻转向时翅膀交换左右侧（offX 取反）。 */
  setBillboard(camera: THREE.Camera): void {
    const kx = this.worldWidth / this.canvasW;
    const fx = this.flipX ? -1 : 1;
    const dir = this._tmpDir.copy(camera.position).sub(this._basePos);
    dir.y = 0;
    if (dir.lengthSq() > 1e-8) {
      dir.normalize();
      this._tmpQ.setFromUnitVectors(_Z_AXIS, dir);
    } else {
      this._tmpQ.identity();
    }
    for (let i = 0; i < this.quads.length; i++) {
      const l = this.layout[i];
      if (!l) continue;
      let off = i > 0 ? l.offX * fx : l.offX;
      if (this.flipX && off > 0) off -= FLIP_TUCK; // ★ 反转内收（同 setPosition）
      const dx = off * kx * this.canvasW;
      const dy = l.offY * kx * this.canvasH;
      const ox = this._tmpV.set(dx, 0, 0).applyQuaternion(this._tmpQ);
      this.quads[i].setPosition(this._basePos.x + ox.x, this._basePos.y + dy, this._basePos.z + ox.z);
      this.quads[i].setBillboard(camera);
    }
    for (const w of this.vatWings) {
      let off = w.bake.offX * fx;
      if (this.flipX && off > 0) off -= FLIP_TUCK; // 反转内收（同 setPosition）
      const dx = off * kx * this.canvasW;
      const dy = w.bake.offY * kx * this.canvasH;
      const ox = this._tmpV.set(dx, 0, 0).applyQuaternion(this._tmpQ);
      w.quad.setPosition(this._basePos.x + ox.x, this._basePos.y + dy, this._basePos.z + ox.z);
      w.quad.setBillboard(camera);
    }
  }

  override setFlip(flipX: boolean, flipY: boolean): void {
    this.flipX = flipX;
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

  /** ★ 共享翅膀烘焙：所有同素材实例每帧只离屏渲染一次（同帧去重 + 共享连续时钟） */
  private renderWingBake(b: WingBake): void {
    const renderer = this.renderer!;
    const now = performance.now();
    // 同帧去重：第二次调用（别的无人机）直接复用上一帧烘焙结果
    if (now - b.lastBakeMs < 8) return;
    const dt = b.lastTimeMs > 0 ? Math.min(0.1, (now - b.lastTimeMs) / 1000) : 0;
    b.lastTimeMs = now;
    b.lastBakeMs = now;
    b.time += dt;

    const prevRt = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(b.rt);
    renderer.autoClear = true;
    renderer.clear();
    renderer.autoClear = false;
    renderFrameData(
      b.data,
      b.time,
      this.vatFps,
      IDENTITY_TRANSFORM,
      renderer,
      b.scene,
      b.camera,
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
    // 翅膀 VAT：共享烘焙每帧只渲染一次（所有同素材无人机复用）
    if (this.renderer && this.anim) {
      for (const w of this.vatWings) this.renderWingBake(w.bake);
    }
  }

  override dispose(): void {
    for (const q of this.quads) q.dispose();
    // ★ 共享翅膀烘焙归资产级缓存持有（WeakMap），这里只释放本实例的采样贴片
    for (const w of this.vatWings) {
      w.quad.dispose();
    }
    this.quads = [];
    this.layout = [];
    this.vatWings = [];
  }
}