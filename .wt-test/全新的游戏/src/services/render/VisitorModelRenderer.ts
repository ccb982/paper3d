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
  /** ★ 换脸策略（2026-09-16 最终只剩一个：'plate'）：
   *  · 'plate'（缺省）= **把前脸片几何真正压平** + 重映射 UV —— 用户要的
   *    「纯平脸 + 立绘」。只有这个模式能做出"平"的效果（只改 UV 时凸起的
   *    共面小方板照样看得见）。
   *  （历史上还有 'flatten'（删正面补平板，Kenney 用）与 'remap'（只改 UV，
   *     Cube Guy 中间方案）—— 两者都已删除：前者会把单块全身网格挖空，
   *    后者做不出"平"。2026-09-16 清理。） */
  faceMode?: 'plate';
  /** ★ 模型局部空间的**前向轴**。
   *  ★★ 带符号！ '+y' / '-y' / '+x' / '-x' / '+z' / '-z' 均可。
   *  Quaternius Cube Guy 实测：**'-y' 才是脸朝向**（FBX 惯例 y=前后，但脸在 -y）。
   *  判错方向的最典型症状 = **立绘糊在后脑勺上**。 */
  frontAxis?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
  /** ★ 模型局部空间的**高度轴**。Cube Guy 传 'z'。 */
  upAxis?: 'x' | 'y' | 'z';
  /** ★ **删掉眼睛浮雕**（用户定调「把眼睛删了就行了」）。
   *  眼睛浮雕范围用 CG_EYE_* 实测常量；只重排索引，蒙皮零错位。缺省 true。 */
  removeEyes?: boolean;
  /** ★ 脸面片的三维范围（模型局部坐标；用于压平与 UV 映射）。
   *  缺省用 Cube Guy 实测值。换模型时必须按新模型实测重标。 */
  facePlate?: {
    /** 脸区下界（高度轴上） */
    z0: number;
    /** 脸区上界（高度轴上） */
    z1: number;
    /** 该范围之外、比此值更靠后的顶点不参与压平（前后轴上；越靠脸越"小"取负） */
    projMin: number;
    /** 压平后的平面位置（前后轴上的投影值；越大越靠前） */
    flatProj: number;
  };
}

/** 走路动画的参考速度（米/秒；timeScale = speed / 此值，1 附近最自然） */
const WALK_REF_SPEED = 3.4;
/** sprint 切换阈值（× WALK_REF_SPEED） */
const SPRINT_MUL = 1.35;
/** 待机/走路的交叉淡化时长（秒） */
const FADE_SECONDS = 0.2;
/** ★ 脸区矩形缺省（UV；**Kenney Mini Characters** 那张 512 贴图的左上角空白区；
 *  v=0 = 图顶）。Cube Guy 用 visitors.ts 的 faceRect 覆盖 → 走 CG_FACE_* 那一套。 */
const FACE_U0 = 80 / 512;
const FACE_U1 = 312 / 512;
const FACE_V0 = 6 / 512;
const FACE_V1 = 230 / 512;
/** 头部侧面皮肤的调色板采样点（UV；用于脸区底色，避免脸图留白露黑底） */
const SKIN_UV = { u: 0.514, v: 0.847 };
/** 合成贴图边长（与底图一致） */
const ATLAS_SIZE = 512;

