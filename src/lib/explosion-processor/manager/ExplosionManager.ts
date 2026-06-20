import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { ExplosionParams } from '@lib/explosion-processor/types';
import { FluidIntegrator } from '../integration/FluidIntegrator';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';
import { DEFAULT_EXPLOSION_PARAMS } from '../types';

interface ExplosionEntry {
  solver: Explosion1DSolver;
  position: THREE.Vector3;
  maxInfluenceRadius: number;
  /** 静态列表：爆炸创建时锁定，之后不再修改 */
  registeredTargets: IFluidForceTarget[];
  /** 累积的物理时间 */
  injectionAccumulator: number;
  /** 注入间隔（秒） */
  injectionInterval: number;
}

export class ExplosionManager {
  private explosions: Map<string, ExplosionEntry> = new Map();
  private targets: Set<IFluidForceTarget> = new Set();
  private integrators: Map<IFluidForceTarget, FluidIntegrator> = new Map();
  private graphicsTime: number = 0;

  /**
   * 注册可被爆炸影响的目标
   * @param target 目标对象
   */
  public registerTarget(target: IFluidForceTarget): void {
    this.targets.add(target);
  }

  /**
   * 批量注册目标
   * @param targets 目标数组
   */
  public registerTargets(targets: IFluidForceTarget[]): void {
    for (const target of targets) {
      this.targets.add(target);
    }
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

    const fullParams = { ...DEFAULT_EXPLOSION_PARAMS, ...params };
    const explosion = new Explosion1DSolver(fullParams);
    const center = new THREE.Vector3(worldX, worldY, 0);

    // 创建时一次性锁定范围内的目标
    const affectedTargets = this.findTargetsInRange(center, maxInfluenceRadius);

    const entry: ExplosionEntry = {
      solver: explosion,
      position: center,
      maxInfluenceRadius,
      registeredTargets: affectedTargets,
      injectionAccumulator: 0,
      injectionInterval: fullParams.injectionInterval ?? 0.016,
    };

    this.explosions.set(id, entry);

    // 为每个目标预创建 Integrator
    for (const target of affectedTargets) {
      if (!this.integrators.has(target)) {
        this.integrators.set(target, new FluidIntegrator(target));
      }
    }

    console.log(`[ExplosionManager] 爆炸创建: id=${id}, 锁定目标=${affectedTargets.length}, 注入间隔=${entry.injectionInterval}s`);
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
   * 更新所有爆炸
   * 核心改动：累积物理时间，达到注入间隔时才执行注入
   * @param graphicsDelta 时间增量（秒）
   */
  public updateAll(graphicsDelta: number): void {
    // 限制最大单帧增量，防止时间跳跃（最大 33ms，约 30fps）
    const clampedDelta = Math.min(graphicsDelta, 0.033);
    this.graphicsTime += clampedDelta;

    // 如果没有爆炸，直接返回
    if (this.explosions.size === 0) return;

    this.explosions.forEach((entry, id) => {
      const explosion = entry.solver;

      // 跳过已失效的爆炸
      if (!explosion.isActive()) {
        return;
      }

      // 1. 推进物理
      explosion.advanceBy(clampedDelta);

      // 2. 累积物理时间
      entry.injectionAccumulator += clampedDelta;

      // 3. 达到注入间隔 -> 执行注入
      if (entry.injectionAccumulator >= entry.injectionInterval) {
        this.performInjection(entry);
        // 保留余数，避免时间漂移
        entry.injectionAccumulator -= entry.injectionInterval;
      }
    });

    // 清理失效的爆炸
    this.cleanupInactive();
  }

  /**
   * 执行一次注入：遍历静态列表，向所有有效目标注入力场
   * @param entry 爆炸条目
   */
  private performInjection(entry: ExplosionEntry): void {
    const explosion = entry.solver;
    if (!explosion.isActive()) return;

    for (const target of entry.registeredTargets) {
      if (!this.isTargetValid(target)) continue;
      const integrator = this.integrators.get(target);
      if (integrator) {
        integrator.inject(explosion, entry.position.x, entry.position.y);
      }
    }
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
   * 检查目标是否仍然有效（不被销毁）
   * @param target 目标对象
   * @returns 是否有效
   */
  private isTargetValid(target: IFluidForceTarget): boolean {
    try {
      // 如果目标实现了 isActive（如 Entity），检查它
      if (typeof (target as any).isActive === 'boolean') {
        return (target as any).isActive;
      }
      // 否则尝试获取位置，失败则视为无效
      target.getPosition();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 设置世界到UV的缩放比例（已废弃，坐标映射由目标内部处理）
   * @deprecated
   */
  public setWorldToUVScale(_scale: number): void {
    console.warn('[ExplosionManager] setWorldToUVScale 已废弃，坐标映射由目标内部处理');
  }

  /**
   * 设置世界坐标偏移（已废弃，坐标映射由目标内部处理）
   * @deprecated
   */
  public setWorldOffset(_offsetX: number, _offsetY: number): void {
    console.warn('[ExplosionManager] setWorldOffset 已废弃，坐标映射由目标内部处理');
  }

  /**
   * 根据世界范围自动设置UV映射（已废弃，坐标映射由目标内部处理）
   * @deprecated
   */
  public setWorldBounds(_worldMinX: number, _worldMaxX: number, _worldMinY: number, _worldMaxY: number): void {
    console.warn('[ExplosionManager] setWorldBounds 已废弃，坐标映射由目标内部处理');
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
      console.log(`[ExplosionManager] 爆炸已销毁: id=${id}, 剩余爆炸数=${this.explosions.size}`);
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
   * @deprecated 当前实现是线性搜索，此方法预留用于未来优化
   */
  public updateTargetPosition(_target: IFluidForceTarget): void {
    // 如果需要空间分区优化，可以在这里更新空间索引
    // 当前实现是线性搜索，此方法预留用于未来优化
  }
}
