// ============================================================
// viewer —— Three.js 3D 视图：把 10 个海猫组件当成"护甲板"贴在 10 个刚体上
// ============================================================
// ★★ 视觉方案（用户定调）：3D 真骨架 + 每个环节正面贴一张组件当护甲板 + 骨架本身隐藏。
//   · 骨架（胶囊/脚掌盒的线框）默认**不渲染** —— 只有打开「显示关节」才出现，
//     那是排查穿模时的诊断视图，不是给人看的最终画面。
//   · 护甲板跟着刚体的**完整四元数**走，所以刚体一旦在 3D 里翻转，板子跟着翻 ——
//     这才是"贴在身上"，不是"贴在屏幕上"。
//
// ★ 板子的朝向（qFix）：PlaneGeometry 的本地面是 XY、法线 +Z；
//   我们要它 法线 = 刚体本地 +X（角色正面）、板内右 = 刚体本地 −Z、板内上 = +Y。
//   对应"绕 Y 转 +90°"：+Z→+X（法线）、+X→−Z（板内右）、+Y→+Y（板内上）。
//   为什么板内右必须是 −Z：从正面（相机在 +X 看向 −X，up=+Y）看过去屏幕右 = −Z，
//   而素材的"画布右"必须落在屏幕右，否则人形会左右镜像。见 skeleton.ts 的 mapZ。
//
// ★ 绘制顺序：3D 之后不能再按美术定的固定 z 值排（parts.json 的 z 只在"正面平铺"时成立）。
//   相机一转，挥到身前的胳膊应该在躯干**前面**。所以每帧按**真实深度**（相机前方向上的
//   投影距离）从远到近排 renderOrder，parts.json 的 z 只作为深度接近时的次级判据。
//
// ★★ 躯干是「一张贴图 + 骨架折叠」——**不是**切成 K 张图（用户定调）。
//   物理上躯干是 spineSegments 段独立刚体（见 skeleton.ts），视觉上却只有一个 mesh：
//     · geometry = PlaneGeometry(w, H, 1, K·SUB) —— 一整块布，UV 连续覆盖整张贴图；
//     · 每个顶点按它落在脊柱的哪一段上，拿两段刚体的世界变换做**线性混合蒙皮**（LBS）。
//   这样弯腰时贴图沿脊柱连续弯折，接缝处不会出现"每段各画一张整图"的**蜈蚣**。
//   ★ 曾经的错误实现：每个脊柱刚体各建一个 PlaneGeometry(w, h)（h = 整块高度）
//     ⇒ 4 段各画一张完整躯干图、沿脊柱堆叠 ⇒ 就是那条蜈蚣。
//
//   蒙皮的绑定（bind）姿态 = 刚体全部单位旋转时的姿态（ragdoll 出生状态）：
//     顶点绑定世界位置 rest(px,py) = (0, cyC + py, cz − px)
//       —— qFix（绕 Y +90°）把板内 (px, py) 映射成世界 (0, py, −px)，见上面的朝向说明。
//     顶点 v ∈ [0, K−1] 表示它落在第几段的中心线上：v = (py + H/2)/H·K − 0.5，
//     取 floor 得主段 s0、小数部分作次段 s1 = s0+1 的权重（标准 LBS）。
//     ⇒ 每帧 pos = w0·(T_s0 + R_s0·loc0) + w1·(T_s1 + R_s1·loc1)，直接写世界坐标。
//   ★ 因此蒙皮 mesh 必须 frustumCulled = false（顶点每帧变，包围球失效）。
//
// 整代视图（ghost）：population 个个体各画 9 条骨架线，合成一个 LineSegments，
//   每帧只改一个 Float32Array —— 比渲染几百块贴图便宜两个数量级。

import * as THREE from 'three';
import { META } from '../core/partsMeta';
import { invQuatOf, restVisualQuatOf, type Skeleton } from '../core/skeleton';
import type { Ragdoll } from '../core/ragdoll';
import type { Trainer } from '../core/evolution';

/** 相机球坐标默认值：方位角 41° / 俯角 15° / 距离 4.4m */
const DEFAULT_AZ = 0.72;
const DEFAULT_EL = 0.26;
const DEFAULT_DIST = 4.4;

export interface ViewerOptions {
  /** 贴图根路径（public 下） */
  assetBase?: string;
  /**
   * ★ 是否画 3D 方向标（左/右/前/后的地面箭头 + 文字）。默认开。
   *   见 `buildAxisMarkers`：本 rig 的左右**不在 X 上而在 Z 上**，
   *   且 `+Z = 左`（实测左脚 z=+164mm、右脚 z=−164mm）——
   *   不标出来几乎必然看反。
   */
  showAxisMarkers?: boolean;
}

/**
 * ★★ 本 rig 的**轴约定**（实测，不是猜的；`ragdoll.ts` 的 `rs.grf.y = 686.7×载荷`
 *   是竖直分量，据此可确认 y=竖直）：
 *
 *       **x = 矢状（+x 朝前）　y = 竖直（+y 朝上）　z = 额状（+z = 左）**
 *
 *   左/右为什么落在 z 上：素材是正面视图，`mapZ` 取负 ⇒ 画布 x 小的**左脚
 *   在世界 +Z**、右脚在 −Z（实测 ±164mm）。所以 `+Z = 左`。
 *   这个约定与 Three.js 相机默认（+X 右）**相反**，所以必须在画面上标出来。
 */
export const AXIS_CONVENTION = {
  x: '前 +x', y: '上 +y', z: '左 +z（−z = 右）',
} as const;

