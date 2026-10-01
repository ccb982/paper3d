// ============================================================
// partsMeta —— 素材元数据（由 tools/build-parts.py 生成，勿手改）
// ============================================================
// 坐标口径：所有 cx/cy/bw/bh 与 joints 的 x/y 都是【原画布像素】，
// 画布 1568×2944，y 向下，原点左上。换算到世界坐标见 skeleton.ts。

import raw from '../data/parts.json';
import limbAxesRaw from '../data/limbAxes.json';

export interface PartMeta {
  /** 刚体 id，也是贴图文件名 */
  key: string;
  label: string;
  /** 对应骨架环节名 */
  bone: string;
  /** 绘制层级（大的盖在上面） */
  z: number;
  /** 相对 public/ 的贴图路径 */
  file: string;
  /** 贴图像素尺寸（已按全局 scale 降采样） */
  w: number;
  h: number;
  bytes: number;
  /** 内容包围盒中心（画布 px） */
  cx: number;
  cy: number;
  /** 内容包围盒尺寸（画布 px） */
  bw: number;
  bh: number;
}

export interface JointMeta {
  name: string;
  /** 父刚体 key */
  parent: string;
  /** 子刚体 key */
  child: string;
  x: number;
  y: number;
  limitDeg: [number, number];
}

export interface PartsMeta {
  generator: string;
  source: string;
  canvas: { w: number; h: number };
  scale: number;
  /** 全部组件并集的包围盒（画布 px） */
  extent: { x0: number; y0: number; x1: number; y1: number; w: number; h: number };
  parts: PartMeta[];
  joints: JointMeta[];
  /** 脚掌碰撞体（与小腿同刚体，一体化） */
  sole: { len: number; thick: number; massPercent: number };
  bytesTotal: number;
}

/**
 * ★ 踝关节元数据（2026-10-01 新增）。
 *   `parts.json` 是旧 `build-parts.py` 的产物，里面没有踝；新测量管线
 *   （`limbAxes.json`）才量得出靴子顶端。这里在代码层补上，锚点由
 *   `limbAxes.anchors.foot_*` 提供（skeleton 的 `anchorPx` 优先取实测值）。
 *   `limitDeg` = [低头(plantarflex), 勾脚(dorsiflex)]，由 SkeletonConfig.anklePitchDeg 覆盖。
 */
const ANKLE_JOINTS: JointMeta[] = [
  { name: 'foot_l', parent: 'shin_l', child: 'foot_l', x: 454.5, y: 2792, limitDeg: [-10, 18] },
  { name: 'foot_r', parent: 'shin_r', child: 'foot_r', x: 1110.5, y: 2792, limitDeg: [-10, 18] },
];

const meta = raw as unknown as PartsMeta;
if (!meta.joints.some((j) => j.name === 'foot_l')) meta.joints.push(...ANKLE_JOINTS);

export const META: PartsMeta = meta;

/** key → 组件元数据 */
export const PART_BY_KEY: ReadonlyMap<string, PartMeta> = new Map(
  META.parts.map((p) => [p.key, p]),
);

/**
 * ★★ 肢体中轴与关节锚点（`tools/measure-limb-axes.py` 从 alpha 掩膜实测生成）。
 *
 * 为什么需要它 —— 用户回读 2026-10-01：
 *   "我的纹理初始状态，各个部位都是有一定倾斜度的"
 *   "最起码各个肢体的关节必须连起来"
 * 实测倾角：上臂 7.3°/2.8°、前臂+手 30.6°/32.2°、大腿 8°、小腿 9.2°/7.7°、
 *          躯干 0.8°、头 0.6°。⇒
 *   ① `parts.json` 那个"父/子 bbox 重叠区中心"当锚点的启发式对**斜肢体**不成立：
 *      肩锚点会落进上臂中点（比肩峰低 0.19 m ⇒ 显矮 + 手臂上部无锚点"悬空"）。
 *   ② 刚体不能继续按"竖直胶囊"摆：贴图是斜的，竖直刚体会把斜肢体画歪，
 *      链也接不上 ⇒ 每个肢体刚体带**静倾角** restTiltRad，贴图另有局部偏移 plateOffset。
 *
 * 字段：
 *   axes[key]  = { k, b, tiltDeg, proxTip, distTip, lenPx }  —— 中轴 x = k·y + b（画布 px）
 *   anchors[joint] = [x, y]  —— 关节锚点（画布 px），**保证落在父/子两张贴图 alpha 内部**
 *   margin[joint]  = 到两侧轮廓的内缩余量（px）⇒ verify-core 钉住 ≥ 0
 */
export interface LimbAxis {
  /** 中轴斜率 dx/dy（画布 px；y 向下） */
  k: number;
  b: number;
  /** 中轴直线拟合残差 rms（px） */
  rms: number;
  /** 相对竖直的倾角（度，符号同 k） */
  tiltDeg: number;
  /** 近端端心（画布 px）：上/下肢都是上端 */
  proxTip: [number, number];
  /** 远端端心（画布 px） */
  distTip: [number, number];
  /** 沿中轴的长度（画布 px） */
  lenPx: number;
}

export interface PawMeta {
  /** 靴筒/脚背交界（alpha 最宽行）的画布 y */
  yWide: number;
  /** alpha 最低点（画布 y）= 靴底 */
  yLow: number;
  /** 靴心的画布 x（相对小腿中轴是偏的） */
  centerX: number;
  /** 靴子侧向半宽（画布 px） */
  lateralHalf: number;
  /** 爪区高度（画布 px） */
  pawHeightPx: number;
  /** 靴底边斜率（度，只报告：不据此给碰撞体加横滚） */
  slopeDeg: number;
}

export interface LimbAxes {
  source: string;
  scale: number;
  axes: Record<string, LimbAxis>;
  anchors: Record<string, [number, number]>;
  margin: Record<string, number>;
  /** 爪区（靴子）实测：'l' = shin_l，'r' = shin_r */
  paw: { l: PawMeta; r: PawMeta };
}

export const LIMB_AXES = limbAxesRaw as unknown as LimbAxes;
