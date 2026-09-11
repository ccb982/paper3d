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
import { addItemToGrid, removeItemFromGrid, moveItemBetweenGrids, swapGridCells, findItemInGrid, findEmptySlot, SLOT_COUNT, SLOT_ROWS, SLOT_COLS } from '../../core/Session';
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
  }

  /** 获取原形（供 UI 查询颜色/名称/最大堆叠/世界参数） */
  getArchetype(itemId: string): ItemArchetype | null {
    return this.archetypes.get(itemId) ?? null;
  }

  /** 添加物品到指定网格（★ 同层合并：一格一类，数量无上限） */
  addItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    return addItemToGrid(grid, itemId, count);
  }

  /** 从指定网格移除物品 */
  removeItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    return removeItemFromGrid(grid, itemId, count);
  }

  /** 跨层移动物品（原子回滚；目标自动合并） */
  moveItem(
    srcLayer: keyof GameSession['inventories'],
    dstLayer: keyof GameSession['inventories'],
    itemId: string,
    count: number,
  ): boolean {
    const src = this.session.inventories[srcLayer] as InventoryGrid;
    const dst = this.session.inventories[dstLayer] as InventoryGrid;
    if (!Array.isArray(src) || !Array.isArray(dst)) return false;
    return moveItemBetweenGrids(src, dst, itemId, count);
  }

  /** ★ 网格内自由整理：交换两格（空 = 移动；同类 = 合并）——返回是否有变更 */
  swapCells(
    layer: keyof GameSession['inventories'],
    r1: number, c1: number, r2: number, c2: number,
  ): boolean {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    return swapGridCells(grid, r1, c1, r2, c2);
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
    // ★ 可使用类型：消耗品 / 弹药（入弹药池）/ 装备（穿戴到装备位）
    if (arch.type !== 'consumable' && arch.type !== 'ammo' && arch.type !== 'equip') {
      return { success: false, message: '该物品无法使用' };
    }

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

  /** 检查是否有足够空间（★ 同层合并语义：已有一格同类 → 恒可入；否则需空格） */
  hasSpace(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    if (count <= 0) return true;
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return false;
    if (findItemInGrid(grid, itemId)) return true;
    return findEmptySlot(grid) !== null;
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

  /** 指定背包层中某物品的数量（★ 唯一单层计数入口） */
  countItem(layer: keyof GameSession['inventories'], itemId: string): number {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return 0;
    let total = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell && cell.itemId === itemId) total += cell.stackSize;
      }
    }
    return total;
  }

  /** 所有背包层（基地+飞船+玩家）的总数（★ 加工台等跨层场景用） */
  countTotal(itemId: string): number {
    let total = 0;
    for (const layer of Object.keys(this.session.inventories) as (keyof GameSession['inventories'])[]) {
      total += this.countItem(layer, itemId);
    }
    return total;
  }

  /** 指定层某物品是否满足数量 */
  hasItem(layer: keyof GameSession['inventories'], itemId: string, count: number): boolean {
    if (count <= 0) return true;
    return this.countItem(layer, itemId) >= count;
  }

  // ==================== ★ 出击槽池（12 格通用混用池：友军/装备任意混放） ====================

  /** 物品是否可部署为友军（items.json deployable 标记） */
  isDeployable(itemId: string): boolean {
    return this.archetypes.get(itemId)?.deployable === true;
  }

  /** 物品是否为可装备（items.json type === 'equip'） */
  isEquip(itemId: string): boolean {
    return this.archetypes.get(itemId)?.type === 'equip';
  }

  /** 物品所属装备位（weapon/armor/headgear；非装备类返回 null；仅信息展示/贴片锚点用） */
  equipSlotOf(itemId: string): string | null {
    return this.archetypes.get(itemId)?.equipSlot ?? null;
  }

  /** 出击槽池（12 格；(string|null)[]，null = 空槽） */
  getSlots(): (string | null)[] {
    return Array.isArray(this.session.player.slots) ? this.session.player.slots : [];
  }

  /** ★ 拖入槽池：源格子物品 → 放入指定空槽（一格一个物品，违规/占位拒绝）。发事件由世界侧生成/同步 */
  putIntoSlot(slotIndex: number, layer: keyof GameSession['inventories'], row: number, col: number): UseItemResult {
    const slots = this.session.player.slots;
    if (!Array.isArray(slots)) return { success: false, message: '出击槽池未初始化' };
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return { success: false, message: '槽位越界' };
    if (slots[slotIndex]) return { success: false, message: '该槽位已占用' };
    const grid = this.session.inventories[layer] as InventoryGrid;
    const slot = grid?.[row]?.[col];
    if (!slot) return { success: false, message: '物品不存在' };
    const arch = this.archetypes.get(slot.itemId);
    if (!arch) return { success: false, message: '未知物品' };
    if (!arch.deployable && arch.type !== 'equip') return { success: false, message: '该物品不能放入出击槽' };
    slots[slotIndex] = slot.itemId;
    this.removeItem(layer, slot.itemId, 1);
    eventBus.emit('deployment_changed', { slotIndex, itemId: slot.itemId, prev: null });
    return { success: true, message: `已放入出击槽 ${slotIndex + 1}` };
  }

  /** ★ 拖出槽池：槽内物品 → 放回玩家背包（失败 = 背包无空位，保持槽内不放回，防丢件） */
  removeFromSlot(slotIndex: number): boolean {
    const slots = this.session.player.slots;
    if (!Array.isArray(slots)) return false;
    const itemId = slots[slotIndex];
    if (!itemId) return false;
    if (!this.hasSpace('player', itemId, 1)) return false;
    slots[slotIndex] = null;
    this.addItem('player', itemId, 1);
    eventBus.emit('deployment_changed', { slotIndex, itemId: null, prev: itemId });
    return true;
  }

  /** ★ 背包物品 ⇄ 已占用出击槽 互换：新物品入槽、旧槽物品回背包。
   *  ★ 换出物品走 addItemToGrid 自动归类（并入同类堆；无同类才占空格）；
   *  源格堆叠 >1 且无同类堆、无空格 → 拒绝（防丢件）。空槽 = 走 putIntoSlot。 */
  swapIntoSlot(slotIndex: number, layer: keyof GameSession['inventories'], row: number, col: number): UseItemResult {
    const slots = this.session.player.slots;
    if (!Array.isArray(slots)) return { success: false, message: '出击槽池未初始化' };
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return { success: false, message: '槽位越界' };
    const prev = slots[slotIndex];
    if (!prev) return this.putIntoSlot(slotIndex, layer, row, col);
    const grid = this.session.inventories[layer] as InventoryGrid;
    const cell = grid?.[row]?.[col];
    if (!cell) return { success: false, message: '物品不存在' };
    const arch = this.archetypes.get(cell.itemId);
    if (!arch) return { success: false, message: '未知物品' };
    if (!arch.deployable && arch.type !== 'equip') return { success: false, message: '该物品不能放入出击槽' };
    // ★ 预检：换出物品能否回背包（有同类堆必可；否则需要空格——源格会空出也算）
    const willFreeCell = cell.stackSize <= 1;
    if (!findItemInGrid(grid, prev) && !willFreeCell && !findEmptySlot(grid)) {
      return { success: false, message: '背包无空位放下换出的物品' };
    }
    const newId = cell.itemId;
    if (willFreeCell) {
      grid[row][col] = null; // 先腾出源格
      slots[slotIndex] = newId;
      addItemToGrid(grid, prev, 1); // ★ 自动归类：并入同类堆，否则落空格（含刚腾出的源格）
    } else {
      slots[slotIndex] = newId;
      cell.stackSize -= 1;
      addItemToGrid(grid, prev, 1); // ★ 自动归类
    }
    eventBus.emit('deployment_changed', { slotIndex, itemId: newId, prev });
    return { success: true, message: `已与槽位 ${slotIndex + 1} 互换` };
  }

  /** ★ 槽位原位替换（友军损毁 → 残骸占槽，不清除槽位；发事件通知回收旧实体） */
  replaceSlot(slotIndex: number, itemId: string): boolean {
    const slots = this.session.player.slots;
    if (!Array.isArray(slots) || slotIndex < 0 || slotIndex >= slots.length) return false;
    const prev = slots[slotIndex];
    slots[slotIndex] = itemId;
    eventBus.emit('deployment_changed', { slotIndex, itemId, prev });
    return true;
  }

  /** ★ 槽位间移动/交换：目标空 = 移动，目标占用 = 互换。逐槽发事件（世界侧按槽 idempotent 同步） */
  swapSlots(from: number, to: number): UseItemResult {
    const slots = this.session.player.slots;
    if (!Array.isArray(slots)) return { success: false, message: '出击槽池未初始化' };
    if (from < 0 || from >= SLOT_COUNT || to < 0 || to >= SLOT_COUNT) return { success: false, message: '槽位越界' };
    if (from === to) return { success: false, message: '相同槽位' };
    const itemFrom = slots[from];
    if (!itemFrom) return { success: false, message: '源槽为空' };
    const itemTo = slots[to];
    slots[from] = itemTo;
    slots[to] = itemFrom;
    eventBus.emit('deployment_changed', { slotIndex: from, itemId: itemTo, prev: itemFrom });
    // ★ 无论目标是否空槽都发第二条：目标空 = 移动需在新槽重生；起收事件定位在源槽、落点在目标槽
    eventBus.emit('deployment_changed', { slotIndex: to, itemId: itemFrom, prev: itemTo });
    return { success: true, message: itemTo ? `已互换槽位 ${from + 1} ↔ ${to + 1}` : `已移到槽位 ${to + 1}` };
  }

  /** ★ 按 itemId 使用一个（找该层第一堆 → 走 useItem；快捷栏 QF 消耗品用） */
  useItemId(layer: keyof GameSession['inventories'], itemId: string): UseItemResult {
    const grid = this.session.inventories[layer] as InventoryGrid;
    if (!Array.isArray(grid)) return { success: false, message: '背包未初始化' };
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
        if (grid[r][c]?.itemId === itemId) return this.useItem(layer, r, c);
      }
    }
    return { success: false, message: '背包中没有该物品' };
  }

  /** ★ 局内装备临时属性：遍历出击槽累加各装备 stats（卸载/换装即自动消失，与遗物永久加成区分） */
  getEquipmentStats(): { maxHp: number; attackPower: number; defense: number } {
    const out = { maxHp: 0, attackPower: 0, defense: 0 };
    const slots = this.session.player.slots;
    if (!Array.isArray(slots)) return out;
    for (const id of slots) {
      if (!id) continue;
      const s = this.archetypes.get(id)?.stats;
      if (!s) continue;
      out.maxHp += s.maxHp ?? 0;
      out.attackPower += s.attackPower ?? 0;
      out.defense += s.defense ?? 0;
    }
    return out;
  }
}

/** ★ 出击槽池规格（背包页面绘制 2 行 × 6 列；装具/友军混用池容积） */
export { SLOT_COUNT, SLOT_ROWS, SLOT_COLS };