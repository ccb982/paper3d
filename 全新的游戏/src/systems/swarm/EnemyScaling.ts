// ============================================================
// EnemyScaling —— 敌人数值增强（每日系数；2026-09-13 重做 v2）
// ============================================================
// 口径（用户定调）：
//   · 敌人【基础数值】随角色增强而增强 —— 参考属性 = 玩家基础 + 遗物，**不含装备**
//   · 硬下限（防一下秒 / 防无威胁）：
//       - 敌人血量 ≥ 角色攻击 × 1/2
//       - 敌人攻击 ≥ 角色血量 × 1/10
//   · 天数 / 抽卡：额外加压；★ 每满 10 抽额外惩罚一跳
//   · 同日第 2 波袭击：攻击 ×1.15
//   · ★ 威胁度 ThreatProfile（2026-09-13 定调）：波次频率 / 每波人数 / 攻击欲望
//     全部随 角色属性 + 抽卡 + 天数 变化，且**梯度陡**（线性强力项，封顶 6）
//
// 计算时机：每次出击算一次（生成/升格共用同一份系数）。
// 调参集中在下方常量。
// ============================================================

/** 玩家基线（与 createNewSession 首日一致） */
export const PLAYER_BASELINE = { maxHp: 100, attackPower: 10, defense: 2 } as const;

// ---- 可调参数 ----
/** 玩家增强 → 敌人基础同步增强的强度（对数阻尼，收益递减） */
const GROWTH_GAIN = 0.4;
/** 玩家增强项封顶（1 + 该项） */
const GROWTH_CAP = 1.6;
/** 每天的倍率增量 */
const DAY_GAIN = 0.1;
/** 每抽的倍率增量 */
const PULL_GAIN = 0.015;
/** ★ 每满 10 抽的额外惩罚增量 */
const PULL_TEN_PENALTY = 0.06;
/** 天数/抽卡加压项封顶 */
const PROGRESS_CAP = 2.6;
/** 总倍率上限（基础增强 × 天数抽卡） */
const TOTAL_CAP = 5.0;

// ---- 硬下限（相对玩家参考攻击） ----
/** 敌人血量 ≥ 角色攻击 × 该系数（1/2 → 至少两枪） */
export const HP_FLOOR_OF_ATK = 0.5;
/** 敌人攻击 ≥ 角色血量 × 该系数（1/10 → 始终有威胁） */
export const ATK_FLOOR_OF_HP = 0.1;

// ---- 防御映射 ----
const DEF_PER_UNIT = 5;
const DEF_CAP = 30;

/** 同日第二波袭击的攻击乘数 */
const SECOND_ASSAULT_ATK = 1.15;

/** ★ 防御性上限：参考属性/下限封顶（Float32 代理池上限约 3.4e38；
 *  遗物复利在超高天数会指数爆炸，若不封顶 → 代理血量溢出成 Infinity → 永远打不死） */
const MAX_REF_STAT = 1e6;
const MAX_ENEMY_STAT = 1e6;

export interface ScalingInputs {
  day: number;
  /** 累计抽卡次数（session.gacha.totalPulls） */
  totalPulls: number;
  /** ★ 玩家参考属性（基础 + 遗物；不含装备） */
  refHp: number;
  refAtk: number;
  refDef: number;
  /** 袭击序号（0/1；环境散兵 = -1） */
  assaultIndex?: number;
}

export interface EnemyScale {
  /** 基础增强倍率（随角色；已含天数/抽卡上限） */
  hp: number;
  /** 攻击倍率（软映射，防秒杀） */
  atk: number;
  /** 防御加值（加到基础防御上） */
  def: number;
  /** 血量硬下限（绝对值） */
  hpFloor: number;
  /** 攻击硬下限（绝对值） */
  atkFloor: number;
  /** 综合倍率（HUD/预警显示用） */
  total: number;
}

/** 计算当日敌强系数 */
export function computeEnemyScale(inp: ScalingInputs): EnemyScale {
  // 参考属性防御性封顶（防超限溢出；正常游玩远达不到）
  const refHp = Math.min(MAX_REF_STAT, Math.max(0, inp.refHp));
  const refAtk = Math.min(MAX_REF_STAT, Math.max(0, inp.refAtk));
  const refDef = Math.min(MAX_REF_STAT, Math.max(0, inp.refDef));
  // ---- ① 角色增强（对数阻尼；封顶） ----
  const power =
    0.45 * (refHp / PLAYER_BASELINE.maxHp) +
    0.45 * (refAtk / PLAYER_BASELINE.attackPower) +
    0.10 * (refDef / PLAYER_BASELINE.defense);
  const growth = Math.min(GROWTH_CAP, 1 + GROWTH_GAIN * Math.log2(Math.max(1, power)));

  // ---- ② 天数 / 抽卡（含 10 连额外惩罚） ----
  const pulls = Math.max(0, Math.floor(inp.totalPulls));
  const progress = Math.min(
    PROGRESS_CAP,
    1 + DAY_GAIN * Math.max(0, inp.day - 1) + PULL_GAIN * pulls + PULL_TEN_PENALTY * Math.floor(pulls / 10),
  );

  const total = Math.min(TOTAL_CAP, growth * progress);
  const over = total - 1;
  const secondAssault = (inp.assaultIndex ?? -1) > 0 ? SECOND_ASSAULT_ATK : 1;
  return {
    hp: total,
    atk: Math.min(3.5, 1 + over * 0.6) * secondAssault,
    def: Math.min(DEF_CAP, Math.round(over * DEF_PER_UNIT)),
    hpFloor: Math.min(MAX_ENEMY_STAT, refAtk * HP_FLOOR_OF_ATK),
    atkFloor: Math.min(MAX_ENEMY_STAT, refHp * ATK_FLOOR_OF_HP),
    total,
  };
}

