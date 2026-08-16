// ============================================================
// variantGenerator —— 程序化击中特效形状的变体生成器（共享纯函数）
// ============================================================
// 编辑器预览 / 特效播放器 / 游戏运行时三端共用同一份生成逻辑：
//   ① shapeSeed(globalSeed, shapeId) —— 每形状独立随机种子（级联派生）
//   ② generateVariant(def, seed)     —— 旋转 + NV 扭曲 → 变体轮廓（CPU 一次性）
//   ③ tickVariant(variant, time, params) —— 逐帧外扩姿态（x/y 独立 + 可选旋转）
// 纯函数、无 DOM/GL 依赖，可单测。

import type { EffectShapeDef, EffectShapePose, EffectShapeVariant } from './types';

// ============ 确定性随机（种子 → 随机序列） ============

/** mulberry32：种子化 PRNG（同种子 → 同序列，可复现） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机全局种子（每次击中重新取） */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** ★ 每形状独立种子：全局种子 + 形状 id 级联（尖刺错位更丰富） */
export function shapeSeed(globalSeed: number, shapeId: number): number {
  let h = (globalSeed ^ Math.imul(shapeId + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ============ 几何工具 ============

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  const n = pts.length || 1;
  return { x: cx / n, y: cy / n };
}

/** 沿质心径向正弦扰动 —— NV 扭曲（★ 拓扑安全版）：
 *   沿【质心→顶点】方向位移（而非邻边法线）：尖刺/星形轮廓不产生
 *   自相交/三角形碎片，拓扑关系不变；位移钳制在径向距离一半以内 */
function radialDistort(
  pts: { x: number; y: number }[],
  centroid: { x: number; y: number },
  amplitude: number,
  frequency: number,
  phase: number,
): { x: number; y: number }[] {
  return pts.map(p => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9) return { ...p };
    const theta = Math.atan2(dy, dx);
    let offset = amplitude * Math.sin(frequency * theta + phase);
    // ★ 拓扑安全：位移不超过径向距离的一半（防止顶点越过质心/互相穿越）
    const maxOff = r * 0.5;
    offset = Math.max(-maxOff, Math.min(maxOff, offset));
    const s = (r + offset) / r;
    return { x: centroid.x + dx * s, y: centroid.y + dy * s };
  });
}

// ============ 变体生成 ============

/** 随机种子 → 变体（旋转 + NV 扭曲 → 初始形态；x/y 外扩目标 + 可选旋转） */
export function generateVariant(def: EffectShapeDef, seed: number): EffectShapeVariant {
  const outline = def.outline;
  if (outline.length < 3) {
    return { seed, angle: 0, vertices: outline.slice(), scaleX: 1, scaleY: 1, spin: 0 };
  }
  const rand = mulberry32(seed);
  const p = def.params;

  // ① 初始旋转角（范围内随机）
  const angle = p.rotation.min + rand() * (p.rotation.max - p.rotation.min);

  // ② 旋转（绕质心）
  const c = centroid(outline);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  let vertices = outline.map(v => {
    const dx = v.x - c.x, dy = v.y - c.y;
    return { x: c.x + dx * cosA - dy * sinA, y: c.y + dx * sinA + dy * cosA };
  });

  // ③ NV 扭曲（振幅在 randomRange 内随机；径向位移，拓扑安全）
  const amp = p.distortion.amplitude * (1 - p.distortion.randomRange + rand() * 2 * p.distortion.randomRange);
  const phase = rand() * Math.PI * 2;
  vertices = radialDistort(vertices, c, Math.max(0, amp), Math.max(0.1, p.distortion.frequency), phase);

  // ④ x/y 外扩目标（独立随机）
  const scaleX = p.expand.xMin + rand() * (p.expand.xMax - p.expand.xMin);
  const scaleY = p.expand.yMin + rand() * (p.expand.yMax - p.expand.yMin);

  // ⑤ 外扩期间继续旋转（可选，方向随机）
  const spin = p.spinWhileExpand ? (rand() * 2 - 1) * Math.max(0, p.spinSpeed) : 0;

  return { seed, angle, vertices, scaleX: Math.max(0.01, scaleX), scaleY: Math.max(0.01, scaleY), spin };
}

/** 逐帧外扩姿态：scale 从 1 缓动到目标；可选继续旋转 */
export function tickVariant(variant: EffectShapeVariant, time: number, def: EffectShapeDef): EffectShapePose {
  const d = def.params.expand.duration;
  const t = d > 0 ? Math.max(0, Math.min(1, time / d)) : 1;
  const e = def.params.expand.easing === 'easeOut' ? 1 - Math.pow(1 - t, 3) : t;
  return {
    scaleX: 1 + (variant.scaleX - 1) * e,
    scaleY: 1 + (variant.scaleY - 1) * e,
    angle: variant.angle + variant.spin * time,
  };
}

/** 总时长（变体+外扩完一轮） */
export function variantDuration(def: EffectShapeDef): number {
  return Math.max(0.05, def.params.expand.duration);
}
