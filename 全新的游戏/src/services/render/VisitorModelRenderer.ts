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

  // ============================================================
  // ★ 以下为**换模型解耦**参数（2026-09-16）：不填走内置候选表兜底，
  //   换了模型通常**不用改代码**，只在必要时覆盖。
  // ============================================================

  /** ★ 动画名覆盖：三态各自的实际 clip 名（模糊匹配失败时用）。
   *  例：Kenney 是 'idle'/'walk'/'sprint'；Quaternius 是
   *  'CharacterArmature|...|Idle'/'...|Walk'/'...|Run'。 */
  animNames?: {
    idle?: string | string[];
    walk?: string | string[];
    sprint?: string | string[];
  };
  /** ★ 头部网格名覆盖（换脸用；缺省自动按"最高的蒙皮网格"推断） */
  headMeshName?: string;
  /** ★ 脸区 UV 矩形覆盖（缺省用内置值；换贴图后需要时再调） */
  faceRect?: { u0: number; u1: number; v0: number; v1: number };
  /** ★ 脸区底色采样点 UV 覆盖（缺省用内置值） */
  skinUV?: { u: number; v: number };
  /** ★ 换脸策略（2026-09-16 新增）：
   *  · 'flatten'（缺省）= 删正面小面片 + 补平板（Kenney Mini Characters 用）
   *  · 'remap' = **只重映射正脸顶点 UV**，不增删几何（Cube Guy 这类
   *    「单块网格 + 调色板贴图」必须用这个，用 flatten 会把整个身体正面挖空） */
  faceMode?: 'flatten' | 'remap';
  /** ★ 'remap' 模式：正脸顶点判定阈值（顶点法线的"前向分量"）。
   *  模型前向轴 + 符号由 frontAxis 指定；阈值越高只取越正对镜头的面。缺省 0.7。 */
  faceFacingMin?: number;
  /** ★ 'remap' 模式：模型局部空间的**前向轴**（缺省 'z'）。
   *  ★★ 带符号！ '+y' / '-y' / '+x' / '-x' / '+z' / '-z' 均可。
   *  Quaternius Cube Guy 实测：**'-y' 才是脸朝向**（FBX 惯例 y=前后，但脸在 -y）。
   *  判错方向的最典型症状 = **立绘糊在后脑勺上**。 */
  frontAxis?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
  /** ★ 'remap' 模式：模型局部空间的**高度轴**（缺省 'y'）。Cube Guy 传 'z'。 */
  upAxis?: 'x' | 'y' | 'z';
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

// ============================================================
// ★ Cube Guy / 调色板贴图模型的换脸参数（2026-09-16 实测标定）
// ============================================================
// Quaternius "Cube Guy"（visitor_cubeguy.glb）与 Kenney 是**两类完全不同的模型**：
//   · 整个模型只有 **8 个 UV 坐标**、贴图是一张 **32×32 的 8 色调色板**——
//     每个面片只采样**一个 texel**，没有"画好的脸"；
//   · 全身是**一整块** `Character` 蒙皮网格（3122 三角面），**没有独立头网格**；
//   · 头部正脸**是平的**（局部 y = +maxY 的那一面，法线 (0,1,0)），
//     但它在**局部 y 轴**上朝前，不是 z 轴（FBX 惯例：y=前后、z=高度）。
//
// 因此 Kenney 那套「删正面小面片 + 补平板」在华盖哥上会**把整个身体正面挖空**
//（"正面"筛选命中全身）——必须改用 `faceMode: 'remap'`：**只改正脸顶点的 UV**，
// 让它指向贴图里一块干净区域，再把立绘画到那块区域。不增删几何，零副作用。
//
// 安全贴图区：模型自用 texel 全在 v≈0.307..0.329 这条窄带；脸图区必须避开。
// 下面这块 6×9 texel（u 0..0.1875, v 0.71875..1.0）经实测**无任何顶点采样**。
/** ★ Cube Guy 脸图区（UV 矩形；u 0..6/32, v 23/32..1） */
const CG_FACE_U0 = 0 / 32;
const CG_FACE_U1 = 6 / 32;
const CG_FACE_V0 = 23 / 32;
const CG_FACE_V1 = 1;
/** texel 内缩（避免线性过滤把相邻 texel 混进来） */
const CG_FACE_PAD = 0.5 / 32;
/** 正脸判定阈值：只取法线前向分量 > 此值的顶点 */
const CG_FACING_MIN = 0.7;