// ============================================================
// ★ Cube Guy 换脸参数（2026-09-16 探针实测，**已推翻并重写**）
// ============================================================
// Quaternius "Cube Guy"（visitor_cubeguy.glb）的真实情况（probe1-16 实测）：
//   · 全身是**一整块** `Character` 蒙皮网格（1794 顶点 / 3122 三角面），无独立头网格；
//   · 贴图 Atlas.png，整个模型**只采样 8 个 UV**（全在 v≈0.308..0.328 窄带）；
//   · ★★ **模型身上根本没有"画好的脸"**：脸面层(y=-0.005707) 与它对面的
//     后脑层(y=+0.005707) **采样同一个 texel `0.0665,0.3119`**，看起来一模一样
//     （都是纯肤色）。用户看到的"眼睛/头发"**全是几何浮雕**，不是贴图。
//     全模型只有 8 个顶点用了与众不同的 texel `0.3270,0.3251`（那才是唯一"细节色"）。
//   · 局部轴（probe10 手算节点四元数）：**y = 前后**（脸朝 **-y**）、**z = 高度**、x = 左右；
//     mesh 节点带 -90°X 旋转 → 局部 **-y → 世界 +Z**。而游戏里 yaw=atan2(dx,dz)
//     即"局部前向 = 世界 +Z" ⇒ **frontAxis:'-y' 正确**。
//   · 头是一个封闭方盒：y 完全对称（±0.005707），z 0.014933..0.028388；
//     两端各有一块 ~200 面的大平面（前=脸面层，后=后脑层，**外观无差别**）。
//   · 脸上的"五官"是共面小方板叠出来的浮雕：
//       眼睛浮雕 y ∈ (-0.005707, -0.0040]、z 0.021003..0.022260、|x| 0.0017..0.0060（100 面）
//       头发     z >= 脸面上沿 0.026036 的整个盒盖（462 面）
//       耳朵     |x|=0.006784、z 0.018930..0.021726（远低于脸面上沿 → 天然不被削，用户要保留）
//
// ★★ 两个必须记住的坑（都真实踩过）：
//  ① 判断"脸平不平"必须用**射线探针**，不能拿"正脸顶点 bbox 跨度"下结论
//     （0.0038 的跨度是把耳朵算进去造成的假象；脸面层自己跨度只有 3e-9）。
//  ② "取最靠前那一层"的**投影方向**极易搞反：proj = f * fSign 时，
//     "最靠前" = proj **最大**。写成最小会选中后脑层（fSign=-1 时最小= y 最大）。
//     症状 = 立绘整片糊到后脑勺。已加自检（层法线朝后则放弃换脸）。
//
// 做法：`faceMode:'plate'` —— 把「头正面」整片几何**真正压平**到一块平面 +
// 把这块平面的 UV 映射到贴图空白区画立绘 + 删掉眼睛浮雕面。
// （Kenney 那套「删正面补平板」会挖空整个身体正面，已删除不用。）
//
// 安全贴图区：模型自用 texel 全在 v≈0.308..0.328；脸图区选下方空白区，实测无采样。
/** texel 内缩（避免线性过滤把相邻 texel 混进来） */
const CG_FACE_PAD = 0.5 / 32;

// ---- 眼睛浮雕参数（probe7-13 实测坐标，模型局部 z=高度 / y=前后 / x=左右）----
/** 眼睛浮雕的 z 带 与 |x| 带 */
const CG_EYE_Z0 = 0.0208;
const CG_EYE_Z1 = 0.0223;
const CG_EYE_AX0 = 0.0017;
const CG_EYE_AX1 = 0.0060;
/** 眼睛浮雕的最深 y（实测 -0.004097）——它位于脸面层**之后**（y 更大） */
const CG_EYE_Y_MAX = -0.0040;

