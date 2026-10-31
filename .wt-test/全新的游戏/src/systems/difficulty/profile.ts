// ============================================================
// 难度画像 —— **单一真源**（2026-10-27 架构收敛）
// ============================================================
// ★ 收敛前的问题（systems/swarm/EnemyScaling.ts）：
//   · 两套档案（EnemyScale 强度 / ThreatProfile 数量+结构），三套系数
//     （DAY_GAIN / PULL_GAIN / THREAT_*），同一天数与抽卡在**不同维度**各算一遍，
//     调参时得同时盯三个地方；
//   · ThreatProfile 里 8 个字段（场次/波数/首波时间/两场间隔/每波人数/游荡目标/
//     补怪间隔/追击意图）**全是死字段**——旧刷怪计划系统删掉后没人读了，
//     只有 SwarmLedger 的兜底分支在读，而那个分支永远走不到；
//   · 抽卡十连与单抽**不可区分**（只记 totalPulls ⇒ 10 连 = 10 次单抽）。
//
// ★ 收敛后：
//   · 一份 DifficultyProfile，三条轴（时间/风险/强度）各算一次，输出三块：
//       数量（dailyTotal）· 强度（strengthMul/atkMul/defBonus）· 攻势（aggro/bias）
//   · 死字段全删；旧兜底算法（SwarmLedger.estimateDailyTotal）删。
//   · 风险轴用「等效抽数」统一表达：等效抽数 = 总抽数 + 十连次数 × TEN_PULL_EQUIV
//     ⇒ **十连比单抽额外惩罚**天然成立，且三处（数量/强度/攻势）口径一致。
// ============================================================

import {
  ATK_CAP, ATK_FLOOR_OF_HP, DAY_AXIS, DEF_CAP, DEF_PER_UNIT, HP_FLOOR_OF_ATK,
  MAX_ENEMY_STAT, MAX_REF_STAT, POWER_AXIS, RISK_AXIS, SECOND_ASSAULT_ATK, STRUCTURE,
} from './config';

// ============================================================
// 输入 / 输出类型
// ============================================================

/** 难度输入（唯一入口；三轴） */
export interface DifficultyInputs {
  /** ① 时间轴：当前天数（1 起） */
  day: number;
  /** ② 风险轴：累计抽卡次数（单抽 + 十连都算） */
  totalPulls: number;
  /** ② 风险轴：累计**十连**次数（★ 十连比单抽额外惩罚的判据） */
  totalTenPulls: number;
  /** ③ 强度轴：玩家参考生命上限（基础 + 遗物；**不含装备**） */
  refHp: number;
  /** ③ 强度轴：玩家参考攻击力（基础 + 遗物；**不含装备**） */
  refAtk: number;
  /** ③ 强度轴：玩家参考防御（基础 + 遗物；**不含装备**） */
  refDef: number;
}

/** 难度画像（**唯一真源**：数量 / 强度 / 攻势三块都从这里出） */
export interface DifficultyProfile {
  /** 当前天数 */
  day: number;
  /** 风险轴等效抽数（十连已折算进额外惩罚） */
  riskPulls: number;
  /** 数量乘数（时间轴 × 风险轴） */
  countMul: number;
  /** ★ 当日敌人总数（**配额唯一口径** → ledger.total） */
  dailyTotal: number;
  /** 敌人强度总倍率（= 血量倍率） */
  strengthMul: number;
  /** 基础攻击倍率（不含「同日第 2 波」加压） */
  atkMul: number;
  /** 防御加值（加到名册基础防御上） */
  defBonus: number;
  /** 血量硬下限（≥ 玩家参考攻击 × 1/2） */
  hpFloor: number;
  /** 攻击硬下限（≥ 玩家参考生命 × 1/10） */
  atkFloor: number;
  /** 压力指数（攻势形态 + HUD 档位的唯一自变量；1 ~ maxIndex） */
  pressure: number;
  /** 仇恨半径倍率 */
  aggroMul: number;
  /** 游荡偏向玩家倍率 */
  biasMul: number;
  /** HUD 档位（不显示精确数值） */
  tier: DifficultyTier;
}

/** 单只敌人的最终数值（画像 + 波次加压） */
export interface EnemyStats {
  /** 血量倍率 */
  hpMul: number;
  /** 攻击倍率 */
  atkMul: number;
  /** 防御加值 */
  defBonus: number;
  /** 血量硬下限 */
  hpFloor: number;
  /** 攻击硬下限 */
  atkFloor: number;
}

/** HUD 档位（不给精确数值） */
export interface DifficultyTier {
  label: string;
  color: string;
}

// ============================================================
// 轴 ② 风险轴：抽卡 → 等效抽数
// ============================================================

/**
 * ★ 风险轴折算：等效抽数 = 总抽数 + 十连次数 × TEN_PULL_EQUIV。
 *
 * 用户口径（2026-10-27）：「**10 连比单抽有额外的惩罚**」。
 * 只记总抽数分不出「10 连」和「10 次单抽」，所以十连次数单独记账，
 * 每次十连额外按 `TEN_PULL_EQUIV` 抽计 —— 三个维度（数量/强度/攻势）共用它，口径一致。
 */
export function riskEquivalentPulls(totalPulls: number, totalTenPulls: number): number {
  const pulls = Math.max(0, Math.floor(totalPulls));
  const tenPulls = Math.max(0, Math.floor(totalTenPulls));
  return pulls + tenPulls * RISK_AXIS.tenPullEquiv;
}

