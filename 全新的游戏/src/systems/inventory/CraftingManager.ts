// ============================================================
// CraftingManager.ts —— 合成管理（共享业务逻辑层）
// 无 UI 依赖，只操作 Session 数据 + ItemManager。
// ShipMode 和 WorldMode 共用同一个类，各自实例化。
// ============================================================

import type { GameSession } from '../../core/Session';
import { ItemManager } from './ItemManager';
import craftingRecipes from '../../config/craftRecipes.json';

export interface Recipe {
  id: string;
  name: string;
  inputs: { itemId: string; count: number }[];
  output: { itemId: string; count: number };
  station: 'ship' | 'portable';
}

export class CraftingManager {
  private recipes: Recipe[] = (craftingRecipes as any).recipes.map((r: any) => ({
    ...r,
    station: r.station as 'ship' | 'portable',
  }));

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
  ) {}

  /** 获取当前合成台可用的配方 */
  getAvailableRecipes(station: 'ship' | 'portable'): Recipe[] {
    return this.recipes.filter(r => r.station === station || r.station === 'ship');
  }

  /** 检查是否拥有足够材料（★ 统计所有背包层：基地+飞船+玩家 的总数） */
  canCraft(recipeId: string, _srcLayer: keyof GameSession['inventories']): boolean {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe) return false;
    for (const input of recipe.inputs) {
      if (this.itemManager.countTotal(input.itemId) < input.count) return false;
    }
    return true;
  }

  /** 执行合成（★ 扣料跨层：按 基地→飞船→玩家 顺序；产出放 dstLayer） */
  craft(
    recipeId: string,
    srcLayer: keyof GameSession['inventories'],
    dstLayer: keyof GameSession['inventories'],
  ): boolean {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe || !this.canCraft(recipeId, srcLayer)) return false;

    // 产出目标：同层合并语义下，目标层已有同类 → 恒有空间；否则需空格
    if (!this.itemManager.hasSpace(dstLayer, recipe.output.itemId, recipe.output.count)) {
      return false;
    }

    // 扣材料（基地优先 → 飞船 → 玩家；canCraft 已保证总量足够）
    const deductOrder: (keyof GameSession['inventories'])[] = ['base', 'ship', 'player'];
    for (const input of recipe.inputs) {
      let need = input.count;
      for (const layer of deductOrder) {
        if (need <= 0) break;
        const have = this.itemManager.countItem(layer, input.itemId);
        const take = Math.min(have, need);
        if (take > 0) this.itemManager.removeItem(layer, input.itemId, take);
        need -= take;
      }
    }

    this.itemManager.addItem(dstLayer, recipe.output.itemId, recipe.output.count);
    return true;
  }
}