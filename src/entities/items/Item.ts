export interface Item {
  /** 物品唯一标识符 */
  id: string;
  /** 物品名称 */
  name: string;
  /** 物品类型 */
  type: ItemType;
  /** 物品描述 */
  description: string;
  /** 物品图标路径 */
  icon: string;
  /** 物品数量 */
  quantity: number;
  /** 物品最大堆叠数量 */
  maxStack: number;
  /** 物品品质 */
  rarity: ItemRarity;
  /** 物品尺寸（占据的格子大小） */
  size: {
    width: number;
    height: number;
  };
  /** 物品属性（可选） */
  properties?: Record<string, any>;
  /** 物品效果（可选） */
  effects?: ItemEffect[];
}

export enum ItemType {
  /** 消耗品 */
  CONSUMABLE = 'consumable',
  /** 武器 */
  WEAPON = 'weapon',
  /** 防具 */
  ARMOR = 'armor',
  /** 材料 */
  MATERIAL = 'material',
  /** 其他 */
  OTHER = 'other'
}

export enum ItemRarity {
  /** 普通 */
  COMMON = 'common',
  /** 优秀 */
  UNCOMMON = 'uncommon',
  /** 稀有 */
  RARE = 'rare',
  /** 史诗 */
  EPIC = 'epic',
  /** 传说 */
  LEGENDARY = 'legendary'
}

export interface ItemEffect {
  /** 效果类型 */
  type: string;
  /** 效果值 */
  value: number;
  /** 效果持续时间（秒，可选） */
  duration?: number;
  /** 效果描述 */
  description: string;
}

export class ItemFactory {
  /**
   * 创建物品实例
   */
  static createItem(itemData: Partial<Item>): Item {
    return {
      id: itemData.id || `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: itemData.name || '未命名物品',
      type: itemData.type || ItemType.OTHER,
      description: itemData.description || '暂无描述',
      icon: itemData.icon || '/textures/items/default.png',
      quantity: itemData.quantity || 1,
      maxStack: itemData.maxStack || 99,
      rarity: itemData.rarity || ItemRarity.COMMON,
      size: itemData.size || { width: 1, height: 1 },
      properties: itemData.properties || {},
      effects: itemData.effects || []
    };
  }
}