/** 风险轴 → 数量乘数（1 ~ 1+countCap） */
export function riskCountMul(riskPulls: number): number {
  const add =
    RISK_AXIS.countPerPull * riskPulls +
    RISK_AXIS.countPerTenBlock * Math.floor(riskPulls / 10);
  return 1 + Math.min(RISK_AXIS.countCap, add);
}

// ============================================================
// 主计算
// ============================================================

function clampStat(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(MAX_REF_STAT, Math.max(0, v));
}

/** 档位名（低 → 极高） */
const TIER_LABELS = ['低', '较低', '中', '较高', '极高'];
/** 档位配色（绿 → 红） */
const TIER_COLORS = ['#9fd8a0', '#cfe8a0', '#ffd98a', '#ffb066', '#ff7a6a'];

/**
 * 计算难度画像（出击 / 换日时算一次；纯函数，无副作用）
 */
export function computeDifficulty(inp: DifficultyInputs): DifficultyProfile {
  const day = Math.max(1, Math.floor(inp.day));
  const riskPulls = riskEquivalentPulls(inp.totalPulls, inp.totalTenPulls);
  const tenBlocks = Math.floor(riskPulls / 10);

  // ---- ③ 强度轴：玩家参考属性 → 敌人强度（对数阻尼 ⇒ 收益递减）----
  const refHp = clampStat(inp.refHp);
  const refAtk = clampStat(inp.refAtk);
  const refDef = clampStat(inp.refDef);
  const power =
    POWER_AXIS.weightHp * (refHp / POWER_AXIS.baselineHp) +
    POWER_AXIS.weightAtk * (refAtk / POWER_AXIS.baselineAtk) +
    POWER_AXIS.weightDef * (refDef / POWER_AXIS.baselineDef);
  const growth = Math.min(POWER_AXIS.cap, 1 + POWER_AXIS.gain * Math.log2(Math.max(1, power)));

  // ---- 强度总倍率 = 强度轴 × (时间轴 + 风险轴) ----
  const progress = Math.min(
    RISK_AXIS.strengthCap,
    1 +
      DAY_AXIS.strengthGain * (day - 1) +
      RISK_AXIS.strengthPerPull * riskPulls +
      RISK_AXIS.strengthPerTenBlock * tenBlocks,
  );
  const strengthMul = Math.min(POWER_AXIS.totalCap, growth * progress);
  const over = strengthMul - 1;

  // ---- 数量：时间轴复利 × 风险轴 ----
  const countMul = Math.pow(1 + DAY_AXIS.countGrowth, day - 1) * riskCountMul(riskPulls);
  const dailyTotal = Math.max(8, Math.round(DAY_AXIS.countBase * countMul));

  // ---- 压力指数（攻势形态 + HUD 档位的唯一自变量）----
  const pressure = Math.min(
    STRUCTURE.maxIndex,
    1 +
      STRUCTURE.powerGain * Math.max(0, power - 1) +
      DAY_AXIS.structureGain * (day - 1) +
      RISK_AXIS.structurePerPull * riskPulls +
      RISK_AXIS.structurePerTenBlock * tenBlocks,
  );
  const t = (pressure - 1) / (STRUCTURE.maxIndex - 1);

  return {
    day,
    riskPulls,
    countMul,
    dailyTotal,
    strengthMul,
    atkMul: Math.min(ATK_CAP, 1 + over * 0.6),
    defBonus: Math.min(DEF_CAP, Math.round(over * DEF_PER_UNIT)),
    hpFloor: Math.min(MAX_ENEMY_STAT, refAtk * HP_FLOOR_OF_ATK),
    atkFloor: Math.min(MAX_ENEMY_STAT, refHp * ATK_FLOOR_OF_HP),
    pressure,
    aggroMul: lerp(STRUCTURE.aggro[0], STRUCTURE.aggro[1], t),
    biasMul: lerp(STRUCTURE.bias[0], STRUCTURE.bias[1], t),
    tier: difficultyTier(pressure),
  };
}

/** 单只敌人的最终数值（画像 + 同日第 N 波加压） */
export function enemyStats(profile: DifficultyProfile | null, assaultIndex = -1): EnemyStats {
  const p = profile ?? DEFAULT_DIFFICULTY;
  return {
    hpMul: p.strengthMul,
    atkMul: p.atkMul * (assaultIndex > 0 ? SECOND_ASSAULT_ATK : 1),
    defBonus: p.defBonus,
    hpFloor: p.hpFloor,
    atkFloor: p.atkFloor,
  };
}

/** 兜底画像（第 1 天 / 无抽卡 / 玩家基线属性 ⇒ 三个倍率恒为 1；算画像前用它顶位） */
export const DEFAULT_DIFFICULTY: DifficultyProfile = computeDifficulty({
  day: 1,
  totalPulls: 0,
  totalTenPulls: 0,
  refHp: POWER_AXIS.baselineHp,
  refAtk: POWER_AXIS.baselineAtk,
  refDef: POWER_AXIS.baselineDef,
});

// ============================================================
// HUD 档位（压力指数 → 档位名/配色）
// ============================================================

/** 压力指数 → 档位（低/较低/中/较高/极高） */
export function difficultyTier(pressure: number): DifficultyTier {
  const t = (Math.min(STRUCTURE.maxIndex, Math.max(1, pressure)) - 1) / (STRUCTURE.maxIndex - 1);
  const i = Math.min(TIER_LABELS.length - 1, Math.max(0, Math.floor(t * TIER_LABELS.length)));
  return { label: TIER_LABELS[i], color: TIER_COLORS[i] };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
