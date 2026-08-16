// ============================================================
// export —— 击中特效定义导出（自包含资产格式 v1）
// ============================================================
// 运行时（游戏/播放器）消费的完整效果定义：
//   - outline：模板边界（区域实体外环，归一化）——渲染时作为裁剪/变形基准
//   - fillMode：
//     · 'solid'：纯色填充（区域色块内部填充纯色）
//     · 'ftx'  ：区域色块图层内部为 FTX 帧纹理（嵌入 baseHsl + 量化残差，
//                运行时可复用 buildBaseHslData/buildResidualData 管线）
//   - residualLayer：形状外置透明残差纹理层（可选，参与视觉 + 流体）
//   - params：变体生成参数（NV 扭曲/旋转/外扩/旋转）
// 纯数据、无 DOM 依赖，编辑器导出与运行时加载共用同一结构。

import type { EffectShapeDef } from './types';

export interface HitEffectExport {
  version: 1;
  type: 'hit-effect';
  shapes: HitEffectShapeExport[];
}

export interface HitEffectShapeExport {
  name: string;
  /** 模板边界（归一化轮廓，Y 向上） */
  outline: { x: number; y: number }[];
  /** 填充模式：'solid' 纯色 / 'ftx' 帧纹理 */
  fillMode: 'solid' | 'ftx';
  solid?: { h: number; s: number; l: number; a: number };
  /** FTX 帧纹理（区域色块图层内部为帧纹理时嵌入） */
  ftx?: {
    width: number;
    height: number;
    /** Float32Array [H,S,L,A] base64 */
    baseHslBase64: string;
    /** Uint8Array 量化残差 [qH,qS,qL,qA] base64 */
    residualBase64: string;
  };
  /** 形状外置透明残差纹理层（可选） */
  residualLayer?: {
    width: number;
    height: number;
    dataBase64: string;
  };
  params: {
    distortion: { amplitude: number; frequency: number; randomRange: number };
    rotation: { min: number; max: number };
    expand: { xMin: number; xMax: number; yMin: number; yMax: number; duration: number; easing: 'linear' | 'easeOut' };
    spinWhileExpand: boolean;
    spinSpeed: number;
  };
}

/** Float32Array / Uint8Array → base64（编辑器端序列化） */
function arrayToBase64(arr: ArrayBufferView): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 帧数据 → FTX 嵌入（baseHsl + 量化残差） */
export interface FtxFrameSource {
  baseHsl: { data: Float32Array; width: number; height: number } | null;
  residual: ImageData | null; // 量化残差 [qH,qS,qL,qA]
}

/**
 * 序列化击中特效定义。
 * @param shapes       特效形状列表（面板配置，按图层）
 * @param layerNames   形状对应的图层名（用于导出命名）
 * @param ftxByShape   形状 → FTX 帧数据（fillMode='ftx' 时提供；按图层 id）
 * @param residualByShape 形状 → 外置残差纹理层（可选）
 */
export function serializeHitEffect(
  shapes: EffectShapeDef[],
  ftxByShape: (Record<string, FtxFrameSource> | null),
  residualByShape: Record<string, ImageData>,
): HitEffectExport {
  const out: HitEffectExport = { version: 1, type: 'hit-effect', shapes: [] };
  for (let i = 0; i < shapes.length; i++) {
    const def = shapes[i];
    const ftx = ftxByShape?.[def.name] ?? ftxByShape?.[String(def.id)] ?? null;
    const residualLayer = residualByShape[def.name] ?? residualByShape[String(def.id)];
    const shape: HitEffectShapeExport = {
      name: def.name,
      outline: def.outline.map(p => ({ x: p.x, y: p.y })),
      fillMode: ftx ? 'ftx' : 'solid',
      solid: { ...def.fill },
      params: JSON.parse(JSON.stringify(def.params)),
    };
    if (ftx && ftx.baseHsl && ftx.residual) {
      shape.ftx = {
        width: ftx.baseHsl.width,
        height: ftx.baseHsl.height,
        baseHslBase64: arrayToBase64(ftx.baseHsl.data),
        residualBase64: arrayToBase64(ftx.residual.data),
      };
    }
    if (residualLayer) {
      shape.residualLayer = {
        width: residualLayer.width,
        height: residualLayer.height,
        dataBase64: arrayToBase64(residualLayer.data),
      };
    }
    out.shapes.push(shape);
  }
  return out;
}
