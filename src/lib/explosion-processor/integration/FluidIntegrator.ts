import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import type { InjectionParams, ExplosionForceField } from '@lib/explosion-processor/types';
import { DEFAULT_INJECTION_PARAMS } from '@lib/explosion-processor/types';
import type { IFluidForceTarget } from '@entities/fluid/FluidExternalForce';

/**
 * 流体积分器：将爆炸物理量转换为力场描述符
 * 坐标映射由目标（FluidSimulator）内部自行处理
 */
export class FluidIntegrator {
  private target: IFluidForceTarget | null = null;
  private injectionParams: InjectionParams;
  private destroyed: boolean = false;
  
  // 复用对象减少 GC
  private centerWorld: THREE.Vector2 = new THREE.Vector2();

  constructor(target: IFluidForceTarget, injectionParams?: Partial<InjectionParams>) {
    this.target = target;
    this.injectionParams = { ...DEFAULT_INJECTION_PARAMS, ...injectionParams };
  }

  /**
   * 设置注入参数
   * @param params 部分注入参数
   */
  public setInjectionParams(params: Partial<InjectionParams>): void {
    if (this.destroyed) return;
    this.injectionParams = { ...this.injectionParams, ...params };
  }

  /**
   * 获取注入参数
   * @returns 当前注入参数
   */
  public getInjectionParams(): InjectionParams {
    return this.injectionParams;
  }

  /**
   * 注入爆炸力场描述符（仅传递原始物理数据，不进行任何坐标映射）
   * @param explosion 爆炸求解器
   * @param worldCenterX 世界空间X坐标
   * @param worldCenterY 世界空间Y坐标
   */
  public inject(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): void {
    if (this.destroyed || !this.target || !explosion.isActive()) return;

    // 如果目标支持力场描述符接口，使用新接口
    if (typeof this.target.applyExplosionField === 'function') {
      const field = this.buildForceField(explosion, worldCenterX, worldCenterY);
      this.target.applyExplosionField(field);
    } else {
      // 降级：目标不支持精细力场，静默忽略
      // console.debug('[FluidIntegrator] 目标不支持 applyExplosionField，跳过');
    }
  }

  /**
   * 构建爆炸力场描述符
   * @param explosion 爆炸求解器
   * @param worldCenterX 世界空间X坐标
   * @param worldCenterY 世界空间Y坐标
   * @returns 力场描述符
   */
  private buildForceField(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): ExplosionForceField {
    this.centerWorld.set(worldCenterX, worldCenterY);
    
    return {
      centerWorld: this.centerWorld.clone(),
      shockRadius: explosion.getShockRadius(),
      corePressure: explosion.getCorePressure(),
      coreTemperature: explosion.getCoreTemperature(),
      ambientPressure: explosion.getAmbientPressure(),
      sample: (r: number) => explosion.sample(r),
      sampleNormalized: (xi: number) => explosion.sampleNormalized(xi),
      shockAcceleration: explosion.getShockAcceleration(),
      shockSpeed: explosion.getShockSpeed(),
    };
  }

  /**
   * 设置新的目标
   * @param target 新的流体目标
   */
  public setTarget(target: IFluidForceTarget): void {
    if (this.destroyed) return;
    this.target = target;
  }

  /**
   * 获取当前目标
   * @returns 当前流体目标
   */
  public getTarget(): IFluidForceTarget | null {
    return this.target;
  }

  /**
   * 销毁积分器
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target = null;
    this.injectionParams = undefined as any;
  }

  /**
   * 检查是否已销毁
   * @returns 是否已销毁
   */
  public isDestroyed(): boolean {
    return this.destroyed;
  }
}
