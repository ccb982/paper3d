// ============================================================
// DamagePipeline —— 伤害计算管线（服务层，架构 4.1）
// ============================================================
// ★ 可插拔 modifiers 结算链：命中 → 按序执行 modifier（可中断）→ 最终伤害。
//   加机制（遗物/元素/真伤/格挡/护盾…）= 写一个 modifier 插入链，不改核心。
//   实体只提供属性（EntityBase 战斗属性），公式/顺序集中此处可调。

import type { EntityBase } from '../../entity/EntityBase';

/** 伤害结算结果 */
export interface DamageResult {
  /** 最终伤害（0 = 被闪避/格挡免疫） */
  final: number;
  /** 是否暴击 */
  crit: boolean;
  /** 是否被闪避 */
  dodged: boolean;
  /** 是否被格挡 */
  blocked: boolean;
}

/** ★ 结算上下文（modifier 链共享；伤害类型元素后续扩展） */
export interface DamageContext {
  base: number;
  source: EntityBase;
  target: EntityBase;
  /** 伤害类型（'physical' 默认；元素后续） */
  type: string;
  /** 当前结算伤害（modifier 可增改） */
  damage: number;
  crit: boolean;
  dodged: boolean;
  blocked: boolean;
}

/** ★ modifier：一个结算步骤（可修改 ctx.damage / 标记状态） */
export type DamageModifier = (ctx: DamageContext) => void;

// ============ modifiers（按序执行，可插拔） ============

/** 闪避：roll < target.dodgeRate → 伤害归零 + 标记 */
const modifierDodge: DamageModifier = (ctx) => {
  if (ctx.target.dodgeRate > 0 && Math.random() < ctx.target.dodgeRate) {
    ctx.dodged = true;
    ctx.damage = 0;
  }
};

/** 格挡：roll < target.blockRate → 伤害 × blockMult（格挡减伤） */
const modifierBlock: DamageModifier = (ctx) => {
  if (ctx.target.blockRate > 0 && Math.random() < ctx.target.blockRate) {
    ctx.blocked = true;
    ctx.damage *= ctx.target.blockMult;
  }
};

/** 护盾：先扣护盾值（护盾吸收伤害，超出部分穿透） */
const modifierShield: DamageModifier = (ctx) => {
  if (ctx.target.shield <= 0) return;
  const absorbed = Math.min(ctx.target.shield, ctx.damage);
  ctx.target.shield -= absorbed;
  ctx.damage -= absorbed;
};

/** 防御：减法（base + attackPower - defense，下限 1） */
const modifierDefense: DamageModifier = (ctx) => {
  ctx.damage = ctx.damage + ctx.source.attackPower - ctx.target.defense;
};

/** 暴击：roll < critRate → × critMult（放在防御后，暴击作用于净伤害） */
const modifierCrit: DamageModifier = (ctx) => {
  if (ctx.source.critRate > 0 && Math.random() < ctx.source.critRate) {
    ctx.crit = true;
    ctx.damage *= ctx.source.critMult;
  }
};

/** 下限/取整 */
const modifierClamp: DamageModifier = (ctx) => {
  ctx.damage = ctx.damage > 0 ? Math.max(1, Math.round(ctx.damage)) : 0;
};

/** ★ 结算链（顺序即语义；加新机制 = 插入新 modifier） */
const PIPELINE: DamageModifier[] = [
  modifierDodge,
  modifierBlock,
  modifierShield,
  modifierDefense,
  modifierCrit,
  modifierClamp,
];

/** ★ 结算：base → modifiers 链 → 结果（不修改实体状态，纯计算） */
export function resolveDamage(base: number, source: EntityBase, target: EntityBase, type = 'physical'): DamageResult {
  const ctx: DamageContext = {
    base,
    source,
    target,
    type,
    damage: base,
    crit: false,
    dodged: false,
    blocked: false,
  };
  for (const m of PIPELINE) {
    m(ctx);
    if (ctx.dodged || ctx.damage <= 0) break; // 闪避/归零 → 中断后续
  }
  return { final: ctx.damage, crit: ctx.crit, dodged: ctx.dodged, blocked: ctx.blocked };
}

/** ★ 命中入口：结算 → 应用（未闪避才扣血） */
export function applyDamage(base: number, source: EntityBase, target: EntityBase, type = 'physical'): DamageResult {
  const r = resolveDamage(base, source, target, type);
  if (!r.dodged && r.final > 0) target.onTakeDamage(r.final, source);
  return r;
}
