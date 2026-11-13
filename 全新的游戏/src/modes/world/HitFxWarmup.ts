// ============================================================
// HitFxWarmup —— 击中特效图集的"进战场预热 + 每天换一组"
// ============================================================
// 从 WorldMode.enter 抽出（该文件有 3800 行硬天花板）：
//   ① 预热：进战场时就把图集烘焙掉，而不是等"第一次命中"（那会卡一下）；
//   ② 换日：**出击天数**（session.meta.day，回基地时 +1）变了 → 换一批随机变体。
//
// ⚠️ 不能用 renderManager.clock.day —— 那是 900s 昼夜循环，
//    同一次出击会跨好几个"天"，会把图集换得比玩家预期频繁。
//
// ★ 状态放模块级：跨 WorldMode 实例持久（进程内只记一次天），
//   与 FxRuntime / RenderManager 同为单例语义。
// ============================================================

import type { FxRuntime } from '../../fx';
import type { HitEffectShapeExport } from '../../vendor/player/core/types';

/** 最近一次烘焙对应的出击天数（-1 = 尚未烘焙过） */
let bakedDay = -1;

/**
 * 确保击中特效图集对应"今天"。
 * @param fx 统一特效运行时（未就绪时静默跳过）
 * @param shapes 素材包里的形状定义（同一份数组引用 ⇒ configure 幂等）
 * @param today 当前**出击天数**（session.meta.day）
 */
export function ensureHitFxForDay(
  fx: FxRuntime | null | undefined,
  shapes: HitEffectShapeExport[],
  today: number,
): void {
  if (!fx) return;
  const hadChannel = fx.hasHitEffects;
  fx.configureHitEffects({ shapes }); // 幂等：同引用只建一次
  // 本次刚建的通道用的就是新种子 → 不必再重烘焙
  if (hadChannel && bakedDay >= 0 && today !== bakedDay) {
    fx.requestHitEffectRebake();
  }
  bakedDay = today;
}

/** 探针/测试用：重置记忆（跨局测试避免互相影响） */
export function resetHitFxWarmup(): void {
  bakedDay = -1;
}
