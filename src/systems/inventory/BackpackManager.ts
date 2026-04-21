import { InventorySystem } from './InventorySystem';
import { Item, ItemFactory, ItemType, ItemRarity } from '../../entities/items/ItemData';

/**
 * 背包管理器
 * 管理玩家的背包实例
 */
export class BackpackManager {
  private static instance: BackpackManager;
  private inventory: InventorySystem;

  private constructor() {
    // 创建玩家背包，5x8格
    this.inventory = new InventorySystem(5, 8);
    // 添加一些测试物品
    this.addTestItems();
  }

  public static getInstance(): BackpackManager {
    if (!BackpackManager.instance) {
      BackpackManager.instance = new BackpackManager();
    }
    return BackpackManager.instance;
  }

  public getInventory(): InventorySystem {
    return this.inventory;
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

    const shield = ItemFactory.createItem({
      name: '盾牌',
      type: ItemType.ARMOR,
      description: '提供防御的盾牌',
      icon: '/textures/items/shield.png',
      quantity: 1,
      maxStack: 1,
      rarity: ItemRarity.UNCOMMON,
      size: { width: 2, height: 2 },
      properties: {
        defense: 15,
        durability: 80
      }
    });

    const staff = ItemFactory.createItem({
      name: '法杖',
      type: ItemType.WEAPON,
      description: '魔法攻击武器',
      icon: '/textures/items/staff.png',
      quantity: 1,
      maxStack: 1,
      rarity: ItemRarity.RARE,
      size: { width: 1, height: 3 },
      properties: {
        magicDamage: 25,
        durability: 70
      }
    });

    const bow = ItemFactory.createItem({
      name: '弓箭',
      type: ItemType.WEAPON,
      description: '远程攻击武器',
      icon: '/textures/items/bow.png',
      quantity: 1,
      maxStack: 1,
      rarity: ItemRarity.UNCOMMON,
      size: { width: 2, height: 1 },
      properties: {
        damage: 15,
        range: 50,
        durability: 90
      }
    });

    // 将物品添加到背包
    this.inventory.addItem(healthPotion, 0, 0);
    this.inventory.addItem(manaPotion, 1, 0);
    this.inventory.addItem(sword, 0, 1);
    this.inventory.addItem(shield, 2, 0);
    this.inventory.addItem(staff, 0, 3);
    this.inventory.addItem(bow, 2, 2);
  }
}

// 导出单例实例
export const backpackManager = BackpackManager.getInstance();