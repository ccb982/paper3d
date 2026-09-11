// ============================================================
// RelicEffects —— 遗物效果注册表（每种效果一条独立管线 + 多时机钩子）
// ============================================================
// 背景：遗物效果原先硬编码在 computeCombatStats（只有 perDay/perDeath 两种）。
// 现在改为"配置 → 效果类型 → 处理器"分发，一个遗物可挂多条效果，各自独立管线。
//
// ★ 作用时机（每个遗物效果只实现自己关心的钩子即可，互不影响）：
//   modifyStats     属性结算（computeCombatStats：任意属性倍率/加值）
//   onRunStart      出击开局（WorldMode.enter：可返回授予道具）
//   onRunEnd        返回舰船（main.onReturn：可返回授予道具）
//   onDayAdvance    天数推进（返回舰船 day+1 后）
//   onPlayerDeath   玩家死亡
//   onKill          击杀敌人
//   onDamageDealt   造成伤害（target 非玩家）
//   onDamageTaken   受到伤害（target 是玩家）
//
// 新增遗物效果 = 注册一个处理器 + 配置引用类型；核心（Session/WorldMode/main）零改动。
// 分发器（eachOwnedRelic / relicGrantsFor / dispatchRelicEvent）由各时机调用点使用。
// ============================================================

import type { GameSession, RelicItemConfig } from './Session';

/** 遗物效果条目（配置驱动；除 type 外键由各处理器自定义） */
export interface RelicEffectConfig {
  type: string;
  [key: string]: unknown;
}

/** 属性累加器：各遗物效果把修正写进来，由 computeCombatStats 统一结算 */
export interface RelicStatAccumulator {
  mulHp: number;
  mulAtk: number;
  mulDef: number;
  bonusHp: number;
  bonusAtk: number;
  bonusDef: number;
}

export interface RelicStatContext {
  session: GameSession;
  /** 当前天数（perDay 类效果用） */
  day: number;
  /** 累计死亡次数（perDeath 类效果用） */
  deaths: number;
  /** 该遗物拥有件数（效果按件数递增） */
  count: number;
  acc: RelicStatAccumulator;
}

/** 时点钩子返回值：需要授予的局内道具（由调用方用 ItemManager 落账） */
export interface RelicStartGrant {
  itemId: string;
  count: number;
}

/** 生命周期/事件类钩子的上下文 */
export interface RelicRunContext {
  session: GameSession;
  /** 该遗物拥有件数 */
  count: number;
}

/** 事件类钩子的轻量载荷（不携带实体类型，保持 core 层零实体依赖） */
export interface RelicEventPayload {
  damage?: number;
  crit?: boolean;
  blocked?: boolean;
  dodged?: boolean;
}

/** 无返回值的时点钩子名 */
export type RelicEventHook =
  | 'onDayAdvance'
  | 'onPlayerDeath'
  | 'onKill'
  | 'onDamageDealt'
  | 'onDamageTaken';

/** 遗物效果处理器（只实现关心的钩子） */
export interface RelicEffectHandler {
  /** 属性管线：由 computeCombatStats 调用 */
  modifyStats?(ctx: RelicStatContext, cfg: RelicEffectConfig): void;
  /** 出击：由 WorldMode.enter 调用（返回的道具由模式层落账） */
  onRunStart?(ctx: RelicRunContext, cfg: RelicEffectConfig): RelicStartGrant[] | void;
  /** 返回舰船：由 main.onReturn 调用（返回的道具由调用方落账） */
  onRunEnd?(ctx: RelicRunContext, cfg: RelicEffectConfig): RelicStartGrant[] | void;
  /** 天数推进 */
  onDayAdvance?(ctx: RelicRunContext, cfg: RelicEffectConfig, ev: RelicEventPayload): void;
  /** 玩家死亡 */
  onPlayerDeath?(ctx: RelicRunContext, cfg: RelicEffectConfig, ev: RelicEventPayload): void;
  /** 击杀敌人 */
  onKill?(ctx: RelicRunContext, cfg: RelicEffectConfig, ev: RelicEventPayload): void;
  /** 造成伤害 */
  onDamageDealt?(ctx: RelicRunContext, cfg: RelicEffectConfig, ev: RelicEventPayload): void;
  /** 受到伤害 */
  onDamageTaken?(ctx: RelicRunContext, cfg: RelicEffectConfig, ev: RelicEventPayload): void;
}

