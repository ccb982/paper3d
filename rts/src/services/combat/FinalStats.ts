// ============================================================
// FinalStats —— 角色最终战斗属性（实时查询唯一出口）
// ============================================================
// 最终值 = 基础（存档原值）× 遗物（mul/flat）× 装备/限时效果（EffectSystem 聚合写回）。
// ★ 约定：任何"用角色属性算伤害/速度/数值"的地方（子弹、无人机、祖宗、技能、召唤物…）
//   一律走 queryFinalStats(entity)，不要散读实体字段——
//   以后最终值来源改变（改成计算存储/多源合成）只需改本函数，调用点不动。
//
// 零分配：直接返回实体本体（字段即最终值），类型收窄为 FinalStats。

import type { EntityBase } from '../../entity/EntityBase';

/** 角色最终战斗属性视图（实体字段子集；只读使用，勿写回） */
export type FinalStats = Pick<
  EntityBase,
  | 'hp' | 'maxHp' | 'attackPower' | 'defense'
  | 'attackSpeed' | 'damageReduction' | 'hpRegen'
  | 'critRate' | 'critMult' | 'dodgeRate' | 'blockRate' | 'blockMult'
>;

/** ★ 实时查询角色最终属性（零分配：返回实体本体；只读，勿长期持有引用语义以外的东西） */
export function queryFinalStats(e: EntityBase): FinalStats {
  return e;
}
