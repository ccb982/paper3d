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

  /** 检查玩家是否拥有足够材料 */
  canCraft(recipeId: string, srcLayer: keyof GameSession['inventories']): boolean {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe) return false;
    if (srcLayer === 'allies') return false;
    const grid = this.session.inventories[srcLayer];
    if (!Array.isArray(grid)) return false;

    const available = new Map<string, number>();
    for (const row of grid) {
      for (const cell of row) {
        if (cell) available.set(cell.itemId, (available.get(cell.itemId) || 0) + cell.stackSize);
      }
    }
    for (const input of recipe.inputs) {
      if ((available.get(input.itemId) || 0) < input.count) return false;
    }
    return true;
  }

  /** 执行合成 */
  craft(
    recipeId: string,
    srcLayer: keyof GameSession['inventories'],
    dstLayer: keyof GameSession['inventories'],
  ): boolean {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe || !this.canCraft(recipeId, srcLayer)) return false;

    // 扣材料
    for (const input of recipe.inputs) {
      this.itemManager.removeItem(srcLayer, input.itemId, input.count);
    }

    // 产出物（先判断目标网格是否有空间）
    const output = recipe.output;
    if (!this.itemManager.hasSpace(dstLayer, output.itemId, output.count)) {
      // 回滚材料
      for (const input of recipe.inputs) {
        this.itemManager.addItem(srcLayer, input.itemId, input.count);
      }
      return false;
    }
    this.itemManager.addItem(dstLayer, output.itemId, output.count);
    return true;
  }
}