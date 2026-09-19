// ============================================================
// KillCounter.ts —— 击杀统计 + 每日敌人配额
// ============================================================
// 用户定调（2026-09-16）：
//   · 每天产生的敌人数量**有限**且动态调控（按威胁档位给当日配额）
//   · **离得远被清除的敌人不算击杀** —— 远距回收要从配额里"还回去"
//   · HUD 左半：当前击杀数 / 当天敌人总数
//
// ★ 口径定稿（2026-09-16 二次修正，「敌人总数不该变」）：
//
//   分母 = **当天预计算好的敌人总数**，算一次就**冻结**，全天不变。
//   这是用户的设计意图 —— 当天有多少敌人是开战前就定好的计划值。
//
//   配额在**当日首次出击时**按威胁档位算一次：
//
//       quota = 袭击总量 + 环境常驻量 × 预计时长 / 补怪间隔
//
//   · 袭击总量：assaultsPerDay 期望场数 × 波数期望 × 每波人数期望
//   · 环境量：预计在线分钟 × 60 / 补怪间隔
//
//   ★ 冻结保证：`quota` 一旦 > 0 就**再也不改**（除换日重置）。
//     以下三件事**只记账、不动分母**：
//       - 真击杀 → kills++        （分子涨，分母不动 → 进度推进）
//       - 远距回收 → recalled++   （只记"这批没了"，不影响分母）
//       - 场上存活数抖动 → 不参与分母
//
//   ★ 为什么回收不再扣分母（前一版的做法，已废弃）：
//     扣分母会让「当天总数」随玩家跑动持续缩水，HUD 上数字自己往下掉 ——
//     与"当天敌人预先算好"的设计直接矛盾。回收只意味着**那只杀不到了**，
//     而闸门需要的是"还能刷多少只"，不该由分母表达。
//
//   那"配额耗尽"怎么判？→ `spawned`（当天**累计生成过**多少只）：
//
//       quota − spawned = 还能刷多少只
//
//   这个量只受"生成"影响，不受玩家跑动/距离回收影响 → 闸门稳定。
//   旧版用 `alive` 判闸门，敌人一被回收 alive 掉下来 → 立刻补刷 →
//   等于"无限刷"，分母就永远追不上，这是数字跳动的第二个来源。
//
//   进度展示：kills / quota。回收的怪不计入 kills，所以确实打不满 ——
//   这是**正确**的（用户明确要"不算击杀"），进度低说明你放跑了不少。
//   若担心永远差一截，可用 `effectiveTotal()` 拿到"扣除回收后的可达上限"，
//   但 HUD 默认展示用户要的原始 quota。
//
// 状态存放：Session.dayProgress（随存档持久；跨出击累计，换日出击时重置）
// ============================================================

import type { GameSession } from '../../core/Session';
import type { ThreatProfile } from '../swarm/EnemyScaling';

/** ★ 单日敌人配额 + 击杀进度（存 dayProgress 里的形状） */
export interface DayEnemyProgress {
  /** 当天敌人总数（**预计算后冻结**，全天不变；换日才重算） */
  quota: number;
  /** 当天已击杀数（只统计真击杀：子弹/近战致死、掉坑致死） */
  kills: number;
  /** 当天已因远距回收而消失的数量（**只记账，不影响 quota**） */
  recalled: number;
  /** ★ 当天累计**生成过**多少只（配额闸门依据；只增不减，不受回收影响） */
  spawned: number;
}

/** 当天无进度时的兜底（防旧存档 / 未初始化） */
export function emptyEnemyProgress(): DayEnemyProgress {
  return { quota: 0, kills: 0, recalled: 0, spawned: 0 };
}

/**
 * ★ 按威胁档位预计算当日敌人总数（**当天固定，不再变动**）。
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

  // ② 环境散兵：常驻目标数量随击杀不断补充 → 补怪总量 = 时长 / 补怪间隔
  //    （ambientTarget 是"同时存活数"，不是总量；总量按补怪节拍累计）
  const ambientSpawns = (expectedMinutes * 60) / Math.max(0.5, threat.ambientInterval);

  // ③ 合计（下限保护：至少容纳第一批袭击）
  return Math.max(8, Math.round(assaultTotal + ambientSpawns));
}

/** ★ 今天是否已有配额；没有则按威胁**预计算并冻结**（出击开始时调用）
 *
 *  ★ 幂等：quota 已 > 0 时**原样返回，绝不重算** —— 这是"总数不变"的保证。
 *    同日多次出击也走这里，进度与配额都沿用。 */
