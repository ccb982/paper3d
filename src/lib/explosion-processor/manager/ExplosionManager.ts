import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { ExplosionParams } from '@lib/explosion-processor/types';
import { FluidIntegrator } from '../integration/FluidIntegrator';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';

interface ExplosionEntry {
  solver: Explosion1DSolver;
  position: THREE.Vector3;
  maxInfluenceRadius: number;
  hasInjected: boolean;       // 是否已注入过冲量
  lastInjectionTime: number;   // 上次注入时间
}

export class ExplosionManager {
  private explosions: Map<string, ExplosionEntry> = new Map();
  private targets: Set<IFluidForceTarget> = new Set();
  private integrators: Map<IFluidForceTarget, FluidIntegrator> = new Map();
  private graphicsTime: number = 0;
  private injectionInterval: number = 0.3;  // 注入间隔（秒）

  /**
   * 创建爆炸并查询影响范围内的目标
   * @param id 爆炸唯一标识
   * @param params 爆炸参数
   * @param worldX 世界空间X坐标
   * @param worldY 世界空间Y坐标
   * @param maxInfluenceRadius 最大影响半径（用于预查询）
   * @returns 爆炸求解器
   */
  public create(
    id: string,
    params: ExplosionParams,
    worldX: number,
    worldY: number,
    maxInfluenceRadius: number = 10.0
  ): Explosion1DSolver {
    if (this.explosions.has(id)) {
      console.warn(`Explosion with id "${id}" already exists, removing old one`);
      this.remove(id);
    }

    const explosion = new Explosion1DSolver(params);
    const entry: ExplosionEntry = {
      solver: explosion,
      position: new THREE.Vector3(worldX, worldY, 0),
      maxInfluenceRadius,
      hasInjected: false,
      lastInjectionTime: 0,
    };

    this.explosions.set(id, entry);
    return explosion;
  }

  /**
   * 获取爆炸求解器
   * @param id 爆炸ID
   * @returns 爆炸求解器或undefined
   */
  public get(id: string): Explosion1DSolver | undefined {
    const entry = this.explosions.get(id);
    return entry?.solver;
  }

  /**
   * 获取爆炸位置
   * @param id 爆炸ID
   * @returns 位置向量或undefined
   */
  public getPosition(id: string): THREE.Vector3 | undefined {
    const entry = this.explosions.get(id);
    return entry?.position;
  }

  /**
   * 注册可被爆炸影响的目标
   * @param target 目标对象
   */
  public registerTarget(target: IFluidForceTarget): void {
    this.targets.add(target);
  }

  /**
   * 注销目标
   * @param target 目标对象
   */
  public unregisterTarget(target: IFluidForceTarget): void {
    this.targets.delete(target);

    // 清理相关的集成器
    const integrator = this.integrators.get(target);
    if (integrator) {
      integrator.destroy();
      this.integrators.delete(target);
    }
  }

  /**
   * 更新所有爆炸，并自动影响范围内的目标
   * @param graphicsDelta 时间增量（秒）
   */
  public updateAll(graphicsDelta: number): void {
    // 限制最大单帧增量，防止时间跳跃
    const clampedDelta = Math.min(graphicsDelta, 0.033);
    this.graphicsTime += clampedDelta;

    this.explosions.forEach((entry, id) => {
      const explosion = entry.solver;

      // 跳过已失效的爆炸
      if (!explosion.isActive()) {
        return;
      }

      // 推进爆炸时间
      explosion.advanceTo(this.graphicsTime);

      // 检查是否需要注入：只在爆炸激活的第一帧注入
      if (!entry.hasInjected) {
        entry.hasInjected = true;
        entry.lastInjectionTime = this.graphicsTime;

        // 查找范围内的目标
        const affectedTargets = this.findTargetsInRange(
          entry.position,
          entry.maxInfluenceRadius
        );

        // 对每个目标应用爆炸效果
        affectedTargets.forEach((target) => {
          const integrator = this.getOrCreateIntegrator(target);
          integrator.inject(explosion, entry.position.x, entry.position.y);
        });
      }
    });

    // 清理失效的爆炸
    this.cleanupInactive();
  }