// ============================================================
// ★★ 脸面片（probe17-24 实测，2026-09-16 定案 —— 这是第 4 次也是最后一次修正）
// ============================================================
// 【踩坑回顾】前三版全错在**分不清"脸"与"额头/头发"**：
//   ① 第 1 版：拿"最靠前那一层"当脸 → 它是 y=-0.005707 的 33 顶点，
//      形状是**左侧鬓角 + 额前刘海**（L 形，下半边只有左半边，上半边才全宽），
//      根本不含眼睛 —— 于是立绘糊在额头上，用户说"纹理绘制在前面头发上"。
//   ② 第 2 版：拿 "z >= 脸面上沿 0.026036" 当头发削掉 → 头是**封闭方盒**，
//      这等于把**整个头顶**削了 —— 用户说"你把头顶头发弄没了"。
//   ③ 第 3 版：以为头发垂在脸前 → **射线探针（probe24）证明：脸区 45%~82% 高度
//      区间内，0 个采样点被头发遮挡**。头发全在 z>=0.026（82.5% 以上），
//      **不存在"垂在脸前的刘海"**。
//
// 【真相 —— 这个头的层级结构（探针实测）】
//   z 0.014933..0.026036  ← **头正面**（一个封闭方盒的正面；下巴底 → 发际线）
//     其中 z 45.1%..53.4% (0.021003..0.022119) 是**眼睛浮雕**（法线朝前）
//   z >= 82.5%   (0.026036..)  ← **头发盖**（薄圈带 352 面 + 顶隆起 110 面）
//   脸朝 -y；头盒 y 完全对称 ±0.005707。
//
// 【最终方案】用户定调：「整个前脸片全削平再贴」+「扩大脸面到整个头正面」
//   +「头发只去掉靠近脸的，其余保留」+「把眼睛删了就行了」。
//   · 压平：把「头正面」范围内（z ∈ [0.014933, 0.026036] 且 proj >= 0.0038）
//     的所有顶点，沿前向轴推到同一平面 CG_PLATE_FLAT_PROJ → **真正的一块平面**；
//   · 脸面因此是 0.0130 宽 × 0.0111 高 ≈ **1.17:1** 的近方形（立绘比例自然）；
//   · 眼睛浮雕：**整面删除**（只重排索引；实测命中 100 面）—— 用户明确要求，
//     压平（第 4 轮方案）之外再补这一步；
//   · 头发**完全不动**：射线探针证明它不挡脸，且用户要保留。
//
// 【为什么必须"压平几何"而不是只改 UV】
//   只改 UV 时几何仍是凸的，共面小方板的高低差照样看得见；
//   用户要的是「纯平脸」，只有真的把顶点推到同一平面才成立。
/** 脸面片下界（高度轴）—— ★ 用户定调「扩大脸面到整个头正面」：
 *  取**头的底面 0.014933**（不是眼睛下沿 0.0210）→ 脸面从下巴一直到发际线，
 *  得到 0.0130 宽 × 0.0111 高 ≈ **1.17:1** 的近方形脸面，立绘比例自然。 */
const CG_PLATE_Z0 = 0.014933;
/** 脸面片上界（高度轴；= 发际线 0.026036，头发从这里开始，不动头发） */
const CG_PLATE_Z1 = 0.026036;
/** 参与压平的"最靠后"投影值：只压 proj >= 此值的顶点（避免把后脑/脖子拉进来） */
const CG_PLATE_PROJ_MIN = 0.0038;
/** 压平后的平面投影值（越靠前越大；取实测最前 0.005707 + 少量凸出消 z-fighting） */
const CG_PLATE_FLAT_PROJ = 0.00585;

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

/** ★ 解析换脸用的三根局部轴 + 前向符号。
 *
 *  · 前向轴：`style.frontAxis`（**带符号**，如 Cube Guy 的 '-y'），缺省 'z'。
 *    ★★ 符号判错的最典型症状 = 立绘整片糊到后脑勺（且不报任何错）。
 *  · 高度轴：`style.upAxis`，缺省 'y'。
 *  · 左右轴：剩下那根（三轴必然互不相同）。
 *  · fSign：前向轴符号（'-' 给 -1，否则 +1）。所有"越靠脸越靠前"的投影量都乘它，
 *    于是统一成"**proj 越大越靠前**"，后续比较不必再分正负两种情况。
 */
