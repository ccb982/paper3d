// ============================================================
// EffectSystem.ts —— 统一效果处理队列（战斗服务层）
// ============================================================
// ★ 所有"随时间生效的属性修正"走同一条队列（2026-09-11 用户定调）：
//   不再分散 inline（此前：装备快照写字段 / 回血在 WorldMode 每帧 tick）。
//
// 数据模型：效果 = 来源(source) + 时长/层数 + 属性修正(flat/pct)
//   - EntityBase.effects  活跃效果列表（惰性创建；null = 零开销）
//   - EntityBase.statBase 基础属性（聚合公式的底；首次挂效果自动捕获）
//
// 作用域：★ 只服务玩家（队友/敌人不挂效果）——WorldMode 每帧对玩家显式调
//   tickEntity（实体自身 update 不做任何效果推进，260 实体零额外开销）：
//   ① 推进时长 → 过期移除
//   ② 属性聚合：base × (1+pct) + flat → 写回实体战斗属性
//   ③ 逐帧结算生命回复（hpRegen；死亡/满血跳过）
//
// 效果源（source）：
//   - 'equipment'  装备：setSourceEffects 原子替换（换装/卸载）
//   - 'consumable' 消耗品：addEffect（限时/叠层/延长；力量药剂等）
//   - 'relic' / 'aura' 预留（遗物当前走 computeCombatStats 进基础值）
//
// 聚合口径（对齐方舟）：
//   - maxHp/attackPower/defense/critMult/blockMult：base × (1+pct) + flat
//   - attackSpeed/hpRegen/critRate/dodgeRate/blockRate：base + flat（点数加算）
//   - damageReduction：max(base, 各效果)（"庇护"同名取最高，不叠加）

import type { EntityBase } from '../../entity/EntityBase';
import { applyHeal } from './Healing';

/** 效果来源分组（同源替换、跨源叠加） */
export type EffectSource = 'equipment' | 'consumable' | 'relic' | 'aura';

/** 可被效果修正的战斗属性键（EntityBase 字段名） */
export type EffectStatKey =
  | 'maxHp' | 'attackPower' | 'defense'
  | 'attackSpeed' | 'hpRegen' | 'damageReduction'
  | 'critRate' | 'critMult' | 'dodgeRate' | 'blockRate' | 'blockMult';

/** ★ 治疗转伤害 proc（遥·幽隙栖萤口径）：累计治疗量 × ratio → 对半径内最多 maxTargets 名敌人结算 */
export interface HealProcDef {
  /** 伤害 = 治疗量 × ratio（1 = 100%） */
  ratio: number;
  /** 每次触发最多命中数 */
  maxTargets: number;
  /** 触发半径（米） */
  radius: number;
}

/** 效果定义（挂载入口） */
export interface EffectDef {
  /** 唯一 id：同 id 按 stackMode 刷新/叠层/延长 */
  id: string;
  source: EffectSource;
  /** 持续秒数；缺省 Infinity（永久，装备类） */
  duration?: number;
  /** 初始层数（默认 1） */
  stacks?: number;
  /** 层数上限（默认 1） */
  maxStacks?: number;
  /** 同 id 重复添加：refresh=刷新时长（默认）/ stack=叠层 / extend=累加时长 */
  stackMode?: 'refresh' | 'stack' | 'extend';
  /** 加算修正 */
  flat?: Partial<Record<EffectStatKey, number>>;
  /** 加法乘区（多个效果求和：base × mul × (1 + Σpct) + Σflat） */
  pct?: Partial<Record<EffectStatKey, number>>;
  /** ★ 乘法乘区（多个效果相乘：遗物复利等；与 pct 独立） */
  mul?: Partial<Record<EffectStatKey, number>>;
  /** ★ 治疗转伤害 proc（多个效果时取 ratio 最高者） */
  healProc?: HealProcDef;
}