  /**
   * 查找范围内的目标
   * @param center 中心点
   * @param radius 半径
   * @returns 范围内的目标数组
   */
  private findTargetsInRange(center: THREE.Vector3, radius: number): IFluidForceTarget[] {
    const result: IFluidForceTarget[] = [];

    for (const target of this.targets) {
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

    return result;
  }

  /**
   * 获取或创建集成器
   * @param target 目标对象
   * @returns 流体集成器
   */
  private getOrCreateIntegrator(target: IFluidForceTarget): FluidIntegrator {
    let integrator = this.integrators.get(target);

    if (!integrator) {
      integrator = new FluidIntegrator(target);
      this.integrators.set(target, integrator);
    }

    return integrator;
  }

  /**
   * 设置世界到UV的缩放比例（应用于所有集成器）
   * @param scale 缩放比例
   */
  public setWorldToUVScale(scale: number): void {
    for (const integrator of this.integrators.values()) {
      integrator.setWorldToUVScale(scale);
    }
  }

  /**
   * 设置世界坐标偏移（用于处理负坐标）
   * @param offsetX X方向偏移
   * @param offsetY Y方向偏移
   */
  public setWorldOffset(offsetX: number, offsetY: number): void {
    for (const integrator of this.integrators.values()) {
      integrator.setWorldOffset(offsetX, offsetY);
    }
  }

  /**
   * 根据世界范围自动设置UV映射（支持负坐标）
   * @param worldMinX 世界X最小值
   * @param worldMaxX 世界X最大值
   * @param worldMinY 世界Y最小值
   * @param worldMaxY 世界Y最大值
   */
  public setWorldBounds(worldMinX: number, worldMaxX: number, worldMinY: number, worldMaxY: number): void {
    for (const integrator of this.integrators.values()) {
      integrator.setWorldBounds(worldMinX, worldMaxX, worldMinY, worldMaxY);
    }
  }

  /**
   * 移除爆炸
   * @param id 爆炸ID
   */
  public remove(id: string): void {
    const entry = this.explosions.get(id);
    if (entry) {
      entry.solver.destroy();
      this.explosions.delete(id);
    }
  }

  /**
   * 检查爆炸是否存在
   * @param id 爆炸ID
   * @returns 是否存在
   */
  public has(id: string): boolean {
    return this.explosions.has(id);
  }

  /**
   * 推进到指定时间
   * @param targetTime 目标时间
   */
  public advanceTo(targetTime: number): void {
    this.graphicsTime = targetTime;
    this.explosions.forEach((entry) => {
      if (entry.solver.isActive()) {
        entry.solver.advanceTo(targetTime);
      }
    });
  }

  /**
   * 获取所有活跃的爆炸
   * @returns 活跃爆炸数组
   */
  public getActiveExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values())
      .filter((entry) => entry.solver.isActive())
      .map((entry) => entry.solver);
  }

  /**
   * 获取所有爆炸
   * @returns 所有爆炸数组
   */
  public getAllExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values()).map((entry) => entry.solver);
  }

  /**
   * 获取爆炸总数
   * @returns 爆炸数量
   */
  public getCount(): number {
    return this.explosions.size;
  }

  /**
   * 获取活跃爆炸数量
   * @returns 活跃爆炸数量
   */
  public getActiveCount(): number {
    return this.getActiveExplosions().length;
  }

  /**
   * 获取注册的目标数量
   * @returns 目标数量
   */
  public getTargetCount(): number {
    return this.targets.size;
  }

  /**
   * 清空所有爆炸和目标
   */
  public clear(): void {
    // 销毁所有爆炸
    this.explosions.forEach((entry) => {
      entry.solver.destroy();
    });
    this.explosions.clear();

    // 销毁所有集成器
    for (const integrator of this.integrators.values()) {
      integrator.destroy();
    }
    this.integrators.clear();

    // 清空目标（但不销毁，由外部管理）
    this.targets.clear();

    this.graphicsTime = 0;
  }

  /**
   * 获取当前图形时间
   * @returns 当前时间
   */
  public getGraphicsTime(): number {
    return this.graphicsTime;
  }

  /**
   * 遍历所有爆炸
   * @param callback 回调函数
   */
  public forEach(callback: (explosion: Explosion1DSolver, id: string) => void): void {
    this.explosions.forEach((entry, id) => {
      callback(entry.solver, id);
    });
  }

  /**
   * 清理失效的爆炸
   */
  public cleanupInactive(): void {
    const toRemove: string[] = [];

    this.explosions.forEach((entry, id) => {
      if (!entry.solver.isActive()) {
        toRemove.push(id);
      }
    });

    toRemove.forEach((id) => this.remove(id));
  }

  /**
   * 更新目标位置（用于空间查询优化）
   * @param target 目标对象
   */
  public updateTargetPosition(target: IFluidForceTarget): void {
    // 如果需要空间分区优化，可以在这里更新空间索引
    // 当前实现是线性搜索，此方法预留用于未来优化
  }
}