// ============================================================
// ItemManager.ts —— 物品管理（共享业务逻辑层）
// 无 UI 依赖，只操作 Session 数据。
// ShipMode 和 WorldMode 共用同一个类，各自实例化。
// ============================================================
// 架构：持有 ItemArchetype 缓存（原形层），
// 所有背包操作委托给 Session 工具函数，
// useItem 查原形 → 执行效果 → 扣减。
// ============================================================

import type { GameSession, InventoryGrid } from '../../core/Session';
import { addItemToGrid, removeItemFromGrid, moveItemBetweenGrids } from '../../core/Session';
import { ItemArchetype } from '../../core/ItemArchetype';
import { type ItemEffectContext } from '../../core/ItemEffect';
import { eventBus } from '../../core/EventBus';
import itemsConfig from '../../config/items.json';

export interface UseItemResult {
  success: boolean;
  message?: string;
  healAmount?: number;
  ammoAmount?: number;
}

export class ItemManager {
  private archetypes = new Map<string, ItemArchetype>();

  constructor(private session: GameSession) {
    this.loadArchetypes();
  }

  private loadArchetypes(): void {
    for (const raw of itemsConfig.items) {
      const arch = new ItemArchetype(raw);
      this.archetypes.set(arch.id, arch);
    }
    console.log(`[ItemManager] 已加载 ${this.archetypes.size} 个物品原形`);
  }

  /** 获取原形（供 UI 查询颜色/名称/最大堆叠/世界参数） */
  getArchetype(itemId: string): ItemArchetype | null {
    return this.archetypes.get(itemId) ?? null;
  }

  /** 添加物品到指定网格（自动堆叠） */
  addItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const arch = this.archetypes.get(itemId);
    if (!arch) return false;
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    return addItemToGrid(grid, itemId, count, arch.maxStack);
  }

  /** 从指定网格移除物品 */
  removeItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    return removeItemFromGrid(grid, itemId, count);
  }

  /** 跨层移动物品（原子回滚） */
  moveItem(
    srcLayer: keyof GameSession['inventories'],
    dstLayer: keyof GameSession['inventories'],
    itemId: string,
    count: number,
  ): boolean {
    const arch = this.archetypes.get(itemId);
    if (!arch) return false;
    const src = this.session.inventories[srcLayer] as InventoryGrid;
    const dst = this.session.inventories[dstLayer] as InventoryGrid;
    if (!Array.isArray(src) || !Array.isArray(dst)) return false;
    return moveItemBetweenGrids(src, dst, itemId, count, arch.maxStack);
  }

  /** 使用物品（核心逻辑：查原形 → 执行效果 → 扣减） */
  useItem(layer: keyof GameSession['inventories'], row: number, col: number): UseItemResult {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid) || !grid[row]?.[col]) {
      return { success: false, message: '物品不存在' };
    }

    const slot = grid[row][col]!;
    const arch = this.archetypes.get(slot.itemId);
    if (!arch) return { success: false, message: '未知物品' };
    if (arch.type !== 'consumable') return { success: false, message: '该物品无法使用' };

    const ctx: ItemEffectContext = {
      session: this.session,
      user: null,
      targetLayer: layer,
      row,
      col,
    };

    const result = arch.use(ctx);
    if (result.success) {
      this.removeItem(layer, slot.itemId, 1);
    }
    return result;
  }

  /** 获取网格中所有物品列表（供 UI 渲染） */
  getItems(layer: keyof GameSession['inventories']): { itemId: string; stackSize: number; row: number; col: number }[] {
    const grid = this.session.inventories[layer] as InventoryGrid;
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

  /** 检查是否有足够空间 */
  hasSpace(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const arch = this.archetypes.get(itemId);
    if (!arch) return false;
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    let emptySlots = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell === null) emptySlots++;
        else if (cell.itemId === itemId) {
          emptySlots += arch.maxStack - cell.stackSize;
        }
        if (emptySlots >= count) return true;
      }
    }
    return false;
  }

  /** 获取物品配置（兼容旧接口，底层已改用 archetype） */
  getItemConfig(itemId: string) {
    const arch = this.archetypes.get(itemId);
    if (!arch) return null;
    return {
      id: arch.id,
      name: arch.name,
      type: arch.type,
      description: arch.description,
      maxStack: arch.maxStack,
      color: arch.color,
      deployable: arch.deployable,
    };
  }

  /** 玩家背包中某物品的数量 */
  hasItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    let total = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell && cell.itemId === itemId) total += cell.stackSize;
        if (total >= count) return true;
      }
    }
    return false;
  }

  // ==================== ★ 友军部署（背包页面友军槽位） ====================

  /** 物品是否可部署为友军（items.json deployable 标记） */
  isDeployable(itemId: string): boolean {
    return this.archetypes.get(itemId)?.deployable === true;
  }

  /** 部署：玩家背包移除 1 个可部署友军物品 → 占友军槽位（发事件，世界侧生成） */
  deployAlly(itemId: string): boolean {
    if (!this.isDeployable(itemId)) return false;
    if (!Array.isArray(this.session.deployedAllies)) this.session.deployedAllies = [];
    if (this.session.deployedAllies.length >= ALLY_SLOT_COUNT) return false;
    if (!this.hasItem('player', itemId, 1)) return false;
    if (!this.removeItem('player', itemId, 1)) return false;
    this.session.deployedAllies.push(itemId);
    eventBus.emit('ally_deploy', { itemId });
    return true;
  }

  /** 卸载：友军槽位 → 放回玩家背包（发事件，世界侧回收） */
  undeployAlly(slotIndex: number): boolean {
    const list = this.session.deployedAllies;
    if (!Array.isArray(list)) return false;
    const id = list[slotIndex];
    if (!id) return false;
    list.splice(slotIndex, 1);
    this.addItem('player', id, 1);
    eventBus.emit('ally_undeploy', { itemId: id, slotIndex });
    return true;
  }

  /** ★ 友军损毁：槽位原位替换为残骸（不返还背包；维修配方在舰船加工台修回） */
  replaceAlly(slotIndex: number, itemId: string): boolean {
    const list = this.session.deployedAllies;
    if (!Array.isArray(list) || slotIndex < 0 || slotIndex >= list.length) return false;
    list[slotIndex] = itemId;
    return true;
  }

  /** 已部署友军列表（按槽位序） */
  getDeployedAllies(): string[] {
    return Array.isArray(this.session.deployedAllies) ? this.session.deployedAllies : [];
  }
}

/** ★ 友军槽位数（背包页面额外绘制；用户定调） */
export const ALLY_SLOT_COUNT = 4;