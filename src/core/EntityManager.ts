import * as THREE from 'three';
import { Entity } from './Entity';

/**
 * 实体管理器 - 管理所有实体的生命周期
 * 采用单例模式，提供统一的实体管理接口
 */
export class EntityManager {
  private renderer: THREE.WebGLRenderer | null = null;
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
   * 获取场景引用
   */
  public getScene(): THREE.Scene | null {
    return this.scene;
  }

  /**
   * 设置渲染器引用（用于创建流体实体）
   */
  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /**
   * 获取渲染器引用
   */
  public getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  /**
   * 创建多个小型液滴实体
   * @param count 液滴数量
   * @param centerPos 中心位置
   * @param spreadRadius 扩散半径
   * @param initialVelocity 初始速度
   * @param waterVolume 水量占比（0~1），用于计算显示大小
   */
  public async createDroplets(
    count: number,
    centerPos: THREE.Vector3,
    spreadRadius: number = 1,
    initialVelocity?: THREE.Vector3,
    waterVolume: number = 0.45
  ): Promise<Entity[]> {
    if (!this.renderer) {
      console.error('Renderer not set! Call setRenderer() first.');
      return [];
    }

    console.log(`[EntityManager] 开始创建 ${count} 个液滴`);
    console.log(`  - 中心位置: (${centerPos.x.toFixed(2)}, ${centerPos.y.toFixed(2)}, ${centerPos.z.toFixed(2)})`);
    console.log(`  - 扩散半径: ${spreadRadius}`);
    console.log(`  - 初始速度: ${initialVelocity ? `(${initialVelocity.x.toFixed(2)}, ${initialVelocity.y.toFixed(2)})` : '无'}`);
    console.log(`  - 水量占比: ${(waterVolume * 100).toFixed(1)}%`);

    const droplets: Entity[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spreadRadius;
      const offsetX = Math.cos(angle) * dist;
      const offsetY = Math.sin(angle) * dist;

      const pos = new THREE.Vector3(
        centerPos.x + offsetX,
        centerPos.y + offsetY,
        centerPos.z
      );

      const vel = initialVelocity?.clone() ?? new THREE.Vector3();
      vel.x += (Math.random() - 0.5) * 2;
      vel.y += (Math.random() - 0.5) * 2;

      // 每个液滴可以有轻微的水量差异
      const dropletVolume = waterVolume * (0.8 + Math.random() * 0.4);
      const droplet = await this.createDroplet(`droplet_${Date.now()}_${i}`, pos, vel, dropletVolume);
      if (droplet) {
        droplets.push(droplet);
      }
    }

    console.log(`[EntityManager] 液滴创建完成，共创建 ${droplets.length} 个`);
    return droplets;
  }

  /**
   * 创建单个液滴实体
   * @param id 实体ID
   * @param position 位置
   * @param velocity 速度
   * @param waterVolume 水量占比（0~1），用于计算显示大小
   * @param maxAge 最大生命周期（秒）
   */
  public async createDroplet(
    id: string,
    position: THREE.Vector3,
    velocity?: THREE.Vector3,
    waterVolume: number = 0.45,
    maxAge: number = 5
  ): Promise<Entity | null> {
    if (!this.renderer) {
      console.error('Renderer not set! Call setRenderer() first.');
      return null;
    }

    const { LightFluidEntity } = await import('@entities/fluid');
    const droplet = new LightFluidEntity(id, this.renderer, position, velocity, waterVolume, maxAge);
    this.addEntity(droplet);
    return droplet;
  }

  /**
   * 获取所有液滴实体
   */
  public getDroplets(): Entity[] {
    return this.getEntitiesByType('lightFluid');
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