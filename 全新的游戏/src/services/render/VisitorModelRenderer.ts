// ============================================================
// VisitorModelRenderer —— 访客 GLB 模型渲染器（骨骼 + 动画 + 换脸）
// ============================================================
// 模型：Kenney "Mini Characters 1"（CC0）的 character-male-a.glb
//   （public/models/visitors/visitor.glb，~240KB + 8.7KB colormap 贴图）；
//   **5 名访客共用一个模型**（用户定调：体积要小、模型一个就行）。
// ★ 换脸（2026-09-15 八版"彻底削平 + 贴纹理"）：
//   · 该模型 colormap 是**调色板渐变图**（非画好的脸）；头部正面的"五官"实际是
//     4 层不同深度的小面片拼的（z=0.1576/0.1596/0.1646/0.1676）——不削平直接重映射
//     UV 会显得凹凸/分层，观感不对；
//   · 现在：**删掉头正面所有小面片**（三角形按"三顶点都在前平面"筛除），在开口处
//     补一整块**平面四边形**（法线 +Z、绑定头骨骼、贴图 UV 直接映射到脸区）——
//     脸彻底削平；再把"底图 + 自己的脸"合成贴图换给材质。脸随骨骼动画完美变形。
//   · 脸区选在贴图左上角的**无网格使用空白区**（实测 body/head UV 都不落入
//     u∈[0.14,0.97] & v∈[0.01,0.47]）；脸图**拉伸铺满**（头正面近方形，
//     脸区像素矩形按头正面宽高比取，形变可忽略）。
// 动画：GLB 自带 32 条，这里只用 idle / walk / sprint（速度控 timeScale + 交叉淡化）。
// 材质：克隆成 MeshToonMaterial（每实例一张自己的合成贴图）。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FxRendererBase } from './FxRendererBase';
import type { VisitorBodyLike } from './VisitorBodyLike';
import { getVisitorToonGradient } from './VisitorBodyRenderer';
import type { FrameAssetSource } from '../fx/AssetSource';
import { compositeFrameToCanvas } from '../../ui/shared/ftxFrameToCanvas';
import type { FtxAsset } from '../../vendor/player/FtxAsset';

/** ★ 访客模型外观参数（VisitorDef.model） */
export interface VisitorModelStyle {
  /** GLB 路径（相对纹理目录由 GLB 内部 URI 决定，当前为同目录下 Textures/colormap.png） */
  url: string;
  /** 目标身高（米；缺省 3.2——与程序化 Q 版同量级） */
  height?: number;
  /** 可选整体色调（乘算到贴图；会连同肤色一起染，慎用） */
  tint?: number | string;
  /** 朝向偏移（弧度；模型默认面朝 +Z，个别模型可校正） */
  yawOffset?: number;
  /** 脸纹理取第几帧（缺省：优先"前"帧，否则 0） */
  faceFrame?: number;
  /** 是否换脸（缺省 true）；false = 用模型自带调色板脸 */
  swapFace?: boolean;
}

/** 走路动画的参考速度（米/秒；timeScale = speed / 此值，1 附近最自然） */
const WALK_REF_SPEED = 3.4;
/** sprint 切换阈值（× WALK_REF_SPEED） */
const SPRINT_MUL = 1.35;
/** 待机/走路的交叉淡化时长（秒） */
const FADE_SECONDS = 0.2;
/** 头部正面判定：z 距头网格最大 z 此阈值以内（覆盖 4 层五官面片） */
const FRONT_EPS = 0.02;
/** ★ 脸区矩形（UV；贴图左上角空白区，实测无网格使用；v=0 = 图顶）。
 *  像素矩形 232×224 ≈ 头正面宽高比（0.29:0.28），脸图拉伸铺满 → 几乎无形变。 */