/** 全局效果注册表：type → 处理器 */
export const relicEffectRegistry = new Map<string, RelicEffectHandler>();

// ============================================================
// 分发器（时机调用点统一走这里，避免各处手写遍历）
// ============================================================

/** 遍历所有已拥有遗物的效果（count > 0） */
export function eachOwnedRelic(
  session: GameSession,
  configs: Record<string, RelicItemConfig>,
  cb: (cfg: RelicItemConfig, count: number) => void,
): void {
  const owned = session.outOfRun?.owned ?? {};
  for (const [id, count] of Object.entries(owned)) {
    const cfg = configs[id];
    if (!cfg || (count ?? 0) <= 0) continue;
    cb(cfg, count);
  }
}

/** 收集"出击 / 返回"时点的道具授予（多遗物多效果聚合） */
export function relicGrantsFor(
  session: GameSession,
  configs: Record<string, RelicItemConfig>,
  hook: 'onRunStart' | 'onRunEnd',
): RelicStartGrant[] {
  const out: RelicStartGrant[] = [];
  eachOwnedRelic(session, configs, (cfg, count) => {
    for (const eff of cfg.effects ?? []) {
      const r = relicEffectRegistry.get(eff.type)?.[hook]?.({ session, count }, eff);
      if (r) out.push(...r);
    }
  });
  return out;
}

/** 派发无返回值的时点事件（天数/死亡/击杀/伤害） */
export function dispatchRelicEvent(
  session: GameSession,
  configs: Record<string, RelicItemConfig>,
  hook: RelicEventHook,
  ev: RelicEventPayload = {},
): void {
  eachOwnedRelic(session, configs, (cfg, count) => {
    for (const eff of cfg.effects ?? []) {
      const h = relicEffectRegistry.get(eff.type);
      h?.[hook]?.({ session, count }, eff, ev);
    }
  });
}

// ============================================================
// 内置效果
// ============================================================

/**
 * stat_multiplier —— 数值累积（每天 / 每次死亡，乘方复利；逐件递增）。
 * 参数：
 *   perDay / perDayStep      首件每日率、每多一件的步长（如 1.05 / 0.01）
 *   perDeath / perDeathStep  首件每次死亡率、每多一件的步长（如 1.005 / 0.001）
 *   scope                    'all'（默认三属性同吃）| 'attack'（只加攻击力）
 * 口径：每件各按自己的百分比独立复利（2 件黑冠 = 1.05×1.06 每日）。
 */
relicEffectRegistry.set('stat_multiplier', {
  modifyStats(ctx, cfg) {
    const k = ctx.count;
    let m = 1;
    const perDay = cfg.perDay as number | undefined;
    if (perDay) {
      const step = (cfg.perDayStep as number | undefined) ?? 0;
      for (let i = 0; i < k; i++) m *= Math.pow(perDay + step * i, ctx.day);
    }
    const perDeath = cfg.perDeath as number | undefined;
    if (perDeath) {
      const step = (cfg.perDeathStep as number | undefined) ?? 0;
      for (let i = 0; i < k; i++) m *= Math.pow(perDeath + step * i, ctx.deaths);
    }
    if (m === 1) return;
    if (cfg.scope === 'attack') {
      ctx.acc.mulAtk *= m;
    } else {
      ctx.acc.mulHp *= m;
      ctx.acc.mulAtk *= m;
      ctx.acc.mulDef *= m;
    }
  },
});

/**
 * start_items —— 出击开局授予局内道具（数量 = 配置 count × 拥有件数）。
 * 参数：items: [{ itemId, count }]
 */
relicEffectRegistry.set('start_items', {
  onRunStart(ctx, cfg): RelicStartGrant[] {
    const list = (cfg.items as { itemId: string; count: number }[] | undefined) ?? [];
    return list.map((g) => ({
      itemId: g.itemId,
      count: Math.max(1, g.count) * ctx.count,
    }));
  },
});