function resolveAxes(style: VisitorModelStyle): {
  fAxis: 'x' | 'y' | 'z';
  uAxis: 'x' | 'y' | 'z';
  lrAxis: 'x' | 'y' | 'z';
  fSign: 1 | -1;
} {
  const rawFront = style.frontAxis ?? 'z';
  const fSign: 1 | -1 = rawFront.startsWith('-') ? -1 : 1;
  const fAxis = (rawFront.replace(/^[+-]/, '') || 'z') as 'x' | 'y' | 'z';
  const uAxis = (style.upAxis ?? 'y') as 'x' | 'y' | 'z';
  const lrAxis = (['x', 'y', 'z'] as const).find((a) => a !== fAxis && a !== uAxis) ?? 'x';
  return { fAxis, uAxis, lrAxis, fSign };
}

/** ★ 生成"该顶点是否由 Head 关节主导"的判定函数。
 *
 *  做法：取 skinWeight 最大的那一路，看它指向的关节是不是 `Head`，且权重 > 0.5。
 *  ★ 关节索引比较的是 **skinIndex 里存的值**（那是相对 `skin.joints` 的下标，
 *    不是节点下标）—— 所以用骨架自身的 `bones.findIndex` 求 Head，两者同域。
 *  找不到 Head 骨 / 没有蒙皮属性时返回恒 false 的判定（调用方会因命中过少而警告跳过）。
 */