// ============================================================
// ★ 威胁度（波次/数量/攻击欲望；与敌强同一套输入）
// ============================================================

/** 威胁度上限（1 = 基准；梯度陡 → 线性强力项） */
export const THREAT_MAX = 6;
/** 各输入项的威胁增量（陡梯度） */
const THREAT_POWER_GAIN = 0.6;   // 每 +1 倍基准强度
const THREAT_DAY_GAIN = 0.35;    // 每天
const THREAT_PULL_GAIN = 0.03;   // 每抽
const THREAT_TEN_PENALTY = 0.15; // ★ 每满 10 抽额外一跳

export interface ThreatProfile {
  /** 威胁度（1~6） */
  index: number;
  /** 单场袭击波数区间 */
  assaultWaves: [number, number];
  /** 每波人数区间 */
  waveCount: [number, number];
  /** 首波袭击时间区间（秒，自出击起） */
  firstAssault: [number, number];
  /** 两场袭击间隔区间（秒） */
  assaultGap: [number, number];
  /** 平时游荡目标数量 / 补怪间隔（秒） */
  ambientTarget: number;
  ambientInterval: number;
  /** 攻击欲望：仇恨半径倍率（代理索敌圈）/ 游荡偏向玩家倍率 / 环境怪带追击意图概率 */
  aggroMul: number;
  biasMul: number;
  intentChance: number;
}

/** 基准威胁（无输入时；t=0 档） */
export function neutralThreat(): ThreatProfile {
  return buildThreat(1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildThreat(index: number): ThreatProfile {
  const idx = Math.min(THREAT_MAX, Math.max(1, index));
  const t = (idx - 1) / (THREAT_MAX - 1); // 0..1
  return {
    index: idx,
    // 波次：3~4 场 → 5~7 场；每波 8~14 → 20~30 只
    assaultWaves: [Math.round(lerp(3, 5, t)), Math.round(lerp(4, 7, t))],
    waveCount: [Math.round(lerp(8, 20, t)), Math.round(lerp(14, 30, t))],
    // 节奏：首波 100~180s → 40~70s；间隔 150~270s → 70~140s
    firstAssault: [lerp(100, 40, t), lerp(180, 70, t)],
    assaultGap: [lerp(150, 70, t), lerp(270, 140, t)],
    // 平时游荡：15 只 / 10s → 45 只 / 4s
    ambientTarget: Math.round(lerp(15, 45, t)),
    ambientInterval: lerp(10, 4, t),
    // 攻击欲望：仇恨圈 ×1 → ×2.2；游荡偏向 0.12 → 0.35；环境怪主动开进概率 0 → 0.7
    aggroMul: lerp(1, 2.2, t),
    biasMul: lerp(0.12, 0.35, t),
    intentChance: lerp(0, 0.7, t),
  };
}

/** 计算威胁度（输入与敌强一致：参考属性不含装备） */
export function computeThreat(inp: ScalingInputs): ThreatProfile {
  const refHp = Math.min(MAX_REF_STAT, Math.max(0, inp.refHp));
  const refAtk = Math.min(MAX_REF_STAT, Math.max(0, inp.refAtk));
  const refDef = Math.min(MAX_REF_STAT, Math.max(0, inp.refDef));
  const power =
    0.45 * (refHp / PLAYER_BASELINE.maxHp) +
    0.45 * (refAtk / PLAYER_BASELINE.attackPower) +
    0.10 * (refDef / PLAYER_BASELINE.defense);
  const pulls = Math.max(0, Math.floor(inp.totalPulls));
  const index =
    1 +
    THREAT_POWER_GAIN * Math.max(0, power - 1) +
    THREAT_DAY_GAIN * Math.max(0, inp.day - 1) +
    THREAT_PULL_GAIN * pulls +
    THREAT_TEN_PENALTY * Math.floor(pulls / 10);
  return buildThreat(index);
}

// ============================================================
// HUD 展示（档位分级，不给精确数值）
// ============================================================

/** 档位名（低 → 极高） */
const TIER_LABELS = ['低', '较低', '中', '较高', '极高'];
/** 档位配色（绿 → 红） */
const TIER_COLORS = ['#9fd8a0', '#cfe8a0', '#ffd98a', '#ffb066', '#ff7a6a'];

export interface ThreatTier {
  label: string;
  color: string;
}

/** 威胁度 → 档位（低/较低/中/较高/极高） */
export function threatTier(index: number): ThreatTier {
  const t = (Math.min(THREAT_MAX, Math.max(1, index)) - 1) / (THREAT_MAX - 1);
  const i = Math.min(TIER_LABELS.length - 1, Math.max(0, Math.floor(t * TIER_LABELS.length)));
  return { label: TIER_LABELS[i], color: TIER_COLORS[i] };
}