export function ensureDayQuota(
  session: GameSession,
  threat: ThreatProfile,
  expectedMinutes = 12,
): DayEnemyProgress {
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) {
    dp.enemies = { quota: 0, kills: 0, recalled: 0, spawned: 0 };
  }
  const e = dp.enemies;
  // 旧存档迁移：缺 spawned 字段补 0（不影响 quota 冻结语义）
  if (typeof e.spawned !== 'number') e.spawned = 0;
  // ★ 配额为 0 = 还没为今天算过（跨日出击时由 resetDayQuota 清 0）
  //   一旦算过就冻结 → 当天总数全天不变
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
  dp.enemies = { quota: 0, kills: 0, recalled: 0, spawned: 0 };
}

/** ★ 记一次真击杀（子弹/近战致死、掉深坑致死）——**只动分子** */
export function recordKill(session: GameSession | null | undefined): void {
  if (!session) return;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) dp.enemies = { quota: 0, kills: 0, recalled: 0, spawned: 0 };
  dp.enemies.kills++;
}

/**
 * ★ 蜂群架构兵力创建（2026-09-19）：**同步抬高当天敌人总数**。
 *   新模型下兵力计划由指挥层动态决定（大队一个个来），分母跟着实际生成走，
 *   HUD 「kills / quota」才不会出现“杀了 60 总数才 40”的不一致。
 */
export function addQuota(session: GameSession | null | undefined, count = 1): void {
  if (!session || count <= 0) return;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) dp.enemies = { quota: 0, kills: 0, recalled: 0, spawned: 0 };
  dp.enemies.quota += count;
}

/** ★ 记一次生成（配额闸门的唯一依据；只增不减） */
export function recordSpawn(session: GameSession | null | undefined, count = 1): void {
  if (!session || count <= 0) return;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  if (!dp.enemies) dp.enemies = { quota: 0, kills: 0, recalled: 0, spawned: 0 };
  if (typeof dp.enemies.spawned !== 'number') dp.enemies.spawned = 0;
  dp.enemies.spawned += count;
}

/**
 * ★ 记一次"远距清除"（不算击杀）。
 *
 * ★ 2026-09-16 二次修正：**不再扣减分母**。
 *   旧版扣分母会导致 HUD 上「当天总数」随玩家跑动持续缩水，
 *   与"当天敌人预先算好、全天不变"的设计矛盾。
 *   回收只记 `recalled`（这批没了、玩家杀不到了），分母保持冻结。
 *   配额闸门改用 `spawned`，因此回收后也**不会**触发补刷。
 *
 * @returns 是否真的记了一笔（无 session 时 false）
 */
export function recordRecall(session: GameSession | null | undefined, count = 1): boolean {
  if (!session || count <= 0) return false;
  const dp = session.dayProgress as unknown as { enemies?: DayEnemyProgress };
  const e = dp.enemies;
  if (!e) return false;
  e.recalled += count;
  return true;
}

/** ★ HUD 展示用：{ 当前击杀数, 当天敌人总数【冻结】 } */
export function queryKillProgress(session: GameSession | null | undefined): {
  kills: number;
  total: number;
} {
  const e = readDayProgress(session);
  return { kills: e.kills, total: e.quota };
}

/**
 * ★ 配额闸门查询：当天**还能再生成**多少只。
 *
 * = quota − spawned（累计生成过多少）。
 *   只受"生成"影响 → 玩家跑动、远距回收都不会让它乱跳。
 *   （旧版用 alive 判定，敌人一被回收就腾出名额 → 无限刷，已废弃）
 */
export function remainingQuota(session: GameSession | null | undefined): number {
  const e = readDayProgress(session);
  const spawned = typeof e.spawned === 'number' ? e.spawned : 0;
  return Math.max(0, e.quota - spawned);
}

/**
 * ★ 可达上限（可选展示）：扣除已被远距回收的那些。
 *   回收的敌人玩家再也杀不到 → 真实可打满的上限 = quota − recalled。
 *   默认 HUD 用原始 quota（用户要"当天总数"）；进度条类 UI 可用本值。
 */
export function effectiveTotal(session: GameSession | null | undefined): number {
  const e = readDayProgress(session);
  return Math.max(0, e.quota - e.recalled);
}