function makeHeadDomTest(
  head: THREE.SkinnedMesh,
  jnt: THREE.BufferAttribute | undefined,
  wgt: THREE.BufferAttribute | undefined,
): (i: number) => boolean {
  const headJoint = head.skeleton?.bones.findIndex((b) => b.name === 'Head') ?? -1;
  if (!jnt || !wgt || headJoint < 0) return () => false;
  return (i: number): boolean => {
    let bw = 0;
    let bj = -1;
    for (let k = 0; k < 4; k++) {
      const w = wgt.getComponent(i, k);
      if (w > bw) { bw = w; bj = jnt.getComponent(i, k); }
    }
    return bj === headJoint && bw > 0.5;
  };
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
    // ★ 立绘按 contain 铺（不变形）：faceRect 已按脸面比例选取 → 正常情况刚好铺满；
    //   万一比例不匹配，宁可留底色也不拉伸（拉伸过的立绘一眼假）。
    const rectW = x1 - x0;
    const rectH = y1 - y0;
    const imgW = (face as HTMLCanvasElement).width || 1;
    const imgH = (face as HTMLCanvasElement).height || 1;
    const s = Math.min(rectW / imgW, rectH / imgH);
    const dw = imgW * s;
    const dh = imgH * s;
    ctx.drawImage(face, x0 + (rectW - dw) / 2, y0 + (rectH - dh) / 2, dw, dh);
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
    // ★ 换脸落点：'plate' = 把前脸片几何**真正压平** + 重映射 UV + 删眼睛浮雕
    //   （这是 2026-09-16 收敛后的唯一策略；'flatten'/'remap' 已删除，见类型注释）
    this.flattenFacePlate(model, style, FR);
  }

  /**
   * ★★★ 把「前脸片」几何**真正压平**成一块平面 + 重映射 UV + 删眼睛浮雕
   *   —— Cube Guy 的最终（也是唯一）换脸方案。
   *
   * 为什么必须"压平几何"而不是只改 UV：只改 UV 时几何仍是凸的，共面小方板的
   * 高低差照样看得见；用户要的是「纯平脸 + 立绘」，只有真把顶点推到同一平面才成立。
   *
   * 判据（全部探针实测，见文件头 CG_PLATE_* 注释）：
   *  ① 头网格 = 唯一那块 SkinnedMesh，头部顶点按**主导关节 == Head** 筛；
   *  ② 前脸片 = 头部顶点里满足「高度 ∈ [z0, z1] ∧ 前向投影 >= projMin」的那些；
   *  ③ 把这些顶点的前向坐标统一设为 flatProj → 一块平面；
   *  ④ 同时把法线改成**纯前向** (0,±1,0)（随 fAxis），否则压平后光照还是花的；
   *  ⑤ 前脸片顶点按 (左右, 高度) 归一化 → 映射到脸图区 UV；
   *  ⑥ 按用户定调删掉眼睛浮雕面（只重排索引，蒙皮零错位）。
   *
   * ★ 头发完全不动：probe24 射线探针证明脸区 45%~82% 高度内 **0 个采样点被头发遮挡**，
   *   "垂在脸前的刘海"在本模型上不存在。用户要「其余头发保留」。
   *
   * ★ 只在**本实例克隆出来的几何**上改，共享模板几何不动。
   */
  private flattenFacePlate(
    model: THREE.Object3D,
    style: VisitorModelStyle,
    FR: { u0: number; u1: number; v0: number; v1: number },
  ): void {
    const head = findHeadMesh(model, style.headMeshName);
    if (!head) {
      console.warn('[VisitorModel] 压平脸：未找到头部网格，跳过（可用 style.headMeshName 指定）');
      return;
    }
    // 不能直接改共享模板几何
    let geo = head.geometry;
    if (!this.ownGeometries.includes(geo)) {
      geo = head.geometry.clone();
      head.geometry = geo;
      this.ownGeometries.push(geo);
    }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const jnt = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const wgt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (!pos || !nrm || !uv) {
      console.warn('[VisitorModel] 压平脸：几何缺 position/normal/uv，跳过');
      return;
    }
    const { fAxis, uAxis, lrAxis, fSign } = resolveAxes(style);
    const isHeadDom = makeHeadDomTest(head, jnt, wgt);
    // 分轴读写器（Cube Guy: fAxis='y', uAxis='z', lrAxis='x'）
    const getF = (i: number) => (fAxis === 'x' ? pos.getX(i) : fAxis === 'y' ? pos.getY(i) : pos.getZ(i));
    const getU = (i: number) => (uAxis === 'x' ? pos.getX(i) : uAxis === 'y' ? pos.getY(i) : pos.getZ(i));
    const getL = (i: number) => (lrAxis === 'x' ? pos.getX(i) : lrAxis === 'y' ? pos.getY(i) : pos.getZ(i));
    const setF = (i: number, v: number) => {
      if (fAxis === 'x') pos.setX(i, v); else if (fAxis === 'y') pos.setY(i, v); else pos.setZ(i, v);
    };
    const setNF = (i: number, v: number) => {
      if (fAxis === 'x') nrm.setX(i, v); else if (fAxis === 'y') nrm.setY(i, v); else nrm.setZ(i, v);
    };

    // 范围：内置实测值（Cube Guy）或 style 覆盖
    const FP = style.facePlate;
    const pz0 = FP?.z0 ?? CG_PLATE_Z0;
    const pz1 = FP?.z1 ?? CG_PLATE_Z1;
    const projMin = FP?.projMin ?? CG_PLATE_PROJ_MIN;
    const flatProj = FP?.flatProj ?? CG_PLATE_FLAT_PROJ;

    // ② 选前脸片顶点
    const plate: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (!isHeadDom(i)) continue;
      const u = getU(i);
      if (u < pz0 || u > pz1) continue;
      if (getF(i) * fSign < projMin) continue;   // 太靠后（后脑/侧后）不要
      plate.push(i);
    }
    if (plate.length < 3) {
      console.warn('[VisitorModel] 压平脸：前脸片顶点过少（' + plate.length + '），跳过；',
        '可调 style.facePlate / frontAxis / upAxis');
      return;
    }

    // ③ 压平 + 法线拉直；④ 同时记录 (左右, 高度) 包围盒用于 UV 映射
    let l0 = Infinity, l1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (const i of plate) {
      const l = getL(i), u = getU(i);
      if (l < l0) l0 = l;
      if (l > l1) l1 = l;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
    }
    const lw = Math.max(1e-6, l1 - l0);
    const uh = Math.max(1e-6, u1 - u0);

    // ★★ UV 映射：把脸面的 (左右, 高度) 线性映射到脸图区。
    //
    // 【关键】脸图区（faceRect）的**宽高比必须与脸面宽高比一致** —— 否则要么
    //   拉伸立绘、要么裁剪掉大半（曾踩坑：脸 1.169:1 vs 立绘区 0.625:1，
    //   走"横铺+纵裁"后立绘只用了 36% 高度，看起来像"没贴上/只贴了一半"）。
    //   新 faceRect 已按脸面比例（1.169:1）选取，此处直接用满，不做裁剪。
    //
    // 方向：v=0 = 图顶（glTF flipY=false）。高度大的（额头）→ v 小（靠图顶），
    //   故用 (1 - tu)。这样立绘的"头顶在上、下巴在下"与模型一致。
    const pu = FR.u0 + CG_FACE_PAD;
    const pu1 = FR.u1 - CG_FACE_PAD;
    const pv = FR.v0 + CG_FACE_PAD;
    const pv1 = FR.v1 - CG_FACE_PAD;

    for (const i of plate) {
      setF(i, flatProj * fSign);          // ★ 沿前向推到同一平面（fSign=-1 时得到 -0.00585）
      setNF(i, fSign);                    // ★ 法线拉直成纯前向，否则压平后光照还是花的
      const tl = (getL(i) - l0) / lw;
      const tu = (getU(i) - u0) / uh;
      uv.setXY(i, pu + tl * (pu1 - pu), pv + (1 - tu) * (pv1 - pv));
    }
    // ⑤ 删眼睛浮雕（用户定调「把眼睛删了就行了」）
    //    眼睛浮雕实测：z ∈ [0.0208, 0.0223]、|x| ∈ [0.0017, 0.0060]、
    //    且位于脸面层**之后**（proj < 最前层）、不比 -0.0040 更深。
    //    ★ 判据用**三角形三顶点全中**才删，避免误伤脸颊/鼻子。
    //    ★ 只重排索引，不动顶点缓冲 → 蒙皮属性零错位。
    let eyeFaces = 0;
    if (style.removeEyes !== false) {
      const idx = geo.getIndex();
      if (idx) {
        const eyeProjMin = CG_EYE_Y_MAX * fSign;
        const isEyeVert = (i: number): boolean => {
          const u = getU(i);
          const ax = Math.abs(getL(i));
          const proj = getF(i) * fSign;
          if (u < CG_EYE_Z0 || u > CG_EYE_Z1) return false;
          if (ax < CG_EYE_AX0 || ax > CG_EYE_AX1) return false;
          if (proj < eyeProjMin) return false;
          return true;
        };
        const oldIdx = idx.array;
        const newIdx: number[] = [];
        for (let t = 0; t < oldIdx.length; t += 3) {
          const a = oldIdx[t];
          const b = oldIdx[t + 1];
          const c = oldIdx[t + 2];
          if (isEyeVert(a) && isEyeVert(b) && isEyeVert(c)) { eyeFaces++; continue; }
          newIdx.push(a, b, c);
        }
        if (eyeFaces > 0) {
          // ★ count 是只读属性 → 换一个新的 BufferAttribute（沿用原 array 类型）
          const Src = (oldIdx as unknown as { constructor: new (a: number[]) => ArrayLike<number> }).constructor;
          geo.setIndex(new THREE.BufferAttribute(new Src(newIdx) as never, 1));
        }
      }
    }

    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    uv.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    console.info('[VisitorModel] 压平脸：顶点 ' + plate.length + '/' + pos.count
      + '（高度 ' + pz0.toFixed(4) + '..' + pz1.toFixed(4)
      + '，压到 proj=' + flatProj.toFixed(5) + '）'
      + (eyeFaces > 0 ? '，删眼睛 ' + eyeFaces + ' 面' : '')
      + '，脸区 u ' + FR.u0.toFixed(3) + '..' + FR.u1.toFixed(3)
      + ' v ' + FR.v0.toFixed(3) + '..' + FR.v1.toFixed(3));
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