type ModelTemplate = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; baseImage: CanvasImageSource | null };

// ============================================================
// ★ 换模型解耦（2026-09-16）：动画名 / 头网格 / 脸区 UV 三处的兜底解析
// ============================================================
// 背景：原实现把这三处都按 Kenney Mini Characters 写死，换模型会**静默失效**
//（不是报错，是"人站着不动""脸没换""脸花了"）。此处改为：
//   · 动画名：先试 style 覆盖 → 再按**候选表模糊匹配**（子串、忽略大小写）
//   · 头网格：先试 style 覆盖 → 再按名字关键词 → 最后按"最高的蒙皮网格"几何推断
//   · 脸区 UV：先试 style 覆盖 → 再用内置默认（Kenney 实测值）
// 副作用：跨模型换用不再需要改本文件。

/** 三态动画的候选名（按优先级；子串匹配、忽略大小写） */
const ANIM_CANDIDATES: Record<'idle' | 'walk' | 'sprint', string[]> = {
  idle: ['idle', 'stand', 'breathing', '静止', '待机'],
  // ★ walk 要避开 'walk_hold' 之类；sprint 优先 run/jog
  walk: ['walk', 'walking', '步行', '行走'],
  sprint: ['sprint', 'run', 'jog', 'running', '奔跑', '跑步'],
};

/** 头网格名候选关键词（小写子串） */
const HEAD_NAME_HINTS = ['head', 'skull', '头'];

/** 在 clip 列表里挑最匹配候选的名字；返回 null = 没匹配上 */
function pickClipName(
  clips: THREE.AnimationClip[],
  want: 'idle' | 'walk' | 'sprint',
  override?: string | string[],
): string | null {
  const names = clips.map((c) => c.name);
  // ① 显式覆盖：精确命中优先，其次子串
  const ov = override === undefined ? [] : Array.isArray(override) ? override : [override];
  for (const o of ov) {
    const exact = names.find((n) => n === o);
    if (exact) return exact;
  }
  for (const o of ov) {
    const sub = names.find((n) => n.toLowerCase().includes(o.toLowerCase()));
    if (sub) return sub;
  }
  // ② 候选表：按数组顺序（优先级）子串匹配
  for (const cand of ANIM_CANDIDATES[want]) {
    // ★ 先找"以候选词结尾"的（Kenney: 'walk'；Quaternius: '...|Walk'）
    const tail = names.find((n) => n.toLowerCase().endsWith(cand));
    if (tail) return tail;
  }
  for (const cand of ANIM_CANDIDATES[want]) {
    const any = names.find((n) => n.toLowerCase().includes(cand));
    if (any) return any;
  }
  return null;
}

/**
 * ★ 自动找头部网格（换脸用）——不依赖具体模型的名字。
 * 策略：① style.headMeshName 精确 → ② 名字含 head/skull/头 →
 *       ③ 几何推断：所有 SkinnedMesh 里**包围盒最高**的那个（头在人体最高处）。
 */
