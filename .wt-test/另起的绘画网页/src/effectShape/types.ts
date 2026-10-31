// ============================================================
// effectShape —— 程序化击中特效形状（独立模块，与主绘画逻辑解耦）
// ============================================================
// 概念：编辑器画"基础形状"（虚线绘制 → 区域注释算法取闭合区域），
//   运行时每次命中生成一个【随机变体】：
//   旋转（随机角度）+ NV 扭曲（沿法线扰动）→ 初始形态；
//   然后向外扩（x/y 独立随机倍率），外扩期间可选继续旋转。
//   可选外置透明残差纹理层（参与视觉 + 流体）。
//
// 本模块四件套：
//   ① types.ts             类型定义
//   ② variantGenerator.ts  共享纯函数：变体生成 + 逐帧外扩（编辑器/播放器/游戏共用）
//   ③ EffectShapePanel.tsx 主绘画页面新增 UI 块（矢量绘制 + 参数 + 预览）
//   （导出后续再加）

export interface EffectShapeFill {
  h: number; s: number; l: number; a: number;
}

export interface EffectShapeParams {
  /** NV 扭曲（沿轮廓法线正弦扰动；randomRange = 每次振幅随机幅度 0~1） */
  distortion: { amplitude: number; frequency: number; randomRange: number };
  /** 初始旋转（每次随机角度范围，弧度） */
  rotation: { min: number; max: number };
  /** 外扩（x/y 独立随机目标倍率 + 时长 + 缓动） */
  expand: { xMin: number; xMax: number; yMin: number; yMax: number; duration: number; easing: 'linear' | 'easeOut' };
  /** 外扩期间继续旋转（可选） */
  spinWhileExpand: boolean;
  spinSpeed: number; // 弧度/秒
}

export interface EffectShapeDef {
  id: number;
  name: string;
  /** 基础形状轮廓（区域注释算法得到的闭合区域，归一化坐标） */
  outline: { x: number; y: number }[];
  fill: EffectShapeFill;
  /** 可选：透明残差纹理层（参与视觉 + 流体） */
  residualTex?: ImageData;
  /** 图层可见性（预览叠加播放时按层开关） */
  visible?: boolean;
  params: EffectShapeParams;
}

export interface EffectShapeVariant {
  seed: number;
  /** 本次初始旋转角（弧度） */
  angle: number;
  /** 旋转 + NV 扭曲后的轮廓（与 outline 同归一化空间） */
  vertices: { x: number; y: number }[];
  /** 本次 x/y 外扩目标倍率（≥1，动画从 1 缓动到该值） */
  scaleX: number;
  scaleY: number;
  /** 外扩期间角速度（弧度/秒，未启用为 0） */
  spin: number;
}

export interface EffectShapePose {
  scaleX: number;
  scaleY: number;
  angle: number;
}
