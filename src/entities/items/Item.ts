// 物品类型
export class Item {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: string;
  quantity: number;
  maxStack: number;
  rarity: string;
  size: { width: number; height: number };
  properties?: Record<string, any>;
  effects?: ItemEffect[];

  constructor(itemData: Partial<Item>) {
    this.id = itemData.id || `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.name = itemData.name || '未命名物品';
    this.type = itemData.type || ItemType.OTHER;
    this.description = itemData.description || '暂无描述';
    this.icon = itemData.icon || '/textures/items/default.png';
    this.quantity = itemData.quantity || 1;
    this.maxStack = itemData.maxStack || 99;
    this.rarity = itemData.rarity || ItemRarity.COMMON;
    this.size = itemData.size || { width: 1, height: 1 };
    this.properties = itemData.properties || {};
    this.effects = itemData.effects || [];
  }
}

// 物品类型枚举
export const ItemType = {
  CONSUMABLE: 'consumable',
  WEAPON: 'weapon',
  ARMOR: 'armor',
  MATERIAL: 'material',
  OTHER: 'other'
} as const;

// 物品品质枚举
export const ItemRarity = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary'
} as const;

// 物品效果类型
export class ItemEffect {
  type: string;
  value: number;
  duration?: number;
  description: string;

  constructor(effectData: Partial<ItemEffect>) {
    this.type = effectData.type || '';
    this.value = effectData.value || 0;
    this.duration = effectData.duration;
    this.description = effectData.description || '';
  }
}

// 物品工厂类
export class ItemFactory {
  static createItem(itemData: Partial<Item>): Item {
    return new Item(itemData);
  }
}
