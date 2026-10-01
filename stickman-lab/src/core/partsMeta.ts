// ============================================================
// partsMeta —— 素材元数据（由 tools/build-parts.py 生成，勿手改）
// ============================================================
// 坐标口径：所有 cx/cy/bw/bh 与 joints 的 x/y 都是【原画布像素】，
// 画布 1568×2944，y 向下，原点左上。换算到世界坐标见 skeleton.ts。

import raw from '../data/parts.json';

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

export const META = raw as unknown as PartsMeta;

/** key → 组件元数据 */
export const PART_BY_KEY: ReadonlyMap<string, PartMeta> = new Map(
  META.parts.map((p) => [p.key, p]),
);
