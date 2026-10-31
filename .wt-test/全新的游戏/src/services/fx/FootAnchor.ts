// ============================================================
// FootAnchor —— 贴片接地补偿（量出纹理底部的透明余量）
// ============================================================
// ★ 问题（2026-09-18）：FTX 包声明的 bbox 不总是紧贴脚底 —— 导出时底部常留
//   几像素到几十像素空白（留白/受击抖动空间）。而贴片采用"底部锚点"：
//   quad 底边 = 地面 → 那些空白行就变成了"角色悬空"。
//
// ★ 为什么用测量而不是手填：余量是**素材自带的数据**，不能靠肉眼逐个人调。
//   帧纹理的 alpha 通道就是答案（FTX: regionId 为 0 的像素 alpha=0，
//   见 vendor/player/core/ftx.ts `buildBaseHslData`）→ 从最后一行往上扫，
//   第一个有不透明像素的行就是"脚底"。
//
// 口径：返回的是「底透明像素 / 纹理宽」的**比例**（不是像素也不是世界单位）。
//   quad 宽 = scale（世界单位）对应纹理宽 bbox.w 像素
//   → 世界下沉量 = 比例 × scale
//   ★ 之所以用"相对宽度"而非"相对高度"：quad 的实际高度 = scale × (bbox.h/bbox.w)
//     是按宽高比撑出来的，用宽度归一化才能与 quad 尺寸正交、两种渲染路径共用。
//
// 两条渲染路径都必须补偿（否则远看接地、近看悬空）：
//   ① L3 实体：FTXQuad.setGroundSink（覆写底部锚点抬升量）
//   ② L2 代理：SwarmBatch.sync 的实例矩阵 y
// ============================================================

import type { FrameAssetSource } from './AssetSource';

/** 帧纹理的像素数据（FTX = Float32 HSL+alpha；其余包可能是 Uint8 RGBA） */
interface ImageLike {
  data?: Float32Array | Uint8Array;
  width?: number;
  height?: number;
}

/**
 * 量出第 frameIndex 帧「内容底边 → 纹理底边」的空白，返回其**相对纹理宽的比例**。
 * 无法判定（无数据 / 无 alpha 通道 / 整帧透明）→ 返回 0（= 不做补偿，行为与改动前一致）。
 */
export function footSinkRatioOf(source: FrameAssetSource, frameIndex = 0): number {
  const img = source.getFramePair(frameIndex)?.base?.image as unknown as ImageLike | undefined;
  const data = img?.data;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!data || w <= 0 || h <= 0) return 0;
  // alpha 通道步长：4 分量（RGBA 约定）。长度不足 4×w×h 的按无 alpha 处理
  if (data.length < w * h * 4) return 0;
  const isFloat = data instanceof Float32Array;
  const opaque = isFloat ? 0.5 : 128;

  // 从最后一行往上找第一个"有不透明像素"的行
  let lastOpaque = -1;
  for (let y = h - 1; y >= 0 && lastOpaque < 0; y--) {
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowBase + x * 4 + 3] >= opaque) { lastOpaque = y; break; }
    }
  }
  // 整帧透明（无内容）→ 不补偿，避免把空帧推到离谱高度
  if (lastOpaque < 0) return 0;

  return (h - 1 - lastOpaque) / w;
}
