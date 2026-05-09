import * as THREE from 'three';
import { Entity } from './Entity';
// 延迟导入以避免循环依赖
let FluidRegionManager: typeof import('@entities/fluid').FluidRegionManager;
let FluidLOD: typeof import('@entities/fluid').FluidLOD;

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
    console.log(`[EntityManager] 设置场景，暂存实体数量: ${this.pendingEntities.length}`);
    this.scene = scene;
    
    // 将暂存的实体添加到场景
    for (const entity of this.pendingEntities) {
      const isFriendlyEntity = entity.type === 'character' && (entity as any).faction === 'friendly';
      if (entity.mesh && !isFriendlyEntity) {
        this.scene.add(entity.mesh);
        console.log(`[EntityManager] 延迟添加实体到场景: ${entity.type} - ${entity.id}`);
      }
    }
    this.pendingEntities = [];
    console.log(`[EntityManager] 场景设置完成，暂存队列已清空`);
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
    console.log('[EntityManager] 设置渲染器，开始初始化流体区域');
    this.renderer = renderer;
    
    // 自动初始化流体区域（包含5个小液滴）- 只初始化一次
    if (!this.hasInitializedFluidRegion) {
      this.hasInitializedFluidRegion = true;
      this.initDefaultFluidRegion();
    } else {
      console.log('[EntityManager] 流体区域已初始化过，跳过');
    }
  }

  /**
   * 初始化默认流体区域（包含5个小液滴）
   */
  private async initDefaultFluidRegion(): Promise<void> {
    console.log('[EntityManager] initDefaultFluidRegion 开始执行');
    
    if (!this.renderer) {
      console.log('[EntityManager] 渲染器未设置，跳过流体区域初始化');
      return;
    }
    
    console.log('[EntityManager] 渲染器已设置，继续初始化...');
    
    // 动态导入以避免循环依赖
    if (!FluidRegionManager) {
      const module = await import('@entities/fluid');
      FluidRegionManager = module.FluidRegionManager;
      FluidLOD = module.FluidLOD;
      console.log('[EntityManager] 动态导入 FluidRegionManager 成功');
    }
    
    // 创建流体区域管理器，中心在原点，半径2.0，最多10个液滴
    const center = new THREE.Vector3(0, 0, 0);
    console.log(`[EntityManager] 创建流体区域，中心: (${center.x}, ${center.y}, ${center.z}), 半径: 2.0`);
    const region = new FluidRegionManager(center, 2.0, 10);
    
    // 添加到管理器
    this.addFluidRegion(region);
    console.log('[EntityManager] 流体区域已添加到管理器');
    
    // 创建5个小液滴
    console.log('[EntityManager] 准备调用 region.createDroplets(5, 1.5)...');
    try {
      await region.createDroplets(5, 1.5);
      console.log('[EntityManager] region.createDroplets 调用完成');
    } catch (error) {
      console.error('[EntityManager] region.createDroplets 调用失败:', error);
    }
    
    console.log('[EntityManager] 默认流体区域初始化完成，包含5个小液滴');
    console.log(`[EntityManager] 当前实体总数: ${this.entities.size}`);
    console.log(`[EntityManager] 当前流体区域数量: ${this.fluidRegions.length}`);
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
    console.log(`[EntityManager] 添加实体: ${entity.type} - ${entity.id}, 场景状态: ${this.scene ? '已设置' : '未设置'}, mesh存在: ${!!entity.mesh}`);
    
    this.entities.set(entity.id, entity);
    
    // 对于友好实体（玩家），不自动添加mesh到场景，避免与PaperCharacter组件重复渲染
    // 对于其他实体（敌人、子弹、靶子等），正常添加mesh到场景
    const isFriendlyEntity = entity.type === 'character' && (entity as any).faction === 'friendly';
    
    // 如果场景还未设置，先暂存实体
    if (!this.scene) {
      this.pendingEntities.push(entity);
      console.log(`[EntityManager] 场景未设置，实体暂存到队列，队列大小: ${this.pendingEntities.length}`);
      return;
    }
    
    if (entity.mesh && !isFriendlyEntity) {
      this.scene.add(entity.mesh);
      console.log(`[EntityManager] 实体mesh已添加到场景`);
    } else if (isFriendlyEntity) {
      console.log(`[EntityManager] 友好实体，跳过mesh添加`);
    } else if (!entity.mesh) {
      console.log(`[EntityManager] 实体没有mesh，跳过添加`);
    }
    
    console.log(`[EntityManager] 实体添加完成，当前实体总数: ${this.entities.size}`);
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
    this.updateEntities(delta);
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
    console.log(`FluidRegion added at (${region.getBounds().center.x.toFixed(2)}, ${region.getBounds().center.y.toFixed(2)})`);
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
    // 1. 更新普通实体
    this.updateEntities(delta);

    // 2. 更新流体区域
    this.updateFluidRegions(delta, playerPosition);
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