import * as THREE from 'three';
import { Entity } from './Entity';
import { FluidLOD } from '@entities/fluid';
import { ExplosionManager, DEFAULT_EXPLOSION_PARAMS } from '@lib/explosion-processor';
import type { ExplosionParams } from '@lib/explosion-processor';
import type { IFluidForceTarget } from '@entities/fluid';
// 延迟导入 FluidRegionManager 类本身（仍需动态导入避免循环）
let FluidRegionManager: typeof import('@entities/fluid').FluidRegionManager;

/**
 * 实体管理器 - 管理所有实体的生命周期
 * 采用单例模式，提供统一的实体管理接口
 */
export class EntityManager {
  private renderer: THREE.WebGLRenderer | null = null;
  private static instance: EntityManager;

  private entities: Map<string, Entity> = new Map();
  private scene: THREE.Scene | null = null;
  private pendingEntities: Entity[] = [];  // 场景未设置时暂存的实体
  
  // 流体区域管理器相关
  private fluidRegions: FluidRegionManager[] = [];
  private playerPositionCache: THREE.Vector3 = new THREE.Vector3();

  // 爆炸管理器相关
  private explosionManager: ExplosionManager;

  private constructor() {
    this.explosionManager = new ExplosionManager();
  }

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
    
    // 将暂存的实体添加到场景
    for (const entity of this.pendingEntities) {
      const isFriendlyEntity = entity.type === 'character' && (entity as any).faction === 'friendly';
      if (entity.mesh && !isFriendlyEntity) {
        this.scene.add(entity.mesh);
      }
    }
    this.pendingEntities = [];
  }

  /**
   * 获取场景引用
   */
  public getScene(): THREE.Scene | null {
    return this.scene;
  }

  private hasInitializedFluidRegion = false;  // 防止重复初始化

  /**
   * 设置渲染器引用（用于创建流体实体）
   */
  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    
    // 自动初始化流体区域（包含5个小液滴）- 只初始化一次
    if (!this.hasInitializedFluidRegion) {
      this.hasInitializedFluidRegion = true;
      this.initDefaultFluidRegion();
    }
  }

  /**
   * 初始化默认流体区域（包含5个小液滴）
   */
  private async initDefaultFluidRegion(): Promise<void> {
    if (!this.renderer) return;
    
    // 动态导入 FluidRegionManager 类本身（仍需动态导入避免循环）
    if (!FluidRegionManager) {
      const module = await import('@entities/fluid');
      FluidRegionManager = module.FluidRegionManager;
    }
    
    // 创建流体区域管理器，中心在原点，半径2.0，最多10个液滴
    const center = new THREE.Vector3(0, 0, 0);
    const region = new FluidRegionManager(center, 2.0, 10);
    
    // 添加到管理器
    this.addFluidRegion(region);
    
    // 创建5个小液滴
    await region.createDroplets(5, 1.5);
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
    
    // 如果场景还未设置，先暂存实体
    if (!this.scene) {
      this.pendingEntities.push(entity);
      return;
    }
    
    if (entity.mesh && !isFriendlyEntity) {
      this.scene.add(entity.mesh);
    }
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
      // 从爆炸管理器注销目标
      if (this.isFluidForceTarget(entity)) {
        this.explosionManager.unregisterTarget(entity as unknown as IFluidForceTarget);
      }
      this.entities.delete(entityId);
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

  // ========== 爆炸管理器方法 ==========

  /**
   * 默认世界空间边界（用于UV映射，支持负坐标）
   * 世界坐标范围：[worldMinX, worldMaxX] x [worldMinY, worldMaxY]
   */
  private worldMinX: number = -10.0;
  private worldMaxX: number = 10.0;
  private worldMinY: number = -10.0;
  private worldMaxY: number = 10.0;

  /**
   * 创建爆炸
   * 一次性查询范围内的可影响目标并注册，爆炸结束后自动清理
   * @param id 爆炸唯一ID
   * @param worldPosition 爆炸位置（世界空间）
   * @param maxInfluenceRadius 最大影响半径
   * @param params 爆炸参数（可选）
   */
  public createExplosion(
    id: string,
    worldPosition: THREE.Vector3,
    maxInfluenceRadius: number = 10.0,
    params?: Partial<ExplosionParams>
  ): void {
    console.log(`[EntityManager] 创建爆炸: ${id} at (${worldPosition.x.toFixed(2)}, ${worldPosition.y.toFixed(2)}), radius: ${maxInfluenceRadius}`);

    // 1. 查询范围内所有可被爆炸影响的实体
    const affectedTargets = this.findTargetsInRange(worldPosition, maxInfluenceRadius);
    console.log(`[EntityManager] 找到 ${affectedTargets.length} 个受影响目标`);

    // 2. 设置世界坐标到UV坐标的映射（支持负坐标）
    this.explosionManager.setWorldBounds(
      this.worldMinX, this.worldMaxX,
      this.worldMinY, this.worldMaxY
    );

    // 3. 注册这些目标到爆炸管理器
    affectedTargets.forEach(target => {
      this.explosionManager.registerTarget(target);
    });

    // 4. 创建爆炸
    const explosionParams = { ...DEFAULT_EXPLOSION_PARAMS, ...params };
    this.explosionManager.create(
      id,
      explosionParams,
      worldPosition.x,
      worldPosition.y,
      maxInfluenceRadius
    );
  }

  /**
   * 设置世界空间边界（用于UV坐标映射）
   * @param minX 世界X最小值
   * @param maxX 世界X最大值
   * @param minY 世界Y最小值
   * @param maxY 世界Y最大值
   */
  public setExplosionWorldBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    this.worldMinX = minX;
    this.worldMaxX = maxX;
    this.worldMinY = minY;
    this.worldMaxY = maxY;
    this.explosionManager.setWorldBounds(minX, maxX, minY, maxY);
  }

  /**
   * 查询范围内可被爆炸影响的目标
   * @param center 中心点
   * @param radius 半径
   * @returns 可影响的目标数组
   */
  private findTargetsInRange(center: THREE.Vector3, radius: number): IFluidForceTarget[] {
    const result: IFluidForceTarget[] = [];

    for (const entity of this.entities.values()) {
      // 检查实体是否实现了 IFluidForceTarget 接口
      if (this.isFluidForceTarget(entity)) {
        const target = entity as unknown as IFluidForceTarget;

        try {
          const targetPos = target.getPosition?.();
          if (!targetPos) continue;

          const distance = targetPos.distanceTo(center);
          const boundingRadius = target.getBoundingRadius?.() || 0;

          if (distance - boundingRadius <= radius) {
            result.push(target);
          }
        } catch (e) {
          console.warn('Error checking target distance:', e);
        }
      }
    }

    return result;
  }

  /**
   * 检查实体是否实现了 IFluidForceTarget 接口
   */
  private isFluidForceTarget(entity: Entity): boolean {
    const target = entity as unknown as IFluidForceTarget;
    return (
      typeof target.isMovable === 'function' &&
      typeof target.applyFluidForce === 'function' &&
      typeof target.getPosition === 'function' &&
      typeof target.getBoundingRadius === 'function'
    );
  }

  /**
   * 更新所有爆炸
   * @param delta 时间差（秒）
   */
  public updateExplosions(delta: number): void {
    this.explosionManager.updateAll(delta);
  }

  /**
   * 获取爆炸数量
   */
  public getExplosionCount(): number {
    return this.explosionManager.getCount();
  }

  /**
   * 获取活跃爆炸数量
   */
  public getActiveExplosionCount(): number {
    return this.explosionManager.getActiveCount();
  }

  /**
   * 清理所有爆炸
   */
  public clearExplosions(): void {
    this.explosionManager.clear();
  }

  /**
   * 时间缩放因子，用于加快或减慢游戏内时间
   * 1.0 = 正常速度，2.0 = 两倍速度
   */
  public static timeScale: number = 2.0;  // 加快到2倍速度

  /**
   * 更新所有实体（每帧调用）
   * @param delta 时间差（秒）
   */
  public update(delta: number): void {
    // 应用时间缩放
    const scaledDelta = delta * EntityManager.timeScale;
    this.updateEntities(scaledDelta);
    // 更新爆炸
    this.updateExplosions(scaledDelta);
  }

  /**
   * 更新所有实体（内部方法，提取公共逻辑）
   * @param delta 时间差（秒）
   */
  private updateEntities(delta: number): void {
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
    // 清理爆炸
    this.clearExplosions();
    console.log('EntityManager cleared');
  }

  /**
   * 获取实体数量
   */
  public getEntityCount(): number {
    return this.entities.size;
  }

  // ========== 流体区域管理器方法 ==========

  /**
   * 注册流体区域管理器
   */
  public addFluidRegion(region: FluidRegionManager): void {
    this.fluidRegions.push(region);
  }

  /**
   * 移除流体区域管理器
   */
  public removeFluidRegion(region: FluidRegionManager): void {
    const idx = this.fluidRegions.indexOf(region);
    if (idx >= 0) {
      region.destroy();
      this.fluidRegions.splice(idx, 1);
      console.log('FluidRegion removed');
    }
  }

  /**
   * 更新所有实体（每帧调用）
   * @param delta 时间差（秒）
   * @param playerPosition 玩家位置（用于计算流体LOD）
   */
  public updateWithPlayer(delta: number, playerPosition?: THREE.Vector3): void {
    // 应用时间缩放
    const scaledDelta = delta * EntityManager.timeScale;
    
    // 1. 更新普通实体
    this.updateEntities(scaledDelta);

    // 2. 更新流体区域
    this.updateFluidRegions(scaledDelta, playerPosition);

    // 3. 更新爆炸
    this.updateExplosions(scaledDelta);
  }

  /**
   * 更新流体区域（内部方法）
   * @param delta 时间差（秒）
   * @param playerPosition 玩家位置（用于计算流体LOD）
   */
  private updateFluidRegions(delta: number, playerPosition?: THREE.Vector3): void {
    // 如果 FluidLOD 还未初始化，说明流体区域还没创建，跳过
    if (!FluidLOD) {
      return;
    }
    
    if (playerPosition) this.playerPositionCache.copy(playerPosition);

    const highDist = 3.0;    // 距离 ≤3 使用 HIGH
    const mediumDist = 6.0;  // 距离 ≤6 使用 MEDIUM
    const offDist = 10.0;    // 距离 ≤10 使用 LOW，超过10销毁

    // 收集需要移除的流体区域（安全删除，避免迭代时修改数组）
    const regionsToRemove: FluidRegionManager[] = [];

    for (const region of this.fluidRegions) {
      const { center, radius } = region.getBounds();
      const dist = center.distanceTo(this.playerPositionCache) - radius;
      let lod: FluidLOD;

      if (dist <= highDist) {
        lod = FluidLOD.HIGH;
      } else if (dist <= mediumDist) {
        lod = FluidLOD.MEDIUM;
      } else if (dist <= offDist) {
        lod = FluidLOD.LOW;
      } else {
        lod = FluidLOD.OFF;
      }

      region.update(delta, lod);

      // 检查区域是否标记为待移除
      if (region.isMarkedForRemoval()) {
        regionsToRemove.push(region);
      }
    }

    // 在循环外部安全删除标记的区域
    for (const region of regionsToRemove) {
      this.removeFluidRegion(region);
    }
  }
}