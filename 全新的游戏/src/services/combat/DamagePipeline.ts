// ============================================================
// DamagePipeline —— 伤害计算管线（服务层，架构 4.1）
// ============================================================
// 命中（碰撞）→ DamageRequest → 增益/防御/暴击结算 → 最终伤害。
// 子弹/近战/技能/陷阱统一走这里——实体只提供属性，公式集中一处可调。

import type { EntityBase } from '../../entity/EntityBase';

/** 伤害结算结果 */
export interface DamageResult {
  /** 最终伤害 */
  final: number;
  /** 是否暴击 */
  crit: boolean;
}

/** ★ 伤害结算：base + source.attackPower - target.defense（下限 1），
 *   暴击：roll < source.critRate → 伤害 × critMult */
export function resolveDamage(base: number, source: EntityBase, target: EntityBase): DamageResult {
  const crit = Math.random() < source.critRate;
  const flat = base + source.attackPower - target.defense;
  const final = Math.max(1, Math.round(flat * (crit ? source.critMult : 1)));
  return { final, crit };
}

/** ★ 命中入口：结算 → 应用（onTakeDamage） */
export function applyDamage(base: number, source: EntityBase, target: EntityBase): DamageResult {
  const r = resolveDamage(base, source, target);
  target.onTakeDamage(r.final, source);
  return r;
}
