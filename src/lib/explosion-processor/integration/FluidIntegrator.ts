import * as THREE from 'three';
import { Explosion1DSolver } from '../Explosion1DSolver';
import { FluidSimulator } from '../../fluid-simulator/fluid-simulator/FluidSimulator';
import type { InjectionParams } from '@lib/explosion-processor/types';
import { DEFAULT_INJECTION_PARAMS } from '@lib/explosion-processor/types';
import type {
  FluidExternalForce,
  FluidDivergenceInjection,
  FluidWaterInjection,
  IFluidForceTarget,
} from '@entities/fluid/FluidExternalForce';

export class FluidIntegrator {
  private target: IFluidForceTarget | null = null;
  private injectionParams: InjectionParams;
  private worldToUVScale: number = 1.0;
  private worldOffsetX: number = 0;  // 世界坐标偏移（用于处理负坐标）
  private worldOffsetY: number = 0;
  private destroyed: boolean = false;

  constructor(target: IFluidForceTarget, injectionParams?: Partial<InjectionParams>) {
    this.target = target;
    this.injectionParams = { ...DEFAULT_INJECTION_PARAMS, ...injectionParams };
  }

  public setInjectionParams(params: Partial<InjectionParams>): void {
    if (this.destroyed) return;
    this.injectionParams = { ...this.injectionParams, ...params };
  }

  public setWorldToUVScale(scale: number): void {
    if (this.destroyed) return;
    this.worldToUVScale = scale;
  }

  /**
   * 设置世界坐标偏移（用于处理负坐标）
   * @param offsetX X方向偏移
   * @param offsetY Y方向偏移
   */
  public setWorldOffset(offsetX: number, offsetY: number): void {
    if (this.destroyed) return;
    this.worldOffsetX = offsetX;
    this.worldOffsetY = offsetY;
  }

  /**
   * 根据世界范围自动设置UV映射
   * @param worldMinX 世界X最小值
   * @param worldMaxX 世界X最大值
   * @param worldMinY 世界Y最小值
   * @param worldMaxY 世界Y最大值
   */
  public setWorldBounds(worldMinX: number, worldMaxX: number, worldMinY: number, worldMaxY: number): void {
    if (this.destroyed) return;
    const worldSizeX = worldMaxX - worldMinX;
    const worldSizeY = worldMaxY - worldMinY;
    this.worldToUVScale = 1.0 / Math.max(worldSizeX, worldSizeY);
    this.worldOffsetX = worldMinX;
    this.worldOffsetY = worldMinY;
  }

  /**
   * 将爆炸效果注入到目标
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

    const force = this.buildFluidForce(explosion, worldCenterX, worldCenterY);
    this.target.applyFluidForce(force);
  }

  /**
   * 构建流体外力描述符
   * @param explosion 爆炸求解器
   * @param worldCenterX 世界空间X坐标
   * @param worldCenterY 世界空间Y坐标
   * @returns FluidExternalForce 外力描述符
   */
  public buildFluidForce(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): FluidExternalForce {
    const force: FluidExternalForce = {};

    const shockRadius = explosion.getShockRadius();
    if (shockRadius <= 0) {
      return force;
    }

    const fireballRadius = shockRadius * this.injectionParams.fireballRadiusRatio;

    // 修正UV坐标计算：考虑世界坐标偏移
    const centerUV = new THREE.Vector2(
      (worldCenterX + this.worldOffsetX) * this.worldToUVScale,
      (worldCenterY + this.worldOffsetY) * this.worldToUVScale
    );

    // 构建散度注入（负散度=膨胀，产生径向扩张效果）
    // 移除velocityInjection，因为其方向固定为45°是错误的
    // divergenceInjection已经能产生足够真实的径向扩散效果
    const divergenceInjection: FluidDivergenceInjection = {
      centerUV: centerUV.clone(),
      radius: fireballRadius * this.worldToUVScale,
      falloff: 'gaussian',
      divergence: -Math.min(
        explosion.getPressureGradient(0.01, shockRadius * 0.8) * this.injectionParams.divergenceStrength,
        10.0
      ),
    };
    force.divergenceInjection = divergenceInjection;

    // 构建水体注入（如果启用）
    if (this.injectionParams.waterStrength > 0) {
      const coreTemp = explosion.getCoreTemperature();
      const ambientTemp = 288.15;
      const tempRatio = coreTemp / ambientTemp;
      const waterAmount = this.injectionParams.waterStrength * (tempRatio - 1);

      if (waterAmount > 0) {
        const waterInjection: FluidWaterInjection = {
          centerUV: centerUV.clone(),
          radius: fireballRadius * this.worldToUVScale,
          falloff: 'linear',
          amount: waterAmount,
        };
        force.waterInjection = waterInjection;
      }
    }

    // 如果目标可移动，添加世界空间冲量
    if (this.target && this.target.isMovable()) {
      const shockSpeed = explosion.getShockSpeed();
      force.worldImpulse = new THREE.Vector3(
        shockSpeed * 0.05 * this.injectionParams.velocityStrength,
        shockSpeed * 0.05 * this.injectionParams.velocityStrength,
        0
      );
    }

    return force;
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
   * 销毁集成器
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