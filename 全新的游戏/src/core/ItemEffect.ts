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
  const player = ctx.session.player;
  const value = params.value ?? 30;
  // 999 = 恢复全部
  const actual = value >= 999
    ? player.maxHp - player.hp
    : Math.min(player.maxHp - player.hp, value);
  player.hp += actual;
  return { success: true, healAmount: actual, message: `回复 ${actual} 点生命` };
});

effectRegistry.set('buff_attack', (params, ctx) => {
  // 此处预留 Buff 系统接口
  return { success: true, message: `攻击力提升 ${params.value}` };
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
