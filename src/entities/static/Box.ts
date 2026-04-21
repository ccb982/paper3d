import { StaticEntity } from './StaticEntity';
import { Item, ItemFactory, ItemType, ItemRarity } from '../items/ItemData';
import { InventorySystem } from '../../systems/inventory/InventorySystem';
import * as THREE from 'three';

/**
 * 箱子类，继承自StaticEntity
 */
export class Box extends StaticEntity {
  private inventory: InventorySystem;
  private isOpened: boolean = false;

  /**
   * 创建一个箱子实例
   * @param id 箱子ID
   * @param position 箱子位置
   * @param size 箱子尺寸
   */
  constructor(id: string, position: THREE.Vector3, size: THREE.Vector3 = new THREE.Vector3(1, 1, 1)) {
    // 创建箱子的几何体
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);

    // 创建箱子的材质
    const material = new THREE.MeshPhongMaterial({
      color: 0x8B4513, // 棕色
      shininess: 30,
      specular: 0x111111
    });

    // 创建箱子的网格
    const mesh = new THREE.Mesh(geometry, material);

    // 调用父类构造函数
    super(id, mesh, position);

    // 设置箱子的碰撞半径
    this.radius = Math.max(size.x, size.y, size.z) / 2;

    // 增加箱子的生命值
    this.health = 50;
    this.maxHealth = 50;

    // 添加箱子特定的属性到userData
    mesh.userData = {
      ...mesh.userData,
      boxId: id,
      isBox: true
    };

    // 创建箱子的物品栏（4x3格）
    this.inventory = new InventorySystem(4, 3);
    
    // 随机生成物品
    this.generateRandomItems();
  }

  private generateRandomItems(): void {
    const itemTemplates = [
      { name: '治疗药水', type: ItemType.CONSUMABLE, rarity: ItemRarity.COMMON, size: { width: 1, height: 1 } },
      { name: '法力药水', type: ItemType.CONSUMABLE, rarity: ItemRarity.COMMON, size: { width: 1, height: 1 } },
      { name: '铁剑', type: ItemType.WEAPON, rarity: ItemRarity.UNCOMMON, size: { width: 2, height: 1 } },
      { name: '盾牌', type: ItemType.ARMOR, rarity: ItemRarity.UNCOMMON, size: { width: 2, height: 2 } },
      { name: '铁矿石', type: ItemType.MATERIAL, rarity: ItemRarity.COMMON, size: { width: 1, height: 1 } },
      { name: '魔法水晶', type: ItemType.MATERIAL, rarity: ItemRarity.RARE, size: { width: 1, height: 1 } },
      { name: '生命戒指', type: ItemType.ARMOR, rarity: ItemRarity.RARE, size: { width: 1, height: 1 } },
      { name: '金币袋', type: ItemType.OTHER, rarity: ItemRarity.COMMON, size: { width: 1, height: 1 } },
    ];

    const itemCount = Math.floor(Math.random() * 4) + 2;
    console.log(`[Box ${this.id}] 正在生成 ${itemCount} 个物品...`);

    for (let i = 0; i < itemCount; i++) {
      const template = itemTemplates[Math.floor(Math.random() * itemTemplates.length)];
      const item = ItemFactory.createItem({
        ...template,
        id: `${this.id}-item-${i}`,
        quantity: template.type === ItemType.CONSUMABLE ? Math.floor(Math.random() * 5) + 1 : 1
      });
      
      console.log(`[Box ${this.id}] 创建物品: ${item.name}, 尺寸: ${item.size.width}x${item.size.height}`);
      
      // 尝试放置物品到随机位置
      let placed = false;
      for (let y = 0; y < 3 && !placed; y++) {
        for (let x = 0; x < 4 && !placed; x++) {
          if (this.inventory.addItem(item, x, y)) {
            placed = true;
            console.log(`[Box ${this.id}] 物品 ${item.name} 放置成功 at (${x}, ${y})`);
          }
        }
      }
      if (!placed) {
        console.log(`[Box ${this.id}] 物品 ${item.name} 放置失败！`);
      }
    }
    
    console.log(`[Box ${this.id}] 物品生成完成，inventory 格子数: ${this.inventory.getSlots().length}`);
  }

  public getInventory(): InventorySystem {
    return this.inventory;
  }

  public isBoxOpened(): boolean {
    return this.isOpened;
  }

  public open(): void {
    this.isOpened = true;
  }

  public close(): void {
    this.isOpened = false;
  }

  public initializeItems(): void {
    this.inventory.clear();
    this.generateRandomItems();
  }
  
  /**
   * 命中时调用
   */
  protected onHit(): void {
    // 当箱子被击中时，稍微改变颜色
    if (this.mesh instanceof THREE.Mesh) {
      const material = this.mesh.material as THREE.MeshPhongMaterial;
      if (material) {
        // 暂时将颜色变为稍亮的棕色
        material.color.setHex(0xA0522D);
        
        // 一段时间后恢复原来的颜色
        setTimeout(() => {
          material.color.setHex(0x8B4513);
        }, 200);
      }
    }
  }
  
  /**
   * 销毁时调用
   */
  public onDestroy(): void {
    // 箱子被销毁时的逻辑
    console.log(`箱子 ${this.id} 被销毁了`);
    
    // 调用父类的销毁方法
    super.onDestroy();
  }
}