/** 活跃效果（实体持有时长实例） */
export interface ActiveEffect {
  id: string;
  source: EffectSource;
  /** 剩余时长（秒）；Infinity = 永久 */
  remaining: number;
  /** 总时长（面板进度用） */
  duration: number;
  stacks: number;
  maxStacks: number;
  stackMode: 'refresh' | 'stack' | 'extend';
  flat: Partial<Record<EffectStatKey, number>>;
  pct: Partial<Record<EffectStatKey, number>>;
  mul?: Partial<Record<EffectStatKey, number>>;
  healProc?: HealProcDef;
}

class EffectSystem {
  /** 设置/覆盖基础属性并立即重算（模式层注入永久属性底） */
  setBaseStats(e: EntityBase, stats: Partial<Record<EffectStatKey, number>>): void {
    if (!e.statBase) e.statBase = {};
    Object.assign(e.statBase, stats);
    this.applyAggregated(e);
  }

  /** 挂效果（返回活跃实例；同 id 已存在 → 按 stackMode 处理） */
  addEffect(e: EntityBase, def: EffectDef): ActiveEffect {
    this.ensureBase(e, def);
    if (!e.effects) e.effects = [];
    const dur = def.duration ?? Infinity;
    const existing = e.effects.find((f) => f.id === def.id);
    if (existing) {
      const mode = def.stackMode ?? 'refresh';
      if (mode === 'stack') {
        existing.stacks = Math.min(existing.maxStacks, existing.stacks + (def.stacks ?? 1));
      }
      if (mode === 'extend' && existing.remaining !== Infinity && dur !== Infinity) {
        existing.remaining += dur;
      } else {
        existing.remaining = dur;
        existing.duration = dur;
      }
      existing.flat = def.flat ? { ...def.flat } : {};
      existing.pct = def.pct ? { ...def.pct } : {};
      existing.mul = def.mul ? { ...def.mul } : undefined;
      existing.healProc = def.healProc ? { ...def.healProc } : undefined;
      this.applyAggregated(e);
      return existing;
    }
    const fx: ActiveEffect = {
      id: def.id,
      source: def.source,
      remaining: dur,
      duration: dur,
      stacks: def.stacks ?? 1,
      maxStacks: def.maxStacks ?? 1,
      stackMode: def.stackMode ?? 'refresh',
      flat: def.flat ? { ...def.flat } : {},
      pct: def.pct ? { ...def.pct } : {},
      mul: def.mul ? { ...def.mul } : undefined,
      healProc: def.healProc ? { ...def.healProc } : undefined,
    };
    e.effects.push(fx);
    this.applyAggregated(e);
    return fx;
  }

  /** ★ 原子替换某来源的全部效果（装备同步用：换装/卸载一次到位） */
  setSourceEffects(e: EntityBase, source: EffectSource, defs: Array<Omit<EffectDef, 'source'>>): void {
    if (e.effects) {
      for (let i = e.effects.length - 1; i >= 0; i--) {
        if (e.effects[i].source === source) e.effects.splice(i, 1);
      }
      if (e.effects.length === 0) e.effects = null;
    }
    for (const d of defs) this.addEffect(e, { ...d, source });
    // 即使 defs 为空也要重算：卸载最后一件装备时还原基础属性
    this.applyAggregated(e);
  }