function findHeadMesh(model: THREE.Object3D, override?: string): THREE.SkinnedMesh | null {
  if (override) {
    const m = model.getObjectByName(override) as THREE.SkinnedMesh | null;
    if (m?.isSkinnedMesh) return m;
  }
  const skinned: THREE.SkinnedMesh[] = [];
  model.traverse((o: THREE.Object3D) => {
    const s = o as THREE.SkinnedMesh;
    if (s.isSkinnedMesh) skinned.push(s);
  });
  if (skinned.length === 0) return null;
  // ② 名字关键词
  for (const s of skinned) {
    const n = (s.name || '').toLowerCase();
    if (HEAD_NAME_HINTS.some((h) => n.includes(h))) return s;
  }
  // ③ 几何推断：局部包围盒最高的
  let best: THREE.SkinnedMesh | null = null;
  let bestTop = -Infinity;
  for (const s of skinned) {
    const g = s.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const top = g.boundingBox ? g.boundingBox.max.y : -Infinity;
    if (top > bestTop) { bestTop = top; best = s; }
  }
  return best;
}

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
    // ★ 尺寸：先把模型挂到 root 并**更新世界矩阵**，再量包围盒。
    //   顺序很关键：setFromObject 依赖 matrixWorld，若在 add 之前调用，
    //   蒙皮网格可能量到塌陷的尺寸（缩放系数算成 0.03 这种）→ 人物小到看不见。
    this.root.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const k = (style.height ?? 3.2) / h;
    model.scale.setScalar(k);
    model.position.y = -box.min.y * k;
    model.updateMatrixWorld(true);
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
    // 动画：idle / walk / sprint（★ 2026-09-16 解耦：按候选表解析，不写死名字）
    this.mixer = new THREE.AnimationMixer(model);
    const byName = (n: string | null) => n ? tpl.animations.find((c) => c.name === n) ?? null : null;
    const nIdle = pickClipName(tpl.animations, 'idle', style.animNames?.idle);
    const nWalk = pickClipName(tpl.animations, 'walk', style.animNames?.walk);
    const nSprint = pickClipName(tpl.animations, 'sprint', style.animNames?.sprint);
    const cIdle = byName(nIdle), cWalk = byName(nWalk), cSprint = byName(nSprint);
    if (cIdle) this.idleAction = this.mixer.clipAction(cIdle);
    if (cWalk) this.walkAction = this.mixer.clipAction(cWalk);
    if (cSprint) this.sprintAction = this.mixer.clipAction(cSprint);
    // ★ 兜底：一个都没匹配上 → 用第 0 条循环播放（至少不是"站着不动"）
    if (!this.idleAction && !this.walkAction && !this.sprintAction && tpl.animations.length > 0) {
      console.warn('[VisitorModel] 动画名未匹配，回退到第 0 条:', tpl.animations[0].name,
        '可用:', tpl.animations.map((c) => c.name));
      this.idleAction = this.mixer.clipAction(tpl.animations[0]);
    }
    // ★ 缺 walk/sprint 时用 idle 顶替（避免切态时人物僵住）
    if (!this.walkAction) this.walkAction = this.idleAction;
    if (!this.sprintAction) this.sprintAction = this.walkAction;
    this.idleAction?.play();
    this.current = 'idle';
    // ★ 换脸：底图 + 脸 → 每实例贴图；头正面 UV 重映射到脸区
    if (faceAsset && style.swapFace !== false) {
      void this.applyFace(model, tpl.baseImage, faceAsset, style.faceFrame, style);
    }
  }

  /** ★ 换脸主流程：合成贴图 → 替换材质贴图 → 重映射头正面 UV */
  private async applyFace(
    model: THREE.Object3D,
    baseImage: CanvasImageSource | null,
    asset: FrameAssetSource,
    faceFrame: number | undefined,
    style: VisitorModelStyle,
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
    // ★ 脸区矩形 / 底色采样点：style 可覆盖（换模型时按新贴图重标）
    const FR = style.faceRect ?? { u0: FACE_U0, u1: FACE_U1, v0: FACE_V0, v1: FACE_V1 };
    const SK = style.skinUV ?? SKIN_UV;
    // 合成：底图 + 脸（先填皮肤底色，再 contain 居中）
    const S = ATLAS_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    if (baseImage) ctx.drawImage(baseImage, 0, 0, S, S);
    const x0 = FR.u0 * S;
    const y0 = FR.v0 * S;
    const x1 = FR.u1 * S;
    const y1 = FR.v1 * S;
    // 皮肤底色（采样底图头部侧面 UV 处颜色）
    try {
      const sample = ctx.getImageData(Math.round(SK.u * S), Math.round(SK.v * S), 1, 1).data;
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
    // ★ 换脸落点：两种策略（由 style.faceMode 选）
    //   · 'remap'  = 只改正脸顶点 UV（单块网格 + 调色板贴图，如 Cube Guy）
    //   · 'flatten'= 削平正面 + 补平板（多网格、有独立头网格，如 Kenney）
    if (style.faceMode === 'remap') {
      this.remapFaceUV(model, style, FR);
    } else {
      this.flattenFace(model, style, FR);
    }
  }

  /**
   * ★ 只重映射「正脸顶点」的 UV（不增删几何）—— 用于「单块网格 + 调色板贴图」模型
   *（Quaternius Cube Guy）。Kenney 那套 flattenFace 会把整个身体正面挖空。
   *
   * 原理：
   *  ① 头网格 = 全身那唯一一块 SkinnedMesh；"头部顶点"按**主导关节 == Head** 筛；
   *  ② "正脸"再按**法线的前向分量 > faceFacingMin** 筛（模型前向轴由 frontAxis 指定）；
   *  ③ 正脸顶点按 (左右轴, 高度轴) 的局部包围盒归一化 → 映射到脸图区 UV；
   *  ④ 因为模型原本只采样 8 个 texel，改 UV 后这些顶点就只读脸图区 →
   *     立绘就"贴"在脸上了，且**不会**串色到身体（身体 UV 一个都没动）。
   *
   * ★ 只在**本实例克隆出来的几何**上改，共享模板几何不动。
   */
  private remapFaceUV(
    model: THREE.Object3D,
    style: VisitorModelStyle,
    FR: { u0: number; u1: number; v0: number; v1: number },
  ): void {
    const head = findHeadMesh(model, style.headMeshName);
    if (!head) {
      console.warn('[VisitorModel] 未找到头部网格，跳过换脸（可用 style.headMeshName 指定）');
      return;
    }
    // ★ 关键：不能直接改共享模板的几何 —— 克隆一份自己的
    const src = head.geometry;
    const geo = src.clone();
    head.geometry = geo;
    this.ownGeometries.push(geo);

    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const jnt = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const wgt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (!pos || !nrm || !uv) {
      console.warn('[VisitorModel] 头部几何缺 position/normal/uv，跳过换脸');
      return;
    }
    // 前向 / 高度 / 左右 三个局部轴（★ 前向轴带符号：'-y' 表示脸朝局部 -y）
    const AXV: Record<'x' | 'y' | 'z', (i: number) => number> = {
      x: (i) => pos.getX(i),
      y: (i) => pos.getY(i),
      z: (i) => pos.getZ(i),
    };
    const NXV: Record<'x' | 'y' | 'z', (i: number) => number> = {
      x: (i) => nrm.getX(i),
      y: (i) => nrm.getY(i),
      z: (i) => nrm.getZ(i),
    };
    // 解析 frontAxis：'+y' / '-y' / 'x' …（不带符号时按 '+'）
    const rawFront = style.frontAxis ?? 'z';
    const fSign: number = rawFront.startsWith('-') ? -1 : 1;
    const fAxis = (rawFront.replace(/^[+-]/, '') || 'z') as 'x' | 'y' | 'z';
    const uAxis = style.upAxis ?? 'y';
    // 左右轴 = 剩下那个（x/y/z 中除 fAxis 与 uAxis 之外的）
    const rest = (['x', 'y', 'z'] as const).filter((a) => a !== fAxis && a !== uAxis);
    const lrAxis: 'x' | 'y' | 'z' = rest[0] ?? (fAxis === 'x' ? 'y' : 'x');
    const getF = AXV[fAxis];
    const getU = AXV[uAxis];
    const getL = AXV[lrAxis];
    const getNF = NXV[fAxis];

    // ① 头部主导顶点（主导关节 == Head 且权重 > 0.5）
    let headJoint = -1;
    if (jnt && wgt && head.skeleton) {
      headJoint = head.skeleton.bones.findIndex((b) => b.name === 'Head');
    }
    const isHeadDom = (i: number): boolean => {
      if (headJoint < 0 || !jnt || !wgt) return true; // 无法判定 → 全算（单网格小模型）
      let bw = 0;
      let bj = -1;
      for (let k = 0; k < 4; k++) {
        const w = wgt.getComponent(i, k);
        if (w > bw) { bw = w; bj = jnt.getComponent(i, k); }
      }
      return bj === headJoint && bw > 0.5;
    };
    // ② 正脸 = 头部主导 + 法线前向分量 > 阈值（★ 用 fSign 把"脸朝向"统一为正）
    const facingMin = style.faceFacingMin ?? CG_FACING_MIN;
    const face: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (!isHeadDom(i)) continue;
      if (getNF(i) * fSign < facingMin) continue;
      face.push(i);
    }
    if (face.length < 3) {
      console.warn('[VisitorModel] 正脸顶点过少（' + face.length + '），换脸跳过；',
        '可调 style.faceFacingMin / frontAxis / upAxis');
      return;
    }
    // ③ 正脸在 (左右, 高度) 平面上的包围盒
    let l0 = Infinity, l1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (const i of face) {
      const l = getL(i), u = getU(i);
      if (l < l0) l0 = l;
      if (l > l1) l1 = l;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
    }
    const lw = Math.max(1e-6, l1 - l0);
    const uh = Math.max(1e-6, u1 - u0);
    // ④ 映射到脸图区（texel 内缩；v=0 = 图顶 → 高度大的对应 v 小）
    const pu = FR.u0 + CG_FACE_PAD;
    const pu1 = FR.u1 - CG_FACE_PAD;
    const pv = FR.v0 + CG_FACE_PAD;
    const pv1 = FR.v1 - CG_FACE_PAD;
    for (const i of face) {
      const tl = (getL(i) - l0) / lw;
      const tu = (getU(i) - u0) / uh;
      uv.setXY(i, pu + tl * (pu1 - pu), pv + (1 - tu) * (pv1 - pv));
    }
    uv.needsUpdate = true;
    console.info('[VisitorModel] 换脸(remap)：正脸顶点 ' + face.length
      + '/' + pos.count + '，脸区 u ' + FR.u0.toFixed(3) + '..' + FR.u1.toFixed(3)
      + ' v ' + FR.v0.toFixed(3) + '..' + FR.v1.toFixed(3));
  }

  /** ★ 彻底削平头正面：删掉原正面 4 层小面片，开口处补一整块平面四边形
   *  （法线 +Z、跟随头骨骼），4 顶点 UV 直接映射到脸区矩形。
   *  只新建本实例几何并换给该 SkinnedMesh；共享模板几何不动。
   *  ★ 2026-09-16 解耦：头网格改为**自动推断**（原来写死 'head-mesh'）。 */
  private flattenFace(
    model: THREE.Object3D,
    style: VisitorModelStyle,
    FR: { u0: number; u1: number; v0: number; v1: number },
  ): void {
    const head = findHeadMesh(model, style.headMeshName);
    if (!head) {
      console.warn('[VisitorModel] 未找到头部网格，跳过换脸（可用 style.headMeshName 指定）');
      return;
    }
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
      { x: minX, y: maxY, u: FR.u0, v: FR.v0 },
      { x: maxX, y: maxY, u: FR.u1, v: FR.v0 },
      { x: minX, y: minY, u: FR.u0, v: FR.v1 },
      { x: maxX, y: minY, u: FR.u1, v: FR.v1 },
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
