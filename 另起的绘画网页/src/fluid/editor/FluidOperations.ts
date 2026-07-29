import type { FluidGrid } from '../core/FluidGrid';
import { FluidInjector, type InjectionOptions } from '../core/FluidInjector';

// ============================================================
// 类型定义
// ============================================================

/**
 * 注入源配置。
 *
 * ⚠️ 重要：此接口有两种使用场景：
 *   1. 用户接口层（InjectionConfig）：Y向下为正，速度Y向下为正
 *   2. 纹理坐标层（转换后）：Y向上为正，速度Y向上为正
 *
 * 分层规范：
 *   - UI/Editor 层使用用户接口坐标
 *   - FluidEditor.adaptInjectionConfig() 负责坐标转换
 *   - FluidOperations 层只处理已转换的纹理坐标
 *   - FluidInjector 层只处理纯粹的物理注入
 *
 * @see FluidEditor.adaptInjectionConfig()
 */
export interface InjectionConfig {
  enabled: boolean;
  /** 归一化位置 (0~1) */
  position: { x: number; y: number };
  /** 归一化半径 */
  radius: number;
  /** 每帧注入量 (0~1) */
  rate: number;
  /** 注入速度（像素/秒） */
  velocity: { x: number; y: number };
  /** RGBA 颜色值 (各分量 0~1) */
  color: [number, number, number, number];
}

/** 漩涡参数 */
export interface VortexOptions {
  /** 漩涡中心（归一化坐标，纹理空间） */
  center: { x: number; y: number };
  /** 影响半径 */
  radius: number;
  /** 旋转强度（正=逆时针，负=顺时针） */
  strength: number;
  /** 中心收敛强度（正=吸入，负=喷出） */
  suction?: number;
}

/** 爆炸参数 */
export interface ExplosionOptions {
  /** 爆炸中心 */
  center: { x: number; y: number };
  /** 影响半径 */
  radius: number;
  /** 冲击力强度 */
  power: number;
}

/** 定向风力参数 */
export interface WindOptions {
  /** 风向矢量（像素/秒） */
  direction: { x: number; y: number };
  /** 风力强度倍率 (0~1) */
  strength: number;
}

// ============================================================
// FluidOperations —— 操作模块（第2层）
// ============================================================

/**
 * 操作模块 —— 提供高级流体效果。
 *
 * 职责：构建可组合的流体特效函数。
 *
 * 约束：
 *   - 只能调用 FluidInjector 的三个原子注入函数。
 *   - 不允许直接操作 FluidGrid 或调用 gpu.render。
 *   - 不持有任何网格引用（通过参数传入）。
 *   - 新增效果只需在此类中添加方法，复用注入基元即可。
 */
export class FluidOperations {
  private injector: FluidInjector;

  constructor(injector: FluidInjector) {
    this.injector = injector;
  }

  // ==================== 基础操作 ====================

  /**
   * 施加重力（全局速度注入）。
   *
   * @param grid 速度网格
   * @param dt 时间步长（秒）
   * @param gravity 重力加速度（像素/秒²），正值向下（用户坐标系）
   */
  applyGravity(grid: FluidGrid, dt: number, gravity: number): void {
    if (gravity === 0) return;

    // flipY=false: 正Y=向下，与用户重力方向一致，直接注入
    this.injector.injectVelocity(
      grid,
      { x: 0, y: gravity * dt },
      { global: true },
    );
  }

  /**
   * 持续注入源（颜色 + 速度）。
   *
   * 在指定位置以指定速率持续注入颜色和速度，
   * 模拟"水龙头"或"喷口"效果。
   *
   * 注意：config 参数必须已经通过接口适配层转换为纹理坐标。
   * 本方法只负责纯粹的物理注入逻辑，不关心坐标系转换。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param dt 时间步长（秒）
   * @param config 注入源配置（已转换为纹理坐标）
   */
  applyInjection(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    dt: number,
    config: InjectionConfig,
  ): void {
    if (!config.enabled) return;

    const rate = config.rate * dt;

    // 位置和速度已通过接口适配层转换为纹理坐标，直接使用
    const texPos: InjectionOptions = {
      position: { x: config.position.x, y: config.position.y },
      radius: config.radius,
    };

    // 颜色注入
    this.injector.injectColor(
      gridColor,
      {
        h: config.color[0],
        s: config.color[1],
        l: config.color[2],
        a: config.color[3],
      },
      rate,
      texPos,
    );

    // 速度注入（已转换为纹理坐标）
    this.injector.injectVelocity(
      gridVelocity,
      { x: config.velocity.x, y: config.velocity.y },
      texPos,
    );
  }

  // ==================== 高级效果（预留接口，后续按需实现） ====================

  /**
   * 添加漩涡。
   *
   * 在指定位置创建旋转速度场，模拟涡流效果。
   * 需要配合散度注入以实现收敛性漩涡。
   *
   * @param grid 速度网格
   * @param options 漩涡参数
   */
  // addVortex(grid: FluidGrid, options: VortexOptions): void {
  //   // 步骤：
  //   // 1. 注入切向速度（旋转）—— injectVelocity 配合切向方向
  //   // 2. 注入径向速度（吸入）—— injectDivergence
  //   // TODO: 实现
  // }

  /**
   * 爆炸效果。
   *
   * 从中心向外爆发速度，同时可注入颜色。
   *
   * @param gridVel 速度网格
   * @param gridColor 颜色网格（可选）
   * @param options 爆炸参数
   */
  // addExplosion(
  //   gridVel: FluidGrid,
  //   gridColor: FluidGrid | null,
  //   options: ExplosionOptions,
  // ): void {
  //   // 注入径向速度 + 可选颜色
  //   // TODO: 实现
  // }

  /**
   * 定向风力。
   *
   * 在指定区域施加恒定方向的速度，模拟风扇/风力效果。
   *
   * @param grid 速度网格
   * @param region 影响区域（归一化矩形）
   * @param options 风力参数
   */
  // applyWind(
  //   grid: FluidGrid,
  //   region: { x: number; y: number; w: number; h: number },
  //   options: WindOptions,
  // ): void {
  //   // 使用 injectVelocity + mask 实现区域风力
  //   // TODO: 实现
  // }

  /**
   * 定点扰动。
   *
   * 在指定位置产生随机速度扰动，模拟湍流。
   *
   * @param grid 速度网格
   * @param center 扰动中心
   * @param radius 影响半径
   * @param intensity 扰动强度
   */
  // addTurbulence(
  //   grid: FluidGrid,
  //   center: { x: number; y: number },
  //   radius: number,
  //   intensity: number,
  // ): void {
  //   // 注入随机速度 + 可选散度
  //   // TODO: 实现
  // }

  /**
   * 颜色清除（全局）。
   *
   * 将整个颜色场向透明渐变，模拟颜色衰减/消失。
   *
   * @param grid 颜色网格
   * @param fadeRate 衰减速率 (0~1)
   */
  // fadeColor(grid: FluidGrid, fadeRate: number): void {
  //   // 全局 injectColor 向透明混合
  //   // TODO: 实现
  // }

  /**
   * 速度衰减（全局）。
   *
   * 将整个速度场乘以衰减系数，模拟粘性耗散。
   *
   * @param grid 速度网格
   * @param damping 衰减系数 (0~1, 1=无衰减)
   */
  // dampVelocity(grid: FluidGrid, damping: number): void {
  //   // 全局 injectVelocity(0) 配合 rate=1-damping
  //   // TODO: 实现
  // }
}
