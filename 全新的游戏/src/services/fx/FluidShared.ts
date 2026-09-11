// ============================================================
// FluidShared —— 共享流体的"每帧只步进一次"去重器
// ============================================================
// 场景：同一份 FluidEffect 可能被多个消费者引用（世界里的祖宗实体 + 背包/加工台图标
//   动画器）。若各自 step，就会 N 倍求解 + N 倍合成（曾导致 21ms/帧的卡顿）。
// 约定：所有消费者都调用 stepFluidShared(effect, dt)；同帧内第二次调用直接跳过。
//   （10ms 去重窗：同一 rAF 批次内的双调用必被合并，跨帧正常步进）
// ============================================================

import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';

/** effect → 上次步进时刻（WeakMap：随流体实例回收，不泄漏） */
const lastStep = new WeakMap<FluidEffect, number>();

export function stepFluidShared(effect: FluidEffect, dt: number): void {
  if (dt <= 0) return;
  const now = performance.now();
  const last = lastStep.get(effect);
  if (last !== undefined && now - last < 10) return;
  lastStep.set(effect, now);
  effect.step(dt);
}