/**
 * ★★ 躯干护甲蒙皮 —— 纯函数部分（不含 WebGL），故意从 Viewer 里拆出来：
 *    把"一张贴图 + 骨架折叠"这件事变成可以**离屏断言**的数学，
 *    而不是只能靠截图判断（见 tools/probe-skin.ts）。
 *
 * 绑定（bind）姿态 = 各段刚体**全部单位旋转**时的姿态（ragdoll 出生状态）。
 * 顶点在板内的坐标 (px, py) 经 qFix（绕 Y +90°）→ 世界 (0, py, −px)，再加板心 (0, cyC, cz)：
 *     rest(px, py) = (0, cyC + py, cz − px)
 * 顶点归段：v = (py + H/2)/H·K − 0.5，主段 s0 = floor(v)、次段 s1 = s0+1、次段权重 = v − s0
 *    （段中心处 v = 段号 ⇒ 整数 ⇒ 权重 0 ⇒ 该顶点 100% 刚性跟随该段）。
 * 每帧：pos = w0·(T_s0 + R_s0·loc0) + w1·(T_s1 + R_s1·loc1)，
 *   其中 loc_s = rest − T_s^bind 是该顶点在段 s 本地系里的绑定坐标。
 */
export interface SkinBinding {
  /** 驱动刚体下标，从下（骨盆）到上（胸腔） */
  segBody: number[];
  vCount: number;
  /** 每个顶点的绑定：主段 / 次段 / 次段权重 */
  vS0: Int32Array;
  vS1: Int32Array;
  vW1: Float32Array;
  /** 每个顶点在【主段 / 次段】刚体本地坐标系里的绑定坐标 */
  loc0: Float32Array;
  loc1: Float32Array;
  /** 绑定姿态下的世界位置 —— 蒙皮收敛性判据（单位旋转时输出必须等于它） */
  bindPos: Float32Array;
  /** 板面几何（米）：宽 / 高 / 板心 y / 板心 z / 网格行数 */
  w: number;
  H: number;
  cyC: number;
  cz: number;
  rows: number;
}

export function buildSkinBinding(sk: Skeleton, segIdx: number[], sub = 6): SkinBinding {
  const segs = [...segIdx].sort(
    (a, b) => sk.bodies[a].texSlice!.index - sk.bodies[b].texSlice!.index,
  );
  const K = segs.length;

  // 板子要覆盖整摞段：y 取所有段的并集。
  // 躯干是高瘦件（bh > bw）⇒ 这段联合区间正好等于 part.bh·px2m，即原来的整块高度，
  // 贴图不会被拉伸。若哪天躯干变成宽扁件，这里会按实际刚体跨度铺板（仍不裁图）。
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const i of segs) {
    const b = sk.bodies[i];
    yLo = Math.min(yLo, b.cy - b.length / 2);
    yHi = Math.max(yHi, b.cy + b.length / 2);
  }
  const H = yHi - yLo;
  const cyC = (yHi + yLo) / 2;
  const cz = sk.bodies[segs[0]].cz;
  const w = sk.bodies[segs[0]].part.bw * sk.px2m;

  const rows = Math.max(1, Math.round(K * sub));
  const vCount = (rows + 1) * 2;

  const vS0 = new Int32Array(vCount);
  const vS1 = new Int32Array(vCount);
  const vW1 = new Float32Array(vCount);
  const loc0 = new Float32Array(vCount * 3);
  const loc1 = new Float32Array(vCount * 3);
  const bindPos = new Float32Array(vCount * 3);

  for (let i = 0; i < vCount; i++) {
    const iy = (i / 2) | 0;
    const ix = i % 2;
    const py = H / 2 - (iy / rows) * H;   // 板内高度（米），+ 朝上
    const px = ix * w - w / 2;            // 板内横向（米），+ 朝画布右

    const by = cyC + py;
    const bz = cz - px;

    // 顶点落在第几段的中心线上：段中心处 v = 段号，段交界处 v = x.5
    let v = ((py + H / 2) / H) * K - 0.5;
    if (v < 0) v = 0;
    else if (v > K - 1) v = K - 1;
    const s0 = Math.min(K - 1, Math.floor(v));
    const s1 = Math.min(K - 1, s0 + 1);
    vS0[i] = s0;
    vS1[i] = s1;
    vW1[i] = s0 === s1 ? 0 : v - s0;

    // 相对各段刚体**绑定姿态**的本地坐标（绑定姿态旋转 = 单位阵 ⇒ 直接相减）
    const b0 = sk.bodies[segs[s0]];
    const b1 = sk.bodies[segs[s1]];
    loc0[i * 3] = -b0.cx;
    loc0[i * 3 + 1] = by - b0.cy;
    loc0[i * 3 + 2] = bz - b0.cz;
    loc1[i * 3] = -b1.cx;
    loc1[i * 3 + 1] = by - b1.cy;
    loc1[i * 3 + 2] = bz - b1.cz;

    bindPos[i * 3] = 0;
    bindPos[i * 3 + 1] = by;
    bindPos[i * 3 + 2] = bz;
  }

  return { segBody: segs, vCount, vS0, vS1, vW1, loc0, loc1, bindPos, w, H, cyC, cz, rows };
}

/** 绑定姿态下各段刚体的平移（= 板心 + 段偏移），可直接喂给 skinPositions 做恒等检查 */
export function bindSegPositions(sk: Skeleton, b: SkinBinding, out: Float64Array): void {
  for (let s = 0; s < b.segBody.length; s++) {
    const body = sk.bodies[b.segBody[s]];
    out[s * 3] = body.cx;
    out[s * 3 + 1] = body.cy;
    out[s * 3 + 2] = body.cz;
  }
}

/** 单位旋转矩阵（行主序 3×3）逐段铺开 —— 与 bindSegPositions 配对做收敛性检查 */
export function identitySegRotations(b: SkinBinding, out: Float64Array): void {
  for (let s = 0; s < b.segBody.length; s++) {
    const rp = s * 9;
    out[rp] = 1; out[rp + 1] = 0; out[rp + 2] = 0;
    out[rp + 3] = 0; out[rp + 4] = 1; out[rp + 5] = 0;
    out[rp + 6] = 0; out[rp + 7] = 0; out[rp + 8] = 1;
  }
}

