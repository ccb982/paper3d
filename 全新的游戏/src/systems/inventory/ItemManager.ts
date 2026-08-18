// ============================================================
// ItemManager.ts —— 物品管理（共享业务逻辑层）
// 无 UI 依赖，只操作 Session 数据。
// ShipMode 和 WorldMode 共用同一个类，各自实例化。
// ============================================================

import type { GameSession } from '../../core/Session';
import { addItemToGrid, removeItemFromGrid, moveItemBetweenGrids } from '../../core/Session';
import itemsConfig from '../../config/items.json';

export interface UseItemResult {
  success: boolean;
  message?: string;
  healAmount?: number;
  ammoAmount?: number;
}

export class ItemManager {
  constructor(private session: GameSession) {}

  /** 添加物品到指定网格（自动堆叠） */
  addItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    if (layer === 'allies') return false; // 队友背包需指定具体干员
    const grid = this.session.inventories[layer];
    if (!Array.isArray(grid)) return false;
    const maxStack = itemsConfig.items.find(i => i.id === itemId)?.maxStack || 99;
    return addItemToGrid(grid, itemId, count, maxStack);
  }

  /** 从指定网格移除物品 */
  removeItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    if (layer === 'allies') return false;
    const grid = this.session.inventories[layer];
    if (!Array.isArray(grid)) return false;
    return removeItemFromGrid(grid, itemId, count);
  }

  /** 跨层移动物品 */
  moveItem(
    srcLayer: keyof GameSession['inventories'],
    dstLayer: keyof GameSession['inventories'],
    itemId: string,
    count: number,
  ): boolean {
    if (srcLayer === 'allies' || dstLayer === 'allies') return false;
    const srcGrid = this.session.inventories[srcLayer];
    const dstGrid = this.session.inventories[dstLayer];
    if (!Array.isArray(srcGrid) || !Array.isArray(dstGrid)) return false;
    const maxStack = itemsConfig.items.find(i => i.id === itemId)?.maxStack || 99;
    return moveItemBetweenGrids(srcGrid, dstGrid, itemId, count, maxStack);
  }

  /** 获取网格中所有物品列表（供 UI 渲染） */
  getItems(layer: keyof GameSession['inventories']): { itemId: string; stackSize: number; row: number; col: number }[] {
    if (layer === 'allies') return [];
    const grid = this.session.inventories[layer];
    const result: { itemId: string; stackSize: number; row: number; col: number }[] = [];
    if (!Array.isArray(grid)) return result;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const slot = grid[r][c];
        if (slot) result.push({ itemId: slot.itemId, stackSize: slot.stackSize, row: r, col: c });
      }
    }
    return result;
  }

  /** 使用物品（消耗品） */
  useItem(layer: keyof GameSession['inventories'], row: number, col: number): UseItemResult {
    if (layer === 'allies') return { success: false, message: '无法使用队友背包的物品' };
    const grid = this.session.inventories[layer];
    if (!Array.isArray(grid) || !grid[row] || !grid[row][col]) {
      return { success: false, message: '物品不存在' };
    }
    const slot = grid[row][col]!;
    const config = itemsConfig.items.find(i => i.id === slot.itemId);
    if (!config || config.type !== 'consumable') {
      return { success: false, message: '该物品无法使用' };
    }

    let result: UseItemResult = { success: true };
    if (config.effect?.heal && config.effect.heal < 999) {
      const healed = Math.min(this.session.player.maxHp - this.session.player.hp, config.effect.heal);
      this.session.player.hp += healed;
      result.healAmount = healed;
    } else if (config.effect?.heal && config.effect.heal >= 999) {
      // 医疗包：恢复全部
      const healed = this.session.player.maxHp - this.session.player.hp;
      this.session.player.hp = this.session.player.maxHp;
      result.healAmount = healed;
    }
    if (config.effect?.ammo) {
      result.ammoAmount = config.effect.ammo;
    }

    this.removeItem(layer, slot.itemId, 1);
    return result;
  }

  /** 检查是否有足够空间 */
  hasSpace(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    if (layer === 'allies') return false;
    const grid = this.session.inventories[layer];
    if (!Array.isArray(grid)) return false;
    let emptySlots = 0;
    const maxStack = itemsConfig.items.find(i => i.id === itemId)?.maxStack || 99;
    for (const row of grid) {
      for (const cell of row) {
        if (cell === null) emptySlots++;
        else if (cell.itemId === itemId) {
          emptySlots += maxStack - cell.stackSize;
        }
        if (emptySlots >= count) return true;
      }
    }
    return false;
  }

  /** 获取物品配置 */
  getItemConfig(itemId: string) {
    return itemsConfig.items.find(i => i.id === itemId) ?? null;
  }
}