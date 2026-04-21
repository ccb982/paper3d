import { Item, ItemFactory, ItemType, ItemRarity } from '../../entities/items/ItemData';

export interface InventorySlot {
  item: Item | null;
  itemId: string | null; // 物品ID，用于标记格子属于什么物品
  x: number;
  y: number;
}

export class InventorySystem {
  private items: Map<string, Item> = new Map();
  private slots: InventorySlot[] = [];
  private width: number = 5;
  private height: number = 8;
  private listeners: Array<() => void> = [];

  constructor(width: number = 5, height: number = 8) {
    this.width = width;
    this.height = height;
    // 初始化背包格子
    this.initSlots();
  }

  // 移除单例模式
  // 现在可以创建多个实例

  private initSlots() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.slots.push({
          item: null,
          itemId: null,
          x,
          y
        });
      }
    }
  }

  /**
   * 添加物品到背包
   */
  public addItem(item: Item, x: number, y: number): boolean {
    // 检查位置是否有效
    if (!this.isValidPosition(x, y, item.size.width, item.size.height)) {
      return false;
    }

    // 检查位置是否为空
    if (!this.isPositionEmpty(x, y, item.size.width, item.size.height)) {
      return false;
    }

    // 添加物品到物品映射
    this.items.set(item.id, item);

    // 更新格子
    for (let dy = 0; dy < item.size.height; dy++) {
      for (let dx = 0; dx < item.size.width; dx++) {
        const slotIndex = this.getSlotIndex(x + dx, y + dy);
        if (slotIndex !== -1) {
          this.slots[slotIndex].item = item;
          this.slots[slotIndex].itemId = item.id;
        }
      }
    }

    // 通知监听器
    this.notifyListeners();
    return true;
  }

  /**
   * 从背包中移除物品
   */
  public removeItem(itemId: string): boolean {
    if (!this.items.has(itemId)) {
      return false;
    }

    const item = this.items.get(itemId);
    if (!item) {
      return false;
    }

    // 清空占用的格子
    for (const slot of this.slots) {
      if (slot.item && slot.item.id === itemId) {
        slot.item = null;
        slot.itemId = null;
      }
    }

    // 从物品映射中移除
    this.items.delete(itemId);

    // 通知监听器
    this.notifyListeners();
    return true;
  }

  /**
   * 从指定位置移除物品
   */
  public removeItemAt(x: number, y: number): boolean {
    const slotIndex = this.getSlotIndex(x, y);
    if (slotIndex === -1) {
      return false;
    }

    const slot = this.slots[slotIndex];
    if (!slot.item) {
      return false;
    }

    const itemId = slot.item.id;
    return this.removeItem(itemId);
  }

  /**
   * 获取背包中的所有物品
   */
  public getItems(): Item[] {
    return Array.from(this.items.values());
  }

  /**
   * 获取背包格子
   */
  public getSlots(): InventorySlot[] {
    return this.slots;
  }

  /**
   * 获取背包尺寸
   */
  public getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * 检查位置是否有效
   */
  private isValidPosition(x: number, y: number, width: number, height: number): boolean {
    return x >= 0 && y >= 0 && x + width <= this.width && y + height <= this.height;
  }

  /**
   * 检查位置是否为空
   */
  private isPositionEmpty(x: number, y: number, width: number, height: number): boolean {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const slotIndex = this.getSlotIndex(x + dx, y + dy);
        if (slotIndex === -1 || this.slots[slotIndex].item !== null) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 获取格子索引
   */
  private getSlotIndex(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }
    return y * this.width + x;
  }

  /**
   * 添加监听器
   */
  public addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  public removeListener(listener: () => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