/**
 * 逐顶点线性混合蒙皮：把绑定姿态的顶点按各段刚体的当前位姿混合到**世界坐标**。
 * @param segT K×3 各段刚体的世界平移
 * @param segR K×9 各段刚体的世界旋转（行主序 3×3）
 * @param out  长度必须 = binding.vCount × 3
 */
export function skinPositions(
  b: SkinBinding, segT: Float64Array, segR: Float64Array, out: Float32Array,
): void {
  const n = b.vCount;
  const loc0 = b.loc0;
  const loc1 = b.loc1;
  const vS0 = b.vS0;
  const vS1 = b.vS1;
  const vW1 = b.vW1;
  for (let i = 0; i < n; i++) {
    const i0 = vS0[i], i1 = vS1[i];
    const r0 = i0 * 9, r1 = i1 * 9;
    const t0 = i0 * 3, t1 = i1 * 3;
    const a = i * 3;
    const l0x = loc0[a], l0y = loc0[a + 1], l0z = loc0[a + 2];
    const l1x = loc1[a], l1y = loc1[a + 1], l1z = loc1[a + 2];

    const ax = segR[r0] * l0x + segR[r0 + 1] * l0y + segR[r0 + 2] * l0z + segT[t0];
    const ay = segR[r0 + 3] * l0x + segR[r0 + 4] * l0y + segR[r0 + 5] * l0z + segT[t0 + 1];
    const az = segR[r0 + 6] * l0x + segR[r0 + 7] * l0y + segR[r0 + 8] * l0z + segT[t0 + 2];
    const w1 = vW1[i];
    if (w1 <= 0) {
      out[a] = ax; out[a + 1] = ay; out[a + 2] = az;
    } else {
      const w0 = 1 - w1;
      const bx = segR[r1] * l1x + segR[r1 + 1] * l1y + segR[r1 + 2] * l1z + segT[t1];
      const by = segR[r1 + 3] * l1x + segR[r1 + 4] * l1y + segR[r1 + 5] * l1z + segT[t1 + 1];
      const bz = segR[r1 + 6] * l1x + segR[r1 + 7] * l1y + segR[r1 + 8] * l1z + segT[t1 + 2];
      out[a] = w0 * ax + w1 * bx;
      out[a + 1] = w0 * ay + w1 * by;
      out[a + 2] = w0 * az + w1 * bz;
    }
  }
}

/** 蒙皮板：一张贴图 + 一条网格 + K 个驱动刚体（躯干脊柱段） */
interface SkinGroup {
  mesh: THREE.Mesh;
  /** ★ 纯数据部分（绑定 + 每帧蒙皮解算）—— 与 WebGL 无关，可离屏验收 */
  b: SkinBinding;
  /** 输出缓冲：顶点世界坐标（直接就是 geometry 的 position 属性数组） */
  pos: Float32Array;
  /** 每段的当前平移（K×3）与旋转矩阵行主序（K×9），每帧刷新 */
  segT: Float64Array;
  segR: Float64Array;
  /** 深度排序代表点（取中间那段） */
  sortPos: THREE.Vector3;
}

/**
 * ★★ 护甲板分组规则（唯一真源）—— **一块板 = 一个组件**，不是"一个刚体一块板"。
 *   躯干被切成 K 段独立刚体，但它们共用同一张贴图 ⇒ 合成**唯一一个**蒙皮组、
 *   只建一个 mesh。曾经按"每刚体一块板 + 每块画整张图"实现，结果躯干变成 4 张
 *   叠起来的完整躯干图 = 蜈蚣。
 *
 *   抽成纯函数是为了让 viewer 与离屏验收（tools/probe-skin.ts）共用同一条规则：
 *   板数必须恒等于 `META.parts.length`。
 *
 * @returns plain   单刚体板（每块板 1 个刚体，各画自己那张整图）
 *          skinned 组成**那一个**蒙皮组的刚体下标（从骨盆到胸腔）。
 *                  空数组 = 躯干未分段（spineSegments = 1）⇒ 躯干也走 plain。
 */
export function groupPlates(sk: Skeleton): { plain: number[]; skinned: number[] } {
  const plain: number[] = [];
  const skinned: number[] = [];
  for (let i = 0; i < sk.bodies.length; i++) {
    if (sk.bodies[i].texSlice) skinned.push(i);
    else plain.push(i);
  }
  // 按切片下标排序，保证"从骨盆到胸腔"的顺序与蒙皮绑定一致
  skinned.sort((a, b) => sk.bodies[a].texSlice!.index - sk.bodies[b].texSlice!.index);
  return { plain, skinned };
}

/** 一块护甲板的渲染槽位 —— ★ 槽位数 = 组件数，不是刚体数 */
interface PlateSlot {
  mesh: THREE.Mesh;
  /** 驱动刚体下标：单片板 1 个，蒙皮板 K 个 */
  drivers: number[];
  /** 非 null = 蒙皮板（躯干） */
  skin: SkinGroup | null;
  sortPos: THREE.Vector3;
  /**
   * ★★ 该刚体**静倾角的逆**四元数。
   *
   * 用户定调（2026-10-01）："纹理别动，调整关节的倾斜度" ——
   * 贴图在静姿态下必须与素材**逐像素一致**（不转、不移、不缩）。
   * 而刚体/碰撞体要沿实测中轴倾斜（物理胶囊得和贴图同向，否则碰撞体是竖直的、
   * 会戳出贴图外面）。两者用同一个"相对静姿态的增量旋转" qRel 统一：
   *     qRel = qBody ⊗ restTilt⁻¹
   * 静姿态（qBody = restTilt）时 qRel = 单位四元数 ⇒ 贴图**完全不动**；
   * 动力学一旦转动，qRel 就是纯增量 ⇒ 贴图正常跟随。
   * 位置同理：贴图心 = 刚体位置 + qRel · plateOffset（plateOffset 已在骨架里
   * 按 restTilt⁻¹ 折算好），保证静姿态下精确落回素材位置。
   */
  qRestInv: THREE.Quaternion;
  /** 脚掌板绕竖直轴的额外 90°（其余板子为单位四元数） */
  qYaw90: THREE.Quaternion;
}

