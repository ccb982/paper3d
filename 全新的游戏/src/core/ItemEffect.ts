// ============================================================
// ItemEffect.ts —— 物品效果注册表
// ============================================================
// 架构设计：所有效果的具体实现集中注册于此，
// 新增效果只需加一个条目，不修改任何其他代码。
// 由 ItemArchetype.use() 遍历调用。
// ============================================================

import type { GameSession } from './Session';
import { SLOT_COUNT } from './Session';
import type { EntityBase } from '../entity/EntityBase';
import { eventBus } from './EventBus';
import { effectSystem } from '../services/combat/EffectSystem';

/** 物品效果执行上下文 */
export interface ItemEffectContext {
  session: GameSession;
  user: EntityBase | null;
  targetLayer: string;
  row: number;
  col: number;
  /** ★ 当前使用的物品 id（装备类效果用：把道具穿戴到对应装备位） */
  itemId?: string;
  _accumulatedHeal?: number; // 用于跨效果累加
}

/** 物品效果执行结果 */
export interface ItemEffectResult {
  success: boolean;
  message?: string;
  healAmount?: number;
  ammoAmount?: number;
  // 任意扩展字段（未来 buff/teleport/summon 等）
}

/** 效果处理器类型 */
export type ItemEffectHandler = (params: any, ctx: ItemEffectContext) => ItemEffectResult;

/** 全局效果注册表 */
export const effectRegistry = new Map<string, ItemEffectHandler>();

// ===== 内置效果注册 =====

effectRegistry.set('heal', (params, ctx) => {
  const value = params.value ?? 30;
  // ★ 世界内：治疗实体（与 HUD/效果队列同源，且作为"治疗转伤害"proc 的燃料）；
  //   舰船上（无实体）：治疗存档数值
  const entity = ctx.user;
  const maxHp = entity ? entity.maxHp : ctx.session.player.maxHp;
  const hp = entity ? entity.hp : ctx.session.player.hp;
  // 999 = 恢复全部
  const actual = Math.max(0, value >= 999 ? maxHp - hp : Math.min(maxHp - hp, value));
  if (entity) {
    entity.hp += actual;
    entity.healBuffer += actual;
  } else {
    ctx.session.player.hp += actual;
  }
  return { success: true, healAmount: actual, message: `回复 ${actual} 点生命` };
});

effectRegistry.set('buff_attack', (params, ctx) => {
  // ★ 限时攻击增益：走统一效果队列（时长/延长叠层；需在世界内对实体生效）
  if (!ctx.user) return { success: false, message: '需在作战中使用' };
  const value = params.value ?? 5;
  const duration = params.duration ?? 30;
  effectSystem.addEffect(ctx.user, {
    id: params.id ?? 'buff_attack',
    source: 'consumable',
    duration,
    stackMode: 'extend',
    flat: { attackPower: value },
  });
  return { success: true, message: `攻击力提升 ${value}（${duration} 秒）` };
});

effectRegistry.set('buff', (params, ctx) => {
  // ★ 通用限时增益（items.json 配置驱动）：stats/pct 键 = EntityBase 战斗属性名
  if (!ctx.user) return { success: false, message: '需在作战中使用' };
  const duration = params.duration ?? 30;
  effectSystem.addEffect(ctx.user, {
    id: params.id ?? 'buff',
    source: 'consumable',
    duration,
    stacks: params.stacks ?? 1,
    maxStacks: params.maxStacks ?? 1,
    stackMode: params.stackMode ?? 'refresh',
    flat: params.stats,
    pct: params.pct,
  });
  return { success: true, message: params.message ?? '获得增益' };
});

effectRegistry.set('ammo', (params, ctx) => {
  // ★ 弹药补给：使用弹药包 → 入弹药池（AMMO类型分池，默认 'default'）
  const value = params.value ?? 50;
  const ammoType = params.ammoType ?? 'default';
  const pool = ctx.session.player.ammo;
  if (!pool) return { success: false, message: '弹药池未初始化' };
  pool[ammoType] = (pool[ammoType] ?? 0) + value;
  return { success: true, ammoAmount: value, message: `补充 ${value} 发弹药` };
});

effectRegistry.set('equip', (params, ctx) => {
  // ★ 防具武器类：使用道具 → 放入出击槽池第一个空槽（在格即已穿戴，贴片全量叠加）
  const itemId = ctx.itemId;
  if (!itemId) return { success: false, message: '装备数据缺失' };
  const slots = ctx.session.player.slots;
  if (!Array.isArray(slots)) return { success: false, message: '出击槽池未初始化' };
  const idx = slots.findIndex((s) => !s);
  if (idx === -1) return { success: false, message: `出击槽已满（${SLOT_COUNT}/${SLOT_COUNT}）` };
  slots[idx] = itemId;
  eventBus.emit('deployment_changed', { slotIndex: idx, itemId, prev: null });
  return { success: true, message: `已放入出击槽 ${idx + 1}` };
});

effectRegistry.set('summon_drone', (_params, _ctx) => {
  // ★ 召唤「可露希尔的无人机」：广播事件，由 WorldMode 近玩家位置生成无人机
  eventBus.emit('drone_summon', {});
  return { success: true, message: '已放出可露希尔的无人机' };
});

effectRegistry.set('summon_sentinel', (_params, _ctx) => {
  // ★ 放置「祖宗」：广播事件，由 WorldMode 在玩家身前放置站桩友军
  eventBus.emit('sentinel_summon', {});
  return { success: true, message: '已放置祖宗' };
});
