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
import { applyHeal } from '../services/combat/Healing';

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
  // ★ 世界内：走统一治疗入口（截断/死亡跳过/healBuffer 累积）
  const entity = ctx.user;
  if (entity) {
    if (entity.dead) return { success: false, message: '等待复活中' };
    const actual = applyHeal(entity, value >= 999 ? entity.maxHp : value);
    return { success: true, healAmount: actual, message: `回复 ${actual} 点生命` };
  }
  // ★ 舰船上（无实体）：治疗存档数值
  const player = ctx.session.player;
  const actual = Math.max(0, value >= 999 ? player.maxHp - player.hp : Math.min(player.maxHp - player.hp, value));
  player.hp += actual;
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

effectRegistry.set('equip', (_params, ctx) => {
  // ★ 防具武器类：使用道具 → 放入出击槽池第一个空槽（在格即已穿戴，贴片全量叠加）
  const itemId = ctx.itemId;
  if (!itemId) return { success: false, message: '装备数据缺失' };
  const slots = ctx.session.player.slots;
  if (!Array.isArray(slots)) return { success: false, message: '出击槽池未初始化' };
  // ★ 只在 SLOT_COUNT 范围内找空槽（与 ItemManager.equipToFirstFreeSlot 同口径）
  let idx = -1;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!slots[i]) { idx = i; break; }
  }
  if (idx === -1) return { success: false, message: `装备栏已满（${SLOT_COUNT}/${SLOT_COUNT}）` };
  slots[idx] = itemId;
  eventBus.emit('deployment_changed', { slotIndex: idx, itemId, prev: null });
  return { success: true, message: `已装备到装备栏 ${idx + 1}` };
});

effectRegistry.set('summon_drone', (_params, ctx) => {
  // ★ 召唤必须发生在战场上：基地里没有世界侧监听，成功返回会让物品被"用掉"却什么都没发生。
  if (!ctx.user) return { success: false, message: '需在作战中使用' };
  // ★ 召唤「可露希尔的无人机」：广播事件，由 WorldMode 近玩家位置生成无人机
  eventBus.emit('drone_summon', {});
  return { success: true, message: '已放出可露希尔的无人机' };
});

effectRegistry.set('summon_sentinel', (_params, ctx) => {
  // ★ 同上：放置类效果只在战场生效（避免基地误点把祖宗消耗掉）
  if (!ctx.user) return { success: false, message: '需在作战中使用' };
  // ★ 放置「祖宗」：广播事件，由 WorldMode 在玩家身前放置站桩友军
  eventBus.emit('sentinel_summon', {});
  return { success: true, message: '已放置祖宗' };
});

/**
 * ★ train —— 永久提升存档基础属性（"加上限"类消耗品：糖果/补剂）。
 *
 * 与 buff 的区别：
 *   - buff   = 限时（效果队列），只在作战中生效，过期即消失；
 *   - train  = **直接改写 session.player 的基础属性并存盘**，永久累积、
 *              基地/战场都可用、下次出击依旧生效。
 *
 * 参数：
 *   stats: { maxHp?: number; attackPower?: number; defense?: number; ... }  各属性增量
 *   cap?:  { maxHp?: number; ... }  该属性的**绝对值上限**（省略 = 不设上限）
 *   message?: 自定义提示（省略则自动拼"攻击力 +2"这类文案）
 *
 * 口径：写的是"基础值"（EffectSystem 的 base 层），遗物乘区/装备加算照旧叠在它之上。
 */
const TRAIN_LABELS: Record<string, string> = {
  maxHp: '生命上限',
  attackPower: '攻击力',
  defense: '防御',
};

effectRegistry.set('train', (params, ctx) => {
  const stats = params.stats as Record<string, number> | undefined;
  if (!stats) return { success: false, message: '效果配置缺失' };
  const cap = (params.cap ?? {}) as Record<string, number>;
  const player = ctx.session.player as unknown as Record<string, number>;
  const parts: string[] = [];

  for (const [key, inc] of Object.entries(stats)) {
    if (typeof inc !== 'number' || inc === 0) continue;
    const cur = player[key];
    if (typeof cur !== 'number') continue;
    const limit = cap[key];
    const next = typeof limit === 'number' ? Math.min(limit, cur + inc) : cur + inc;
    const delta = next - cur;
    if (delta === 0) continue;
    player[key] = next;
    parts.push(`${TRAIN_LABELS[key] ?? key} +${+delta.toFixed(2)}`);
  }

  if (parts.length === 0) return { success: false, message: '已达到上限' };

  // 当前生命若被抬高上限，按提升后的上限保留（不额外回血；回血由 heal 效果负责）
  eventBus.emit('player_stats_changed', { reason: 'train' });
  return {
    success: true,
    message: params.message ? String(params.message) : `永久 ${parts.join('、')}`,
  };
});
