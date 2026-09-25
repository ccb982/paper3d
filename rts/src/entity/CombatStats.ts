// ============================================================
// CombatStats —— 战斗数值组合件（E5+：从 EntityBase 剥离）
// ============================================================
// 目的：战斗字段（生命/攻防/暴击/闪避/格挡/回复）不再散落在 EntityBase 上，
// 而是收进一个 `stats` 对象；子弹/物品等非战斗实体也只背这一个组合件。
// ★ 兼容：EntityBase 保留同名 getter/setter 转发（读写 API 零变化，行为零变化）。
// ============================================================

/** 战斗数值（伤害管线 modifiers 链的输入面；《RTS架构.md》§4.1） */
export interface CombatStats {
  /** 生命值 */
  hp: number;
  /** 生命上限（HUD/结算显示用；构造后与 hp 同步） */
  maxHp: number;
  /** 攻击力加成（modifierDefense：damage + attackPower - defense） */
  attackPower: number;
  /** 防御（减法减伤） */
  defense: number;
  /** ★ 攻击速度点数（方舟口径：100 为基准；实际间隔 = 基础间隔 × 100 / (100 + attackSpeed)） */
  attackSpeed: number;
  /** ★ 庇护：受到的伤害降低比例 0-1（modifierDamageReduction 在防御后乘算） */
  damageReduction: number;
  /** ★ 生命回复速度（每秒回血；模式层每帧结算，卸载装备即失效） */
  hpRegen: number;
  /** 暴击率 0-1（modifierCrit） */
  critRate: number;
  /** 暴击倍率 */
  critMult: number;
  /** 闪避率 0-1（modifierDodge） */
  dodgeRate: number;
  /** 格挡率 0-1（modifierBlock） */
  blockRate: number;
  /** 格挡减伤倍率（格挡时伤害 × blockMult） */
  blockMult: number;
}

/** 默认战斗数值（与剥离前 EntityBase 的字段默认值逐项一致） */
export function createCombatStats(): CombatStats {
  return {
    hp: 100,
    maxHp: 100,
    attackPower: 0,
    defense: 0,
    attackSpeed: 0,
    damageReduction: 0,
    hpRegen: 0,
    critRate: 0,
    critMult: 1.5,
    dodgeRate: 0,
    blockRate: 0,
    blockMult: 0.5,
  };
}
