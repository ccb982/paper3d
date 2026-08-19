// ============================================================
// ItemEffect.ts —— 物品效果注册表
// ============================================================
// 架构设计：所有效果的具体实现集中注册于此，
// 新增效果只需加一个条目，不修改任何其他代码。
// 由 ItemArchetype.use() 遍历调用。
// ============================================================

import type { GameSession } from './Session';
import type { EntityBase } from '../entity/EntityBase';

/** 物品效果执行上下文 */
export interface ItemEffectContext {
  session: GameSession;
  user: EntityBase | null;
  targetLayer: string;
  row: number;
  col: number;
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
  console.log(`[效果] 攻击力 +${params.value}，持续 ${params.duration ?? 10} 秒`);
  return { success: true, message: `攻击力提升 ${params.value}` };
});

effectRegistry.set('ammo', (params, ctx) => {
  // 弹药补给逻辑（预留）
  const value = params.value ?? 50;
  return { success: true, ammoAmount: value, message: `补充 ${value} 发弹药` };
});
