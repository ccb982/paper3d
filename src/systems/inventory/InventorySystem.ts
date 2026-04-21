import { Item, ItemFactory, ItemType, ItemRarity } from '../../entities/items/Item';

export interface InventorySlot {
  item: Item | null;
  x: number;
  y: number;
}

export class InventorySystem {
  private static instance: InventorySystem;
  private items: Map<string, Item> = new Map();
  private slots: InventorySlot[] = [];
  private width: number = 5;
  private height: number = 8;
  private listeners: Array<() => void> = [];

  private constructor() {
    // 初始化背包格子
    this.initSlots();
    // 添加一些测试物品
    this.addTestItems();
  }

  public static getInstance(): InventorySystem {
    if (!InventorySystem.instance) {
      InventorySystem.instance = new InventorySystem();
    }
    return InventorySystem.instance;
  }

  private initSlots() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.slots.push({
          item: null,
          x,
          y
        });
      }
    }
  }

  private addTestItems() {
    // 添加一些测试物品
    const healthPotion = ItemFactory.createItem({
      name: '治疗药水',
      type: ItemType.CONSUMABLE,
      description: '恢复100点生命值',
      icon: '/textures/items/health-potion.png',
      quantity: 5,
      maxStack: 20,
      rarity: ItemRarity.COMMON,
      effects: [{
        type: 'heal',
        value: 100,
        description: '恢复100点生命值'
      }]
    });

    const manaPotion = ItemFactory.createItem({
      name: '法力药水',
      type: ItemType.CONSUMABLE,
      description: '恢复100点法力值',
      icon: '/textures/items/mana-potion.png',
      quantity: 3,
      maxStack: 20,
      rarity: ItemRarity.COMMON,
      effects: [{
        type: 'mana',
        value: 100,
        description: '恢复100点法力值'
      }]
    });

    const sword = ItemFactory.createItem({
      name: '铁剑',
      type: ItemType.WEAPON,
      description: '一把普通的铁剑',
      icon: '/textures/items/iron-sword.png',
      quantity: 1,
      maxStack: 1,
      rarity: ItemRarity.UNCOMMON,
      size: { width: 2, height: 1 },
      properties: {
        damage: 20,
        durability: 100
      }
    });

    // 将物品添加到背包
    this.addItem(healthPotion, 0, 0);
    this.addItem(manaPotion, 1, 0);
    this.addItem(sword, 0, 1);
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
      }
    }

    // 从物品映射中移除
    this.items.delete(itemId);

    // 通知监听器
    this.notifyListeners();
    return true;
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
