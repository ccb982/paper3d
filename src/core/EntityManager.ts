import * as THREE from 'three';
import { Entity } from './Entity';

/**
 * 实体管理器 - 管理所有实体的生命周期
 * 采用单例模式，提供统一的实体管理接口
 */
export class EntityManager {
  private static instance: EntityManager;

  private entities: Map<string, Entity> = new Map();
  private scene: THREE.Scene | null = null;

  private constructor() {}

  public static getInstance(): EntityManager {
    if (!EntityManager.instance) {
      EntityManager.instance = new EntityManager();
    }
    return EntityManager.instance;
  }

  /**
   * 设置场景引用（用于自动添加/移除网格）
   */
  public setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * 添加实体到管理器
   * @param entity 要添加的实体
   */
  public addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    // 对于友好实体（玩家），不自动添加mesh到场景，避免与PaperCharacter组件重复渲染
    // 对于其他实体（敌人、子弹、靶子等），正常添加mesh到场景
    const isFriendlyEntity = entity.type === 'character' && (entity as any).faction === 'friendly';
    if (this.scene && entity.mesh && !isFriendlyEntity) {
      this.scene.add(entity.mesh);
    }
    console.log(`Entity added: ${entity.type} - ${entity.id}`);
  }

  /**
   * 从管理器移除实体
   * @param entity 要移除的实体
   */
  public removeEntity(entity: Entity): void {
    this.removeEntityById(entity.id);
  }

  /**
   * 通过ID移除实体
   * @param entityId 实体的唯一ID
   */
  public removeEntityById(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (entity) {
      entity.onDestroy();
      if (this.scene && entity.mesh) {
        this.scene.remove(entity.mesh);
      }
      this.entities.delete(entityId);
      console.log(`Entity removed: ${entity.type} - ${entityId}`);
    }
  }

  /**
   * 通过ID获取实体
   * @param entityId 实体的唯一ID
   */
  public getEntityById(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  /**
   * 获取所有实体
   */
  public getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * 获取指定类型的所有实体
   * @param type 实体类型（如 'bullet', 'enemy', 'player'）
   */
  public getEntitiesByType(type: string): Entity[] {
    return Array.from(this.entities.values()).filter(entity => entity.type === type);
  }

  /**
   * 获取所有敌人实体
   */
  public getEnemies(): Entity[] {
    return this.getEntitiesByType('enemy');
  }

  /**
   * 获取所有子弹实体
   */
  public getBullets(): Entity[] {
    return this.getEntitiesByType('bullet');
  }

  /**
   * 更新所有实体（每帧调用）
   * @param delta 时间差（秒）
   */
  public update(delta: number): void {
    const toRemove: string[] = [];

    for (const entity of this.entities.values()) {
      if (entity.isActive) {
        entity.update(delta);
      }
      if (!entity.isActive) {
        toRemove.push(entity.id);
      }
    }

    for (const id of toRemove) {
      this.removeEntityById(id);
    }
  }

  /**
   * 清空所有实体
   */
  public clear(): void {
    for (const entity of this.entities.values()) {
      entity.onDestroy();
      if (this.scene && entity.mesh) {
        this.scene.remove(entity.mesh);
      }
    }
    this.entities.clear();
    console.log('EntityManager cleared');
  }

  /**
   * 获取实体数量
   */
  public getEntityCount(): number {
    return this.entities.size;
  }
}