const FACE_U0 = 80 / 512;
const FACE_U1 = 312 / 512;
const FACE_V0 = 6 / 512;
const FACE_V1 = 230 / 512;
/** 头部侧面皮肤的调色板采样点（UV；用于脸区底色，避免脸图留白露黑底） */
const SKIN_UV = { u: 0.514, v: 0.847 };
/** 合成贴图边长（与底图一致） */
const ATLAS_SIZE = 512;

type ModelTemplate = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; baseImage: CanvasImageSource | null };
/** 模板加载缓存（所有访客共用一次加载） */
const _templates = new Map<string, Promise<ModelTemplate>>();
function loadTemplate(url: string): Promise<ModelTemplate> {
  let p = _templates.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((gltf) => {
      // 取底图（colormap）供换脸合成用
      let baseImage: CanvasImageSource | null = null;
      gltf.scene.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || baseImage) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map?.image) baseImage = mat.map.image as CanvasImageSource;
      });
      return { scene: gltf.scene, animations: gltf.animations, baseImage };
    });
    p.catch(() => _templates.delete(url));
    _templates.set(url, p);
  }
  return p;
}

export class VisitorModelRenderer extends FxRendererBase implements VisitorBodyLike {
  private root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private sprintAction: THREE.AnimationAction | null = null;
  private current: 'idle' | 'walk' | 'sprint' = 'idle';
  private speed = 0;
  private yawOffset: number;
  private faceTex: THREE.Texture | null = null;
  private ownMaterials: THREE.Material[] = [];
  private ownGeometries: THREE.BufferGeometry[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, style: VisitorModelStyle, faceAsset: FrameAssetSource | null) {
    super();
    this.yawOffset = style.yawOffset ?? 0;
    scene.add(this.root);
    void this.setup(style, faceAsset);
  }

