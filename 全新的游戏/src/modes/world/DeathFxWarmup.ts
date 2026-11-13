// ============================================================
// DeathFxWarmup —— 死亡特效池的"每天预计算"
// ============================================================
// 用户口径（2026-11-13）：「我要每天预计算」——
//   每天第一次进战场时，把当天所有敌人资产的死亡特效池**预建好**，
//   而不是等"当天第一次死亡"才建（那一下要分配流体场纹理 + 首批 shader 编译）。
//
// ★ 与 HitFxWarmup 的分工：
//   HitFxWarmup 管**击中特效图集**（每天换一组随机变体）；
//   本文件管**死亡特效池**（每天释放 + 重建，保证显存不跨天累积）。
// ★ 状态放模块级：跨 WorldMode 实例持久（与 FxRuntime / CharacterFxManager 同为单例语义）。
// ============================================================

import { CharacterFxManager } from '../../services/fx/CharacterFxManager';

/** 最近一次预计算对应的出击天数（-1 = 尚未预热） */
let warmedDay = -1;

/**
 * 换日时**开始**异步预建：只清旧池 + 入队（不建实例，避免进战场卡一帧）。
 * 真正的构建由 `stepDeathFxWarmup()` 每帧推一个。
 * @param assets 当天可能出现的敌人资产（`ctx.enemyAssets` 原样传）
 * @param today 当前**出击天数**（session.meta.day；回基地时 +1）
 * @returns 待建实例数（0 = 同一天重复进战场，或资产不支持）
 */
export function prewarmDeathFxForDay(assets: readonly unknown[], today: number): number {
  if (today === warmedDay) return 0;
  warmedDay = today;
  CharacterFxManager.resetPools();
  return CharacterFxManager.beginPrewarm(assets);
}

/** ★ 每帧调用：建 1 个待建实例（33 个 ≈ 0.5s 摊完，不卡单帧） */
export function stepDeathFxWarmup(): void {
  CharacterFxManager.prewarmStep();
}

/** 探针/测试用：重置记忆（跨局测试避免互相影响） */
export function resetDeathFxWarmup(): void {
  warmedDay = -1;
}
