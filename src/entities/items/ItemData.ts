// 物品类型
export class Item {
  constructor(
    public id: string,
    public name: string,
    public type: string,
    public description: string,
    public icon: string,
    public quantity: number,
    public maxStack: number,
    public rarity: string,
    public size: { width: number; height: number },
    public properties?: Record<string, any>,
    public effects?: ItemEffect[]
  ) {}
}

// 物品效果类型
export class ItemEffect {
  constructor(
    public type: string,
    public value: number,
    public duration?: number,
    public description: string
  ) {}
}

// 物品类型枚举
export const ItemType = {
  CONSUMABLE: 'consumable',
  WEAPON: 'weapon',
  ARMOR: 'armor',
  MATERIAL: 'material',
  OTHER: 'other'
};

// 物品品质枚举
export const ItemRarity = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary'
};

// 物品工厂类
export class ItemFactory {
  static createItem(itemData: any): Item {
    return new Item(
      itemData.id || `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      itemData.name || '未命名物品',
      itemData.type || ItemType.OTHER,
      itemData.description || '暂无描述',
      itemData.icon || '/textures/items/default.png',
      itemData.quantity || 1,
      itemData.maxStack || 99,
      itemData.rarity || ItemRarity.COMMON,
      itemData.size || { width: 1, height: 1 },
      itemData.properties || {},
      itemData.effects || []
    );
  }
}
