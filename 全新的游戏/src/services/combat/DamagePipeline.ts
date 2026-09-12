// ============================================================
// DamagePipeline —— 伤害计算管线（服务层，架构 4.1）
// ============================================================
// ★ 可插拔 modifiers 结算链：命中 → 按序执行 modifier（可中断）→ 最终伤害。
//   加机制（遗物/元素/真伤/格挡…）= 写一个 modifier 插入链，不改核心。
//   实体只提供属性（EntityBase 战斗属性），公式/顺序集中此处可调。
//
// ★ 伤害载荷契约（2026-09-12 类型化，杜绝"攻方攻击力重复叠"）：
//   - base 默认 = 调用方算好的完整基础伤害（子弹/友军弹道/激光：开火时已含攻击力）；
//   - includeSourceAttack=true 才在管线里叠加 source.attackPower（仅敌人近战这类
//     "AI 基础伤害 + 攻方攻击力"的调用方使用）；
//   - ignoreDefense=true 跳过减法防御（法术/环境口径，如治疗转伤害 proc）。
//   ★ 命中事件（damage）统一由 applyDamage 发出——调用点不再手发，漏发不可能。

import type { EntityBase } from '../../entity/EntityBase';
import { eventBus } from '../../core/EventBus';

/** ★ 调用选项（语义显式化，见文件头契约） */
export interface DamageOptions {
  /** 伤害类型（'physical' 默认；元素后续）。事件带出，当前无 modifier 消费 */
  type?: string;
  /** base 未含攻方攻击力 → 管线叠加（默认 false） */
  includeSourceAttack?: boolean;
  /** 跳过减法防御（默认 false） */
  ignoreDefense?: boolean;
}

/** 伤害结算结果 */
export interface DamageResult {
  /** 最终伤害（0 = 被闪避/格挡免疫/未破防） */
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
  /** ★ base 未含攻方攻击力 → 防御步骤叠加（默认 false） */
  includeSourceAttack: boolean;
  /** ★ 跳过减法防御 */
  ignoreDefense: boolean;
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

/** 防御：减法（damage [ + attackPower（显式开启时）] - defense） */
const modifierDefense: DamageModifier = (ctx) => {
  if (ctx.ignoreDefense) return;
  const atk = ctx.includeSourceAttack ? ctx.source.attackPower : 0;
  ctx.damage = ctx.damage + atk - ctx.target.defense;
};

/** 庇护/伤害减免：防御后乘算（方舟"庇护"口径；上限 90%） */
const modifierDamageReduction: DamageModifier = (ctx) => {
  const dr = Math.max(0, Math.min(0.9, ctx.target.damageReduction));
  if (dr > 0) ctx.damage *= 1 - dr;
};

/** 暴击：roll < critRate → × critMult（放在防御后，暴击作用于净伤害） */
const modifierCrit: DamageModifier = (ctx) => {
  if (ctx.source.critRate > 0 && Math.random() < ctx.source.critRate) {
    ctx.crit = true;
    ctx.damage *= ctx.source.critMult;
  }
};

/** ★ 结算链（顺序即语义；加新机制 = 插入新 modifier） */
const PIPELINE: DamageModifier[] = [
  modifierDodge,
  modifierBlock,
  modifierDefense,
  modifierDamageReduction,
  modifierCrit,
];

/** ★ 归一化：负数/零 → 0；正数 → 至少 1 的整数 */
function normalize(raw: number): number {
  return raw > 0 ? Math.max(1, Math.round(raw)) : 0;
}

/** ★ 结算：base → modifiers 链 → 结果（不修改实体状态，纯计算；final 恒 ≥ 0） */
export function resolveDamage(
  base: number,
  source: EntityBase,
  target: EntityBase,
  opts: DamageOptions = {},
): DamageResult {
  const ctx: DamageContext = {
    base,
    source,
    target,
    type: opts.type ?? 'physical',
    includeSourceAttack: opts.includeSourceAttack ?? false,
    ignoreDefense: opts.ignoreDefense ?? false,
    damage: base,
    crit: false,
    dodged: false,
    blocked: false,
  };
  for (const m of PIPELINE) {
    m(ctx);
    if (ctx.dodged || ctx.damage <= 0) break; // 闪避/归零 → 中断后续
  }
  return { final: normalize(ctx.damage), crit: ctx.crit, dodged: ctx.dodged, blocked: ctx.blocked };
}

/** ★ 命中入口：结算 → 应用（未闪避且伤害>0 才扣血）→ 统一发 damage 事件 */
export function applyDamage(
  base: number,
  source: EntityBase,
  target: EntityBase,
  opts: DamageOptions = {},
): DamageResult {
  const r = resolveDamage(base, source, target, opts);
  if (!r.dodged && r.final > 0) target.onTakeDamage(r.final, source);
  eventBus.emit('damage', {
    target,
    source,
    damage: r.final,
    crit: r.crit,
    dodged: r.dodged,
    blocked: r.blocked,
    type: opts.type ?? 'physical',
  });
  return r;
}