export class Viewer {
  /** 每段脊柱刚体上再细分几行 —— 越大弯折越圆滑。顶点数 = 2·(K·SUB+1)，可忽略 */
  private static readonly SKIN_SUB = 6;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /**
   * 护甲板槽位。★ 不是"与 skeleton.bodies 一一对应"：躯干被切成 K 段**物理刚体**，
   * 视觉上仍是**一块板**（单 mesh + 单贴图 + 蒙皮），所以槽位数 = 组件数，不是刚体数。
   */
  private readonly plates: PlateSlot[] = [];
  /** 每个刚体的物理线框（胶囊 + 脚掌盒），与 bodies 一一对应 */
  private readonly boneGroups: THREE.Group[] = [];
  private readonly ghost: THREE.LineSegments;
  private readonly ghostPos: Float32Array;
  private readonly ghostSegPer = 9;
  private readonly jointDots: THREE.Points;
  private readonly jointPos: Float32Array;
  private readonly canvas: HTMLCanvasElement;
  private readonly ro?: ResizeObserver;

  /** 护甲板朝向：绕 Y +90°（见文件头） */
  private readonly qFix = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), Math.PI / 2,
  );
  private readonly qBody = new THREE.Quaternion();
  /** 相对静姿态的增量朝向（qBody ⊗ restTilt⁻¹） */
  private readonly qRel = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly sortDir = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly depths: Float64Array;
  private readonly order: number[];

  /** 关掉护甲板，只看物理（排查穿模/关节问题时用） */
  showTextures = true;
  /** 显示整代骨架 */
  showGhost = false;
  /** ★ 显示**骨架本体**（胶囊线框）—— 默认关，符合"把火柴人隐藏"的定调 */
  showJoints = false;
  /** 相机跟随展示个体（人学会走就会跑出固定视野） */
  followShowcase = true;
  /** 跟随时间常数（秒）。越大越"懒"，0.18s 观感比较自然，且与帧率无关 */
  followTau = 0.18;

  // ---- 相机球坐标 ----
  camAz = DEFAULT_AZ;
  camEl = DEFAULT_EL;
  camDist = DEFAULT_DIST;
  private readonly target = new THREE.Vector3(0, 1.0, 0);

  constructor(canvas: HTMLCanvasElement, sk: Skeleton, population: number, opt: ViewerOptions = {}) {
    this.canvas = canvas;
    const assetBase = opt.assetBase ?? '';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xeef1f4, 1);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(4, 1.6, 2);
    this.camera.lookAt(this.target);

    // ---- 地面 + 三维距离网格 ----
    this.scene.add(this.buildGround());
    // ★ 方向标：地面箭头 + 文字，标清 `+Z = 左` / `−Z = 右`（见 AXIS_CONVENTION）
    this.axisG = this.buildAxisMarkers();
    this.axisG.visible = opt.showAxisMarkers ?? true;
    this.scene.add(this.axisG);

    // ★★ 一块板 = 一张贴图。躯干虽然被切成 K 段物理刚体，这里仍然只建 **一个 mesh**，
    //   靠逐顶点线性混合蒙皮把它绑到各段上（见文件头 + buildSkinGroup）。
    //   每条脊柱刚体各建一个 mesh 的话，每块都会画**一整张**躯干图 ⇒ 蜈蚣。
    const groups = groupPlates(sk);
    const loader = new THREE.TextureLoader();
    const maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const loadTex = (file: string): THREE.Texture => {
      const tex = loader.load(assetBase + file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = maxAniso;
      return tex;
    };

    for (const i of groups.plain) {
      const b = sk.bodies[i];
      // ★★ `plateHidden` 的刚体**不建板**。
      //   脚掌刚体（`foot_l/foot_r`，仅 `ankleEnabled` 时存在）借的是**小腿那张贴图**
      //   （`part` 相同，物理上脚掌 collider 在踝以下），画出来就是**第二只脚**
      //   （用户 2026-10-04：「有了踝关节现在纹理变成两个脚了」）。
      //   脚掌的正确画法需要**把小腿贴图横向裁一刀**，目前没做 ⇒ 先不画。
      //   ⚠ 这个标志此前**只声明、只赋值，从没被读过** ⇒ 是一枚死标志
      //     （与 `Ragdoll` 的 `jointGain` 同类）。
      if (b.plateHidden) continue;
      // ★★ `plateUv`：这块板只画贴图的**一个子区域**（脚掌 = 从小腿贴图里裁出靴子）。
      //   不裁的话只有两个坏结果：脚随踝转动时**消失**，或者**画出两只脚**
      //   （因为脚掌刚体借的是小腿那张贴图）。
      //   实现：贴图 set + UV 变换（THREE 的 uv 原点在左下，与素材坐标相反 ⇒ y 已翻转）。
      const uv = b.plateUv;
      let tex = loadTex(b.part.file);
      if (uv) {
        tex = tex.clone();
        tex.needsUpdate = true;
        tex.repeat.set(uv.width, uv.height);
        tex.offset.set(uv.x, uv.y);
      }
      // 裁剪后板子的**世界高度**按子区域比例缩，否则脚会被拉伸成整条小腿那么高
      const w = b.part.bw * sk.px2m;
      const h = b.part.bh * sk.px2m * (uv ? uv.height : 1);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false,
        // ★ DoubleSide：相机绕到背面时板子不能凭空消失
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      this.plates.push({
        mesh, drivers: [i], skin: null, sortPos: new THREE.Vector3(),
        // ★ 视觉补偿只含**倾角**（= 素材画法）；偏航是主动纠正的站姿，贴图必须跟着转，
        //   否则脚掌 collider 已经内收、看到的靴子还是外八（用户："外八，脚尖向外啊"）。
        qRestInv: (() => {
          const [x, y, z, w] = invQuatOf(restVisualQuatOf(b.restTiltRad));
          return new THREE.Quaternion(x, y, z, w);
        })(),
        // ★ 脚掌板绕**竖直轴（Y）**转 90°（用户 2026-10-04：「纹理是沿着竖直的轴转90度」）。
        //   ⇒ 板面法线从 `+X`（正前）转到 `+Z`（左侧），靴子以**侧面**呈现，
        //   和 collider 长边落到前后向（`skeleton.ts` 的 `hx`/`hz`）配套。
        //   只作用于 `foot_l/foot_r`，其余板子（含手臂）一律单位四元数。
        qYaw90: (b.key === 'foot_l' || b.key === 'foot_r')
          ? new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              // 两只脚同时再转 180°（用户 2026-10-04：「现在是两个脚都反了，给两个脚同时转180」）
              (b.key === "foot_l" ? 1 : -1) * Math.PI / 2,
            )
          : new THREE.Quaternion(),
      });
      this.scene.add(mesh);
    }

    if (groups.skinned.length > 0) {
      const tex = loadTex(sk.bodies[groups.skinned[0]].part.file);
      const g = this.buildSkinGroup(sk, groups.skinned, tex);
      this.plates.push({
        mesh: g.mesh, drivers: g.b.segBody, skin: g, sortPos: g.sortPos,
        qYaw90: new THREE.Quaternion(),
        // 躯干不设静倾角（脊柱 LBS 蒙皮要求各段同朝向）
        qRestInv: new THREE.Quaternion(),
      });
      this.scene.add(g.mesh);
    }

    // ★ 自检：组件数 = 板数。躯干折叠成一块后仍然成立（否则说明某块板和别的合并/漏掉了）
    if (this.plates.length !== META.parts.length) {
      console.warn(`[viewer] 护甲板数 ${this.plates.length} ≠ 素材组件数 ${META.parts.length}`);
    }

    this.depths = new Float64Array(this.plates.length);
    this.order = this.plates.map((_, i) => i);

    // ---- 骨架线框（胶囊 + 脚掌扁盒）----
    // 只有贴图的话看不出"物理体到底长什么样"——贴图是美术包围盒，物理胶囊比它瘦 40%
    // （limbRadiusScale 0.6）。这一层是排查穿模/贴图错位的关键视图。
    const boneMat = new THREE.MeshBasicMaterial({
      color: 0xb4331f, wireframe: true, transparent: true, opacity: 0.55,
      depthTest: false, depthWrite: false,
    });
    for (const b of sk.bodies) {
      const g = new THREE.Group();
      const cap = new THREE.Mesh(
        new THREE.CapsuleGeometry(b.radius, Math.max(1e-3, b.halfHeight * 2), 3, 10),
        boneMat,
      );
      cap.renderOrder = 85;
      g.add(cap);
      for (const c of b.colliders) {
        if (c.shape !== 'cuboid') continue;
        const box = new THREE.Mesh(new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.hz * 2), boneMat);
        box.position.set(0, c.offsetY, c.offsetZ);
        box.renderOrder = 85;
        g.add(box);
      }
      g.visible = false;
      this.boneGroups.push(g);
      this.scene.add(g);
    }

    // ---- 整代骨架线 ----
    this.ghostPos = new Float32Array(population * this.ghostSegPer * 2 * 3);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(this.ghostPos, 3));
    this.ghost = new THREE.LineSegments(
      gGeo,
      new THREE.LineBasicMaterial({
        color: 0xb4331f, transparent: true, opacity: 0.28,
        depthTest: false, depthWrite: false,
      }),
    );
    this.ghost.renderOrder = 5;
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // ---- 关节锚点 ----
    this.jointPos = new Float32Array(sk.joints.length * 3);
    const jGeo = new THREE.BufferGeometry();
    jGeo.setAttribute('position', new THREE.BufferAttribute(this.jointPos, 3));
    this.jointDots = new THREE.Points(
      jGeo,
      new THREE.PointsMaterial({
        color: 0x1c1f24, size: 10, sizeAttenuation: false,
        depthTest: false, depthWrite: false,
      }),
    );
    this.jointDots.renderOrder = 90;
    this.jointDots.frustumCulled = false;
    this.jointDots.visible = false;
    this.scene.add(this.jointDots);

    this.resize();

    // ★ 双保险：光靠 window.resize 不够 —— 首帧时容器可能还没布局完成（clientWidth=0），
    //   而且容器尺寸变化也未必伴随窗口 resize。用 ResizeObserver 盯住 canvas 本身。
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    requestAnimationFrame(() => this.resize());
  }

  /**
   * 建躯干蒙皮板：一张贴图、一整块连续网格、按脊柱段做逐顶点线性混合蒙皮。
   *
   * ★ 几何拓扑直接用 PlaneGeometry(w, H, 1, K·SUB)（UV 已连续覆盖 0~1 整图），
   *   只把它的 position 缓冲换成我们自己的 —— 顶点数与顺序不变，所以 index / uv 全部复用。
   *   PlaneGeometry 的顶点顺序：iy = 0 是最上面一行（本地 y = +H/2），ix = 0 是左边，
   *   与 buildSkinBinding 里的顶点编号完全一致。
   *
   * 绑定/蒙皮的数学全在模块级纯函数里（buildSkinBinding / skinPositions），
   * 这里只负责把结果接到 THREE 的 mesh 上。
   */
  private buildSkinGroup(sk: Skeleton, segIdx: number[], tex: THREE.Texture): SkinGroup {
    const b = buildSkinBinding(sk, segIdx, Viewer.SKIN_SUB);
    const geo = new THREE.PlaneGeometry(b.w, b.H, 1, b.rows);
    if (geo.getAttribute('position').count !== b.vCount) {
      throw new Error(`[viewer] 蒙皮顶点数对不上：geo ${geo.getAttribute('position').count} ≠ binding ${b.vCount}`);
    }
    const pos = new Float32Array(b.vCount * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // ★ 顶点每帧写世界坐标 ⇒ 包围球失效，必须关掉视锥剔除，否则整体从画面里消失
    mesh.frustumCulled = false;

    return {
      mesh, b, pos,
      segT: new Float64Array(b.segBody.length * 3),
      segR: new Float64Array(b.segBody.length * 9),
      sortPos: new THREE.Vector3(),
    };
  }

  /** 逐顶点线性混合蒙皮：读各段刚体位姿 → 写顶点世界坐标 */
  private syncSkin(g: SkinGroup, doll: Ragdoll): void {
    const K = g.b.segBody.length;
    const segT = g.segT;
    const segR = g.segR;

    // 先把 K 段的位姿解出来 —— wasm 绑定 + 四元数展开只在 K 次，不放进顶点循环
    for (let s = 0; s < K; s++) {
      const body = doll.bodies[g.b.segBody[s]];
      const t = body.translation();
      const q = body.rotation();
      const tp = s * 3;
      const rp = s * 9;
      segT[tp] = t.x; segT[tp + 1] = t.y; segT[tp + 2] = t.z;
      // 四元数 → 行主序 3×3，作用等价于 R·v（与 three 的 makeRotationFromQuaternion 同口径）
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      segR[rp] = 1 - (yy + zz); segR[rp + 1] = xy - wz;       segR[rp + 2] = xz + wy;
      segR[rp + 3] = xy + wz;   segR[rp + 4] = 1 - (xx + zz); segR[rp + 5] = yz - wx;
      segR[rp + 6] = xz - wy;   segR[rp + 7] = yz + wx;       segR[rp + 8] = 1 - (xx + yy);
    }

    skinPositions(g.b, segT, segR, g.pos);
    (g.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 三维地面网格：沿 X 的行走刻度 + 沿 Z 的侧向刻度 */
  /** 方向标图层（可整体开关） */
  private readonly axisG: THREE.Group;

  /**
   * ★ 3D 方向标：地面上的箭头 + 文字标签。
   *   为什么必须有：本 rig 的左右在 **Z** 轴上而不是 X，且 `+Z = 左`，
   *   与 Three.js 相机默认相反 —— 不标出来看反是必然的（用户要求）。
   *   判据：文字用 CanvasTexture 画（不依赖字体文件），箭头用扁平三角，
   *   贴地放置（y 略高于 0 免得和网格 z-fighting），`renderOrder` 排在网格之前。
   */
  private buildAxisMarkers(): THREE.Group {
    const g = new THREE.Group();
    const mkText = (txt: string, sub: string, color: string) => {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      const g2 = cv.getContext('2d')!;
      g2.clearRect(0, 0, 256, 128);
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillStyle = color;
      g2.font = 'bold 64px system-ui, "Segoe UI", sans-serif';
      g2.fillText(txt, 128, 44);
      g2.font = '30px system-ui, "Segoe UI", sans-serif';
      g2.fillStyle = 'rgba(255,255,255,0.72)';
      g2.fillText(sub, 128, 96);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false,
      }));
      sp.scale.set(0.62, 0.31, 1);
      sp.renderOrder = 999;
      return sp;
    };
    // 一个箭头：起点 (x, z0)，指向 (x, z1)
    const mkArrow = (x: number, z0: number, z1: number, color: number) => {
      const s = Math.sign(z1 - z0);
      const shaftEnd = z1 - s * 0.22;
      const halfW = 0.07;
      const pts = [
        x, 0, z0,
        x, 0, shaftEnd,
        // 三角头
        x, 0, z1,
        x - halfW, 0, shaftEnd,
        x, 0, z1,
        x + halfW, 0, shaftEnd,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false,
      }));
      m.renderOrder = 998;
      m.frustumCulled = false;
      return m;
    };

    const LEFT = 0x3b82f6;    // 蓝
    const RIGHT = 0xf97316;   // 橙
    const Z = 1.6;            // 放在人两侧（人站距只有 ±0.16 m）
    const X0 = -0.35;         // 略微在身后，避免挡住腿

    // 左：+Z
    g.add(mkArrow(X0, 0.45, Z, LEFT));
    const tl = mkText('左 L', '+Z', '#93c5fd');
    tl.position.set(X0, 0.46, Z + 0.42);
    g.add(tl);
    // 右：−Z
    g.add(mkArrow(X0, -0.45, -Z, RIGHT));
    const tr = mkText('右 R', '−Z', '#fdba74');
    tr.position.set(X0, 0.46, -Z - 0.42);
    g.add(tr);
    // 前：+X。`mkArrow` 是沿 z 画的，这里单独给一个沿 +x 的（顺便标上，
    // 因为 x 是矢状轴、也容易被和左右搞混）。
    {
      const halfW = 0.07, x0 = 0.45, x1 = 1.6, shaft = x1 - 0.22;
      const pts = [
        x0, 0, 0, x1, 0, 0,
        x1, 0, 0, shaft, 0, -halfW,
        x1, 0, 0, shaft, 0, halfW,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x22c55e, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false,
      }));
      m.renderOrder = 998; m.frustumCulled = false;
      g.add(m);
    }
    const tf = mkText('前', '+X', '#86efac');
    tf.position.set(2.05, 0.46, 0);
    g.add(tf);
    return g;
  }

  /** 切换 3D 方向标（UI 按钮用） */
  setAxisMarkers(on: boolean): void { this.axisG.visible = on; }

  private buildGround(): THREE.Object3D {
    const g = new THREE.Group();
    const main: number[] = [];   // 主网格
    const old: number[] = [];    // 每米细分

    const X0 = -8, X1 = 24, Z0 = -6, Z1 = 6;

    // 沿 X 方向的线（在常量 z 上），+ z=0 是中线
    for (let z = Z0; z <= Z1; z += 1) {
      const arr = z === 0 ? main : old;
      arr.push(X0, 0, z, X1, 0, z);
    }
    // 沿 Z 方向的线（在常量 x 上，每 1m；5 的倍数是主线）
    for (let x = X0; x <= X1; x += 1) {
      const arr = x % 5 === 0 ? main : old;
      arr.push(x, 0, Z0, x, 0, Z1);
    }
    // 每米短刻度（沿 +Z 的小刺，帮助判断"走了多远"）
    for (let x = Math.ceil(X0); x <= X1; x += 1) {
      old.push(x, 0, 0, x, 0, x % 5 === 0 ? 0.6 : 0.28);
    }

    const mk = (pts: number[], color: number, opacity: number, order: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const ls = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false }),
      );
      ls.renderOrder = order;
      ls.frustumCulled = false;
      g.add(ls);
    };
    mk(old, 0xd2d8de, 0.9, -21);
    mk(main, 0xb9c2cc, 1.0, -20);
    return g;
  }

  resize(): void {
    // ★ 不要只信 clientWidth：canvas 若被 CSS 退化成固有尺寸（300×150）或 display:none，
    //   clientWidth 会是 0 或 300，画面就成了左上角一小块。逐级回退兜住。
    //   （症状：网页只有 UI 面板、看不到骨骼 —— 见 index.html 里 #view 的注释）
    const w = this.canvas.clientWidth || window.innerWidth || 1;
    const h = this.canvas.clientHeight || window.innerHeight || 1;
    if (w < 2 || h < 2) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 第三个参数 false = 不写 CSS style，尺寸交给 CSS（否则 Three 会把 canvas 钉成固定像素）
    this.renderer.setSize(w, h, false);
  }

  // ------------------------------------------------------------ 相机操作

  /** 拖拽转视角（弧度增量） */
  orbit(dAz: number, dEl: number): void {
    this.camAz += dAz;
    this.camEl = Math.max(-0.25, Math.min(1.25, this.camEl + dEl));
  }

  /** 滚轮缩放 */
  zoom(factor: number): void {
    this.camDist = Math.max(1.6, Math.min(16, this.camDist * factor));
  }

  resetView(): void {
    this.camAz = DEFAULT_AZ;
    this.camEl = DEFAULT_EL;
    this.camDist = DEFAULT_DIST;
  }

  /**
   * 相机解算：球坐标 + 目标点平滑跟随。
   * az=0 ⇒ 相机在角色**正前方**（+X 侧）；az≈41° 是默认的 3/4 视角 ——
   * 这是"正面视图素材"与"行走步态"之间唯一能兼顾的角度：
   * 纯正面看不到迈腿（腿是朝/离镜头摆），纯侧面护甲板只剩一条线。
   */
  private updateCamera(doll: Ragdoll, dt: number): void {
    const t = doll.torso().translation();
    const k = 1 - Math.exp(-dt / Math.max(1e-3, this.followTau));
    const wantX = this.followShowcase ? t.x : 0;
    const wantZ = this.followShowcase ? t.z : 0;
    this.target.x += (wantX - this.target.x) * k;
    this.target.z += (wantZ - this.target.z) * k;
    this.target.y += (t.y * 0.9 + 0.25 - this.target.y) * k;

    const ce = Math.cos(this.camEl);
    this.camDir.set(
      ce * Math.cos(this.camAz),
      Math.sin(this.camEl),
      ce * Math.sin(this.camAz),
    );
    this.camera.position.copy(this.target).addScaledVector(this.camDir, this.camDist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** 把展示个体（doll）的姿态刷到护甲板上；dt 用于相机跟随的帧率无关平滑 */
  syncShowcase(doll: Ragdoll, dt = 1 / 60): void {
    this.updateCamera(doll, dt);

    for (const slot of this.plates) {
      slot.mesh.visible = this.showTextures;
      if (slot.skin) {
        this.syncSkin(slot.skin, doll);
        // 排序代表点取中间那段（整块板的深度差异远小于它与别的板的差异）
        const mid = doll.bodies[slot.drivers[(slot.drivers.length - 1) >> 1]].translation();
        slot.sortPos.set(mid.x, mid.y, mid.z);
        continue;
      }
      const body = doll.bodies[slot.drivers[0]];
      const t = body.translation();
      const q = body.rotation();
      // ★★★ 贴图位姿 = 位置跟**刚体完整朝向**，朝向只跟**相对静姿态的增量**
      //   （用户定调："纹理别动，调整关节的倾斜度"）
      //   · 位置：offset 存的是"静姿态下把板心摆到素材位置"的局部偏移（骨架里已按 restTilt⁻¹ 折算），
      //     所以必须用**完整**的 qBody 变换它 ⇒ 静姿态下板心精确落在素材位置，一个像素不差。
      //   · 朝向：用 qRel = qBody ⊗ restTilt⁻¹ ⇒ 静姿态下 qRel = 单位四元数，板子不转（纹理没被动过）；
      //     动力学一转，qRel 就是纯增量，板子正常跟随。
      //   ★ 位置与朝向用**不同**的旋转不是笔误：骨骼的静倾角要"吃掉"（纹理保持画法），
      //     但刚体本身是倾斜的，板心的偏移向量必须跟着刚体一起转。
      this.qBody.set(q.x, q.y, q.z, q.w);
      this.qRel.copy(this.qBody).multiply(slot.qRestInv);
      const bd = doll.sk.bodies[slot.drivers[0]];
      const off = bd.plateOffset;
      // ★★★ 裁剪板的板心必须按**几何**重新定位，否则会跑到裁剪区之外。
      //
      //   mesh 建成 `uv.height × 原板高`，它显示贴图里 UV ∈ [uv.y, uv.y+uv.height]
      //   那一带。该带中心相对**原贴图中心**（UV 0.5）的世界 y 位移：
      //
      //       shift = 原板高 × (uv.y + uv.height/2 − 0.5)      正 = 上
      //
      //   代入本项目的两块：
      //     · 小腿 uv.y=0.124 h=0.876 ⇒ **+0.062** × 原板高（上移，下沿落到踝线）
      //     · 脚掌 uv.y=0     h=0.124 ⇒ **−0.438** × 原板高（下移到踝下方的靴子）
      //
      //   ⚠⚠ 我第一版写成 `−原板高 × uv.height / 2`：方向反了（把"下移"套到了
      //     **上半块**的小腿上）、量级也差约 7 倍 ⇒ **小腿纹理往下伸到地面**
      //     （用户 2026-10-04 两次亲见）。教训：没验证过的公式不能交。
      const shift = bd.plateUv
        ? bd.part.bh * doll.sk.px2m * (bd.plateUv.y + bd.plateUv.height / 2 - 0.5)
        : 0;
      this.tmpV.set(off[0], off[1] + shift, off[2]).applyQuaternion(this.qBody);
      slot.mesh.position.set(t.x + this.tmpV.x, t.y + this.tmpV.y, t.z + this.tmpV.z);
      // ★ 板子的世界朝向 = 增量朝向 ⊗ 板子固定朝向（先 qFix 后 qRel）
      slot.mesh.quaternion.copy(this.qRel).multiply(this.qFix).multiply(slot.qYaw90);
      slot.sortPos.set(t.x, t.y, t.z);
    }

    // ---- 深度排序（远 → 近）----
    // 相机前方向：从相机指向目标
    this.sortDir.copy(this.target).sub(this.camera.position).normalize();
    for (let i = 0; i < this.plates.length; i++) {
      this.tmpV.copy(this.plates[i].sortPos).sub(this.camera.position);
      this.depths[i] = this.tmpV.dot(this.sortDir);
    }
    const artZ = doll.sk.bodies;
    this.order.sort((a, b) => {
      const d = this.depths[b] - this.depths[a];
      if (Math.abs(d) > 1e-4) return d;
      return artZ[this.plates[a].drivers[0]].part.z - artZ[this.plates[b].drivers[0]].part.z;
    });
    for (let rank = 0; rank < this.order.length; rank++) {
      this.plates[this.order[rank]].mesh.renderOrder = rank;
    }

    if (this.showJoints) {
      for (let i = 0; i < this.boneGroups.length; i++) {
        const g = this.boneGroups[i];
        const body = doll.bodies[i];
        const t = body.translation();
        const q = body.rotation();
        g.position.set(t.x, t.y, t.z);
        g.quaternion.set(q.x, q.y, q.z, q.w);
        g.visible = true;
      }
      const geo = this.jointDots.geometry;
      for (let i = 0; i < doll.jointCount; i++) {
        const pi = doll.jointBodies[i * 2];
        const parent = doll.bodies[pi];
        const spec = doll.sk.joints[i];
        const t = parent.translation();
        const q = parent.rotation();
        // 关节锚点 = 父刚体位置 + R·(本地锚点)
        const lx = spec.parentLocal[0], ly = spec.parentLocal[1], lz = spec.parentLocal[2];
        const tx = 2 * (q.y * lz - q.z * ly);
        const ty = 2 * (q.z * lx - q.x * lz);
        const tz = 2 * (q.x * ly - q.y * lx);
        this.jointPos[i * 3] = t.x + lx + q.w * tx + (q.y * tz - q.z * ty);
        this.jointPos[i * 3 + 1] = t.y + ly + q.w * ty + (q.z * tx - q.x * tz);
        this.jointPos[i * 3 + 2] = t.z + lz + q.w * tz + (q.x * ty - q.y * tx);
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    } else if (this.boneGroups.length && this.boneGroups[0].visible) {
      for (const g of this.boneGroups) g.visible = false;
    }
  }

  /** 把整代骨架刷到线框群里 */
  syncGhost(trainer: Trainer): void {
    this.ghost.visible = this.showGhost;
    if (!this.showGhost) return;

    const buf = this.ghostPos;
    let w = 0;
    const n = Math.min(trainer.sims.length, Math.floor(buf.length / (this.ghostSegPer * 6)));
    for (let s = 0; s < n; s++) {
      const doll = trainer.sims[s].doll;
      for (let i = 0; i < doll.jointCount; i++) {
        const p = doll.bodies[doll.jointBodies[i * 2]].translation();
        const c = doll.bodies[doll.jointBodies[i * 2 + 1]].translation();
        buf[w++] = p.x; buf[w++] = p.y; buf[w++] = p.z;
        buf[w++] = c.x; buf[w++] = c.y; buf[w++] = c.z;
      }
    }
    // 补零（多余的个体线段塌到原点，视觉上不可见）
    for (; w < buf.length; w++) buf[w] = 0;
    (this.ghost.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.ghost.geometry.setDrawRange(0, n * this.ghostSegPer * 2);
  }

  render(): void {
    this.jointDots.visible = this.showJoints;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro?.disconnect();
    for (const g of this.boneGroups) {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      const m = (g.children[0] as THREE.Mesh | undefined)?.material;
      if (m instanceof THREE.Material) m.dispose();
    }
    for (const p of this.plates) {
      const m = p.mesh.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
      p.mesh.geometry.dispose();
    }
    this.renderer.dispose();
  }
}

/**
 * ★ 不变量：视图里的**护甲板数**必须恒等于素材组件数 —— 与刚体数无关。
 *   躯干分段后刚体从 10 涨到 13，但板仍然是 10 块（躯干 K 段合成 1 块）。
 *   viewer 构造时会自检并 warn；离屏版在 tools/probe-skin.ts 的 [I] 段（含分组真源 groupPlates）。
 */
export const EXPECTED_PLATES = META.parts.length;
