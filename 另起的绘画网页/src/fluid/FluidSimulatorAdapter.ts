import * as THREE from 'three';
import { FluidSimulator } from '@fluid/fluid-simulator/FluidSimulator';
import type { FluidParams } from '@fluid/fluid-simulator/FluidSimulator';

/**
 * 流体模拟适配器 - 绘画网页专用版本
 * 复制自游戏中的 FluidSimulatorAdapter，简化了依赖
 */
export class FluidSimulatorAdapter {
  public readonly width: number;
  public readonly height: number;
  private simulator: FluidSimulator;
  private material: THREE.ShaderMaterial;
  private lastUpdateTime: number = performance.now();
  private isFirstFrame: boolean = true;
  private explosionFrameCount: number = 0;
  private originalPressureIterations: number = 50;
  private isExplosionBoosted: boolean = false;
  private constantInjectionStarted: boolean = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    params: Partial<FluidParams> = {}
  ) {
    // 默认参数，包含分层渲染配置（与游戏中保持一致）
    const defaultParams: FluidParams = {
      width: 512,
      height: 512,
      density: 1,
      viscosity: 1000,
      surfaceTension: 728000,
      gravity: 9.81,
      pressureIterations: 200,
      reinitIterations: 1,
      reinitInterval: 100,
      timeStep: 0.002,
      restitution: 1.0,
      friction: 0.0,
      usePCG: false,
      maxLifetime: 2000,
      maxVelocity: 110,
      // 解耦边界处理参数（增强爆炸飞溅效果）
      decoupledBoundary: true,
      boundaryRingWidth: 0.03,
      boundaryDivDamping: 1.0,
      boundaryVelDamping: 1.0,
      // 爆炸随机扰动参数
      usePerturbation: false,
      perturbationStrength: 0.4,
      fragmentCount: 1,
      // 分层渲染参数
      waterColor: new THREE.Color(0.2, 0.6, 0.9),
      deepColor: new THREE.Color(0.05, 0.2, 0.4),
      edgeWidth: 0.05,
      edgeIntensity: 0.3,
      specularIntensity: 0.5,
      flowIntensity: 0.3,
      lightDir: new THREE.Vector3(0.5, 1.0, 0.3).normalize(),
      // 纹理居中追踪参数
      enableCentering: false,
      centeringInterval: 0.5,
      // phi 场后处理修正参数
      clampAirPhi: true,
      maxAirPhi: 0.0,
      compensateWaterPhi: true,
      waterCompensationRate: 0.1,
      ...params
    };

    // 创建模拟器
    this.simulator = new FluidSimulator(renderer, defaultParams);
    this.originalPressureIterations = defaultParams.pressureIterations;

    // 设置尺寸属性（由模拟器内部决定）
    this.width = defaultParams.width;
    this.height = defaultParams.height;

    // 使用 FluidSimulator 内置的分层渲染材质
    this.material = this.simulator.getRenderMaterial();

    console.log('[FluidSimulatorAdapter] 流体模拟器已初始化');
  }

  /**
   * 获取渲染材质
   */
  public getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  /**
   * 获取底层模拟器
   */
  public getSimulator(): FluidSimulator {
    return this.simulator;
  }

  /**
   * 更新流体模拟
   */
  public update(delta?: number): void {
    const now = performance.now();
    const elapsed = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    const realDelta = (delta !== undefined) ? delta : (elapsed / 1000);

    // 爆炸序列控制
    if (this.isExplosionBoosted) {
      this.explosionFrameCount++;

      // 每6帧爆炸一次（第6、12、18、24、30帧），共5次爆炸
      if (this.explosionFrameCount % 6 === 0 && this.explosionFrameCount <= 30) {
        const stage = (this.explosionFrameCount / 6) - 1;
        const strengths = [25000, 20000, 15000, 10000, 5000];
        const strength = strengths[stage];
        const createWater = stage === 0 || stage === 4;
        const waterMultiplier = stage === 4 ? 2 : 1;
        const boostedStrength = stage === 4 ? strength * 2 : strength;
        const offsetX = (Math.random() - 0.5) * 0.01;
        const offsetY = (Math.random() - 0.5) * 0.01;

        this.simulator.explodeFragmented(
          0.5 + offsetX,
          0.5 + offsetY,
          0.15,
          boostedStrength,
          createWater,
          0.1,
          undefined,
          undefined,
          waterMultiplier
        );
      }

      // 5次爆炸完成后停止爆炸序列
      if (this.explosionFrameCount > 35) {
        this.simulator.setPressureIterations(this.originalPressureIterations);
        this.isExplosionBoosted = false;
        this.explosionFrameCount = 0;
      }
    }

    // 第一帧时触发爆炸序列
    if (this.isFirstFrame) {
      this.isFirstFrame = false;
      this.simulator.setPressureIterations(500);
      this.isExplosionBoosted = true;
      this.explosionFrameCount = 0;
    }

    // 启动恒定散度注入
    if (!this.constantInjectionStarted) {
      this.constantInjectionStarted = true;
      this.simulator.startConstantInjection(new THREE.Vector2(0.5, 0.5), 0.3, -2000);
      console.log('[FluidSimulatorAdapter] 已启动恒定散度注入');
    }

    if (delta !== undefined) {
      this.simulator.update(delta);
    } else {
      this.simulator.update(realDelta);
    }

    this.simulator.updateRenderUniforms();
  }

  /**
   * 爆炸效果
   */
  public explode(
    cx: number,
    cy: number,
    radius: number,
    strength: number,
    createWater: boolean = true,
    duration: number = 0.1
  ): void {
    this.simulator.explode(cx, cy, radius, strength, createWater, duration);
  }

  /**
   * 各向异性爆炸
   */
  public explodeAnisotropic(
    cx: number,
    cy: number,
    radius: number,
    strength: number,
    createWater: boolean = true,
    duration: number = 0.1,
    mode: number = 0,
    phase: number = 0,
    anisoStrength: number = 0.0
  ): void {
    this.simulator.explodeAnisotropic(cx, cy, radius, strength, createWater, duration, mode, phase, anisoStrength);
  }

  /**
   * 添加速度脉冲
   */
  public addVelocityImpulse(
    dvx: number,
    dvy: number,
    radius: number,
    cx: number,
    cy: number
  ): void {
    this.simulator.addLocalVelocityImpulse(dvx, dvy, radius, cx, cy, 10.0);
  }

  /**
   * 设置固体掩码纹理
   */
  public setSolidMaskTexture(texture: THREE.Texture): void {
    this.simulator.setSolidMaskTexture(texture);
  }

  /**
   * 设置初始 level set 纹理
   */
  public setInitialLevelSet(texture: THREE.Texture): void {
    // FluidSimulator 在构造时接收 initialLevelSet
    // 如果需要动态更新，需要重新创建模拟器
    console.warn('[FluidSimulatorAdapter] setInitialLevelSet 需要重新创建模拟器');
  }

  /**
   * 获取水量统计
   */
  public getWaterAmount(): { totalWaterCount: number; dissipatedCount: number } {
    return this.simulator.getWaterAmount();
  }

  /**
   * 销毁
   */
  public dispose(): void {
    this.simulator.dispose();
  }
}