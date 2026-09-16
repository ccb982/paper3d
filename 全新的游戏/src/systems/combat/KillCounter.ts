// ============================================================
// KillCounter.ts —— 击杀统计 + 每日敌人配额
// ============================================================
// 用户定调（2026-09-16）：
//   · 每天产生的敌人数量**有限**且动态调控（按威胁档位给当日配额）
//   · **离得远被清除的敌人不算击杀** —— 远距回收要从配额里"还回去"
//   · HUD 左半：当前击杀数 / 当天敌人总数
//
// 口径设计（关键）：
//   分母 enemyQuota = 当天"击杀可达上限"。
//   配额按 threat.ambientTarget / ambientInterval 动态估算：
//
//       quota = 袭击总量 + 环境常驻量 × 预计时长 / 补怪间隔
//
//   · 袭击总量：assaultsPerDay 期望场数 × 波数期望 × 每波人数期望
//   · 环境量：常驻目标 ×（预计在线分钟 × 60 / 补怪间隔）
//
//   ★ 远距回收（L1 半径外被清除）**不记击杀**，且从配额里扣除
//     （那只敌人玩家再也杀不到了，留在分母里会导致永远打不满）。
//     —— 这就是"不算击杀"的落地方式：分子不加 + 分母减。
//
// 状态存放：Session.dayProgress（随存档持久；跨出击累计，换日出击时重置）
// ============================================================

import type { GameSession } from '../../core/Session';
import type { ThreatProfile } from '../swarm/EnemyScaling';

/** ★ 单日敌人配额 + 击杀进度（存 dayProgress 里的形状） */
export interface DayEnemyProgress {
  /** 当天敌人总数（击杀可达上限；远距回收会扣减） */
  quota: number;
  /** 当天已击杀数（只统计真击杀：子弹/近战致死、掉坑致死） */
  kills: number;
  /** 当天已因远距回收而"还回"配额的数量（调试/展示用） */
  recalled: number;
}

/** 当天无进度时的兜底（防旧存档 / 未初始化） */
export function emptyEnemyProgress(): DayEnemyProgress {
  return { quota: 0, kills: 0, recalled: 0 };
}

/**
 * ★ 按威胁档位估算当日敌人总数（击杀可达上限）。
 *
 * @param threat 当日威胁档案（computeThreat 产出）
 * @param expectedMinutes 预计在线时长（分钟；用于估算环境散兵补怪总量）
 */
export function estimateDailyQuota(threat: ThreatProfile, expectedMinutes = 12): number {
  // ① 袭击总量（期望值；区间取中值 × 场数中值）
  const assaultsAvg = (threat.assaultsPerDay[0] + threat.assaultsPerDay[1]) / 2;
  const wavesAvg = (threat.assaultWaves[0] + threat.assaultWaves[1]) / 2;
  const countAvg = (threat.waveCount[0] + threat.waveCount[1]) / 2;
  // ★ 每波人数按"个体"计（spawnWaveNear 里 count 已按个体扣减）；
  //   成群兵种一窝多只 → 实际个体数约为名义的 1.35 倍（原石虫占比高）
  const PACK_MULT = 1.35;
  const assaultTotal = assaultsAvg * wavesAvg * countAvg * PACK_MULT;

  // ② 环境散兵：常驻目标数量随击杀不断补充 → 补怪总量 = 常驻 × 时长 / 间隔
  //    （常驻是"同时存活数"，不是总量；总量按补怪节拍累计）
  const ambientSpawns = (expectedMinutes * 60) / Math.max(0.5, threat.ambientInterval);

  // ③ 合计（下限保护：至少容纳第一批袭击）
  return Math.max(8, Math.round(assaultTotal + ambientSpawns));
}

/** ★ 今天是否已有配额；没有则按威胁初始化（出击开始时调用） */
export function ensureDayQuota(
  session: GameSession,
  threat: ThreatProfile,
  expectedMinutes = 12,
): DayEnemyProgress {
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) {
    dp.enemies = { quota: 0, kills: 0, recalled: 0 };
  }
  const e = dp.enemies;
  // ★ 配额为 0 = 还没为今天算过（跨日出击时由 resetDayQuota 清 0）
  if (e.quota <= 0) e.quota = estimateDailyQuota(threat, expectedMinutes);
  return e;
}

/** ★ 读取当天进度（无则返回零值，不写盘） */
export function readDayProgress(session: GameSession | null | undefined): DayEnemyProgress {
  if (!session) return emptyEnemyProgress();
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  return dp.enemies ?? emptyEnemyProgress();
}

/** ★ 换日重置（新的出击日：配额归零，下次 ensureDayQuota 按新威胁重算） */
export function resetDayQuota(session: GameSession): void {
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  dp.enemies = { quota: 0, kills: 0, recalled: 0 };
}

/** ★ 记一次真击杀（子弹/近战致死、掉深坑致死） */
export function recordKill(session: GameSession | null | undefined): void {
  if (!session) return;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) dp.enemies = { quota: 0, kills: 0, recalled: 0 };
  dp.enemies.kills++;
}

/**
 * ★ 记一次"远距清除"（不算击杀）：
 *   分子不加，分母扣 1 —— 这只敌人玩家再也杀不到了，
 *   留在配额里会导致"当天永远打不满"。
 * @returns 是否真的扣了分母（配额已见底时返回 false）
 */
export function recordRecall(session: GameSession | null | undefined, count = 1): boolean {
  if (!session) return false;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  const e = dp.enemies;
  if (!e) return false;
  let removed = 0;
  for (let i = 0; i < count; i++) {
    if (e.quota <= e.kills) break; // 已达成/超额：不动分母
    e.quota--;
    removed++;
  }
  if (removed <= 0) return false;
  e.recalled += removed;
  return true;
}

/** ★ HUD 展示用：{ 当前击杀数, 当天敌人总数 }（分母永不低于分子） */
export function queryKillProgress(session: GameSession | null | undefined): {
  kills: number;
  total: number;
} {
  const e = readDayProgress(session);
  return { kills: e.kills, total: Math.max(e.kills, e.quota) };
}

/** ★ 当天剩余可生成名额（供刷怪闸门：配额耗尽即停刷） */
export function remainingQuota(session: GameSession | null | undefined): number {
  const e = readDayProgress(session);
  // 剩余 = 配额 - 已击杀 - 场上存活（存活已占用了名额）
  // 调用方自行减去存活数；这里只给"配额 - 已击杀"
  return Math.max(0, e.quota - e.kills);
}