  private async setup(style: VisitorModelStyle, faceAsset: FrameAssetSource | null): Promise<void> {
    let tpl: ModelTemplate;
    try {
      tpl = await loadTemplate(style.url);
    } catch (e) {
      console.warn('[VisitorModel] 模型加载失败:', style.url, e);
      return;
    }
    if (this.disposed) return;
    const model = skeletonClone(tpl.scene);
    // 尺寸：按包围盒缩放到目标身高，脚底贴 y=0
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const k = (style.height ?? 3.2) / h;
    model.scale.setScalar(k);
    model.position.y = -box.min.y * k;
    this.root.add(model);
    // 材质：克隆 + 卡通化（先共享底图；换脸时换成每实例合成贴图）
    const tint = style.tint !== undefined ? new THREE.Color(style.tint) : null;
    const grad = getVisitorToonGradient();
    model.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const srcMat = m.material as THREE.MeshStandardMaterial;
      const toon = new THREE.MeshToonMaterial({
        map: srcMat.map ?? null,
        gradientMap: grad,
        side: THREE.DoubleSide,
      });
      if (tint) toon.color.copy(tint);
      m.material = toon;
      m.frustumCulled = false; // 蒙皮包围盒随动画变化，关裁剪防闪
      this.ownMaterials.push(toon);
    });
    // 动画：idle / walk / sprint
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of tpl.animations) {
      if (clip.name === 'idle') this.idleAction = this.mixer.clipAction(clip);
      else if (clip.name === 'walk') this.walkAction = this.mixer.clipAction(clip);
      else if (clip.name === 'sprint') this.sprintAction = this.mixer.clipAction(clip);
    }
    this.idleAction?.play();
    this.current = 'idle';
    // ★ 换脸：底图 + 脸 → 每实例贴图；头正面 UV 重映射到脸区
    if (faceAsset && style.swapFace !== false) {
      void this.applyFace(model, tpl.baseImage, faceAsset, style.faceFrame);
    }
  }

  /** ★ 换脸主流程：合成贴图 → 替换材质贴图 → 重映射头正面 UV */
  private async applyFace(
    model: THREE.Object3D,
    baseImage: CanvasImageSource | null,
    asset: FrameAssetSource,
    faceFrame: number | undefined,
  ): Promise<void> {
    const a = asset as unknown as { getFtxFrame?: (i: number) => unknown };
    if (typeof a.getFtxFrame !== 'function') return;
    let face: HTMLCanvasElement;
    try {
      const idx = asset.resolveFrame('前') ?? faceFrame ?? 0;
      face = compositeFrameToCanvas(asset as unknown as FtxAsset, idx);
    } catch (e) {
      console.warn('[VisitorModel] 脸纹理合成失败:', e);
      return;
    }
    if (this.disposed) return;
    // 合成：底图 + 脸（先填皮肤底色，再 contain 居中）
    const S = ATLAS_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    if (baseImage) ctx.drawImage(baseImage, 0, 0, S, S);
    const x0 = FACE_U0 * S;
    const y0 = FACE_V0 * S;
    const x1 = FACE_U1 * S;
    const y1 = FACE_V1 * S;
    // 皮肤底色（采样底图头部侧面 UV 处颜色）
    try {
      const sample = ctx.getImageData(Math.round(SKIN_UV.u * S), Math.round(SKIN_UV.v * S), 1, 1).data;
      ctx.fillStyle = `rgb(${sample[0]},${sample[1]},${sample[2]})`;
    } catch {
      ctx.fillStyle = '#e6c39a';
    }
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 拉伸铺满脸区（贴图矩形按头正面宽高比取，形变可忽略；透明处透出皮肤底色）
    ctx.drawImage(face, x0, y0, x1 - x0, y1 - y0);
    // 贴图（glTF 约定 flipY=false：v=0 = 图顶）
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.faceTex = tex;
    for (const mat of this.ownMaterials) {
      const tm = mat as THREE.MeshToonMaterial;
      tm.map = tex;
      tm.needsUpdate = true;
    }
    // ★ 彻底削平头正面 + 平板 UV 映射到脸区
    this.flattenFace(model);
  }

  /** ★ 彻底削平头正面：删掉原正面 4 层小面片，开口处补一整块平面四边形
   *  （法线 +Z、跟随头骨骼），4 顶点 UV 直接映射到脸区矩形。
   *  只新建本实例几何并换给该 SkinnedMesh；共享模板几何不动。 */
  private flattenFace(model: THREE.Object3D): void {
    const head = model.getObjectByName('head-mesh') as THREE.SkinnedMesh | null;
    if (!head) return;
    const src = head.geometry;
    const pos = src.getAttribute('position') as THREE.BufferAttribute;
    const srcIdx = src.getIndex();
    if (!pos || !srcIdx) return;
    // 1) 前平面判定 + 外接矩形（取一个正面顶点做骨骼/次要属性样板）
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
    const isFront = (i: number): boolean => pos.getZ(i) > maxZ - FRONT_EPS;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let srcV = -1;
    for (let i = 0; i < pos.count; i++) {
      if (!isFront(i)) continue;
      if (srcV < 0) srcV = i;
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    if (srcV < 0 || !(maxX > minX) || !(maxY > minY)) return;
    // 2) 索引：丢掉正面三角形
    const oldIdx = srcIdx.array;
    const newIdx: number[] = [];
    for (let t = 0; t < oldIdx.length; t += 3) {
      const a = oldIdx[t];
      const b = oldIdx[t + 1];
      const c = oldIdx[t + 2];
      if (isFront(a) && isFront(b) && isFront(c)) continue;
      newIdx.push(a, b, c);
    }
    // 3) 属性：全量拷贝 + 追加 4 个平板顶点（骨骼/次要 UV 从 srcV 复制）
    const base = pos.count;
    const attrs: Record<string, THREE.BufferAttribute> = {};
    for (const name of Object.keys(src.attributes)) {
      const a = src.attributes[name] as THREE.BufferAttribute;
      const data = new Float32Array((a.count + 4) * a.itemSize);
      for (let i = 0; i < a.count; i++) {
        for (let c = 0; c < a.itemSize; c++) data[i * a.itemSize + c] = a.getComponent(i, c);
      }
      attrs[name] = new THREE.BufferAttribute(data, a.itemSize);
    }
    // 四角：左上 / 右上 / 左下 / 右下（UV 与平面坐标一一对应；v=0 = 图顶）
    const corners = [
      { x: minX, y: maxY, u: FACE_U0, v: FACE_V0 },
      { x: maxX, y: maxY, u: FACE_U1, v: FACE_V0 },
      { x: minX, y: minY, u: FACE_U0, v: FACE_V1 },
      { x: maxX, y: minY, u: FACE_U1, v: FACE_V1 },
    ];
    const zPlane = maxZ + 0.0004; // 与原最前层齐平略凸，消除 z-fighting
    for (let q = 0; q < 4; q++) {
      const vi = base + q;
      const c = corners[q];
      attrs.position.setXYZ(vi, c.x, c.y, zPlane);
      attrs.normal?.setXYZ(vi, 0, 0, 1);
      attrs.uv?.setXY(vi, c.u, c.v);
      attrs.tangent?.setXYZW(vi, 1, 0, 0, 1);
      for (const name of Object.keys(attrs)) {
        if (name === 'position' || name === 'normal' || name === 'uv' || name === 'tangent') continue;
        const a = src.attributes[name] as THREE.BufferAttribute;
        const out = attrs[name];
        for (let cc = 0; cc < a.itemSize; cc++) {
          (out.array as Float32Array)[vi * a.itemSize + cc] = a.getComponent(srcV, cc);
        }
      }
    }
    // 4) 新几何（平板朝 +Z：逆时针绕序 tl→bl→tr / bl→br→tr）
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(attrs)) geo.setAttribute(name, attr);
    geo.setIndex([...newIdx, base + 0, base + 2, base + 1, base + 2, base + 3, base + 1]);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    head.geometry = geo;
    this.ownGeometries.push(geo);
  }

  // ---- VisitorBodyLike / FxRendererBase ----

  override setPosition(x: number, y: number, z = 0): void {
    this.root.position.set(x, y, z);
  }

  override setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  setYaw(rad: number): void {
    this.root.rotation.y = rad + this.yawOffset;
  }

  override setFlip(): void {
    // 3D 模型：朝向由 setYaw 决定
  }

  override render(): void {
    // 骨骼动画在 update() 里驱动
  }

  /** 行进状态（交叉淡化 idle/walk/sprint；timeScale 跟速度） */
  setLocomotion(moving: boolean, speed: number): void {
    this.speed = moving && speed > 0.05 ? speed : 0;
    if (this.speed <= 0.05) {
      this.fadeTo('idle');
      return;
    }
    const sprint = this.speed > WALK_REF_SPEED * SPRINT_MUL;
    this.fadeTo(sprint ? 'sprint' : 'walk');
    const scale = Math.max(0.55, Math.min(2.2, this.speed / WALK_REF_SPEED));
    this.walkAction?.setEffectiveTimeScale(scale);
    this.sprintAction?.setEffectiveTimeScale(scale);
  }

  private fadeTo(next: 'idle' | 'walk' | 'sprint'): void {
    if (this.current === next || !this.mixer) return;
    const from = next === 'idle' ? (this.current === 'sprint' ? this.sprintAction : this.walkAction) : this.idleAction;
    const to = next === 'idle' ? this.idleAction : next === 'sprint' ? this.sprintAction : this.walkAction;
    if (!to) return;
    to.reset().setEffectiveWeight(1).play();
    if (from && from !== to) to.crossFadeFrom(from, FADE_SECONDS, false);
    this.current = next;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  override dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.root.parent?.remove(this.root);
    // 只销毁本实例克隆的材质/几何/合成贴图；骨架与 colormap 底图是共享模板，勿动
    for (const mat of this.ownMaterials) mat.dispose();
    this.ownMaterials.length = 0;
    for (const geo of this.ownGeometries) geo.dispose();
    this.ownGeometries.length = 0;
    this.faceTex?.dispose();
    this.faceTex = null;
  }
}