  /** ★ 每帧推进（WorldMode 对玩家调用；无效果实体不参与） */
  tickEntity(e: EntityBase, dt: number): void {
    const list = e.effects;
    if (!list) return;
    let expired = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const fx = list[i];
      if (fx.remaining === Infinity) continue;
      fx.remaining -= dt;
      if (fx.remaining <= 0) {
        list.splice(i, 1);
        expired = true;
      }
    }
    if (list.length === 0) e.effects = null;
    if (expired) this.applyAggregated(e);
    // ★ 生命回复（聚合后的 hpRegen）→ 统一治疗入口（截断/死亡跳过/healBuffer 累积）
    if (e.hpRegen > 0) applyHeal(e, e.hpRegen * dt);
  }

  /** 基础属性捕获：首次挂效果时把被修正的键现值记为底（避免叠加漂移） */
  private ensureBase(e: EntityBase, def: EffectDef): void {
    if (!e.statBase) e.statBase = {};
    const put = (k: EffectStatKey): void => {
      if (e.statBase![k] === undefined) {
        e.statBase![k] = (e as unknown as Record<EffectStatKey, number>)[k] ?? 0;
      }
    };
    if (def.flat) for (const k of Object.keys(def.flat) as EffectStatKey[]) put(k);
    if (def.pct) for (const k of Object.keys(def.pct) as EffectStatKey[]) put(k);
    if (def.mul) for (const k of Object.keys(def.mul) as EffectStatKey[]) put(k);
  }

  /** ★ 属性聚合：base × Πmul × (1 + Σpct) + Σflat → 写回实体（伤害管线/开火逻辑只读实体字段） */
  private applyAggregated(e: EntityBase): void {
    const statOf = (k: EffectStatKey): number => {
      const base = e.statBase?.[k];
      if (base !== undefined) return base;
      return (e as unknown as Record<EffectStatKey, number>)[k] ?? 0;
    };
    const flat: Record<string, number> = {};
    const pct: Record<string, number> = {};
    const mul: Record<string, number> = {};
    let drMax = 0;
    const list = e.effects;
    if (list) {
      for (const fx of list) {
        const n = fx.stacks;
        for (const k of Object.keys(fx.flat) as EffectStatKey[]) {
          const v = (fx.flat[k] ?? 0) * n;
          if (k === 'damageReduction') drMax = Math.max(drMax, v);
          else flat[k] = (flat[k] ?? 0) + v;
        }
        for (const k of Object.keys(fx.pct) as EffectStatKey[]) {
          pct[k] = (pct[k] ?? 0) + (fx.pct[k] ?? 0) * n;
        }
        // ★ 乘法乘区：逐效果相乘（层数 = 幂）
        if (fx.mul) {
          for (const k of Object.keys(fx.mul) as EffectStatKey[]) {
            mul[k] = (mul[k] ?? 1) * Math.pow(fx.mul[k] ?? 1, n);
          }
        }
      }
    }
    const F = (k: EffectStatKey): number => flat[k] ?? 0;
    const P = (k: EffectStatKey): number => pct[k] ?? 0;
    const M = (k: EffectStatKey): number => mul[k] ?? 1;

    e.maxHp = Math.floor(statOf('maxHp') * M('maxHp') * (1 + P('maxHp')) + F('maxHp'));
    e.attackPower = Math.floor(statOf('attackPower') * M('attackPower') * (1 + P('attackPower')) + F('attackPower'));
    e.defense = Math.floor(statOf('defense') * M('defense') * (1 + P('defense')) + F('defense'));
    e.critMult = statOf('critMult') * M('critMult') * (1 + P('critMult')) + F('critMult');
    e.blockMult = statOf('blockMult') * M('blockMult') * (1 + P('blockMult')) + F('blockMult');
    e.attackSpeed = statOf('attackSpeed') * M('attackSpeed') + F('attackSpeed');
    e.hpRegen = statOf('hpRegen') * M('hpRegen') + F('hpRegen');
    e.critRate = statOf('critRate') * M('critRate') + F('critRate');
    e.dodgeRate = statOf('dodgeRate') * M('dodgeRate') + F('dodgeRate');
    e.blockRate = statOf('blockRate') * M('blockRate') + F('blockRate');
    e.damageReduction = Math.min(0.9, Math.max(statOf('damageReduction') * M('damageReduction'), drMax));
    // ★ 治疗转伤害 proc（多效果取 ratio 最高；无则清空）
    let proc: HealProcDef | null = null;
    if (list) {
      for (const fx of list) {
        if (fx.healProc && (!proc || fx.healProc.ratio > proc.ratio)) proc = fx.healProc;
      }
    }
    e.healProc = proc;
    if (!proc) e.healBuffer = 0; // ★ 无 proc 时清空累计治疗（防止重新装备时一次性爆发）
    if (e.hp > e.maxHp) e.hp = e.maxHp;
  }
}

/** ★ 全局效果队列（单例；状态挂在实体上，跨模式无残留） */
export const effectSystem = new EffectSystem();
