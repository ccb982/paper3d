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
  /**
   * ★ MCSDA density 浓度注入（仅 advectionMode='scalar' 时生效）。
   * 提供时会在对应位置注入 density 浓度值，被速度场推动流动。
   * 不提供（undefined）时跳过 density 注入，兼容 vector 模式。
   */
  density?: number;
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

  /** ★ 临时诊断：实例 id，用于确认 UI 和 step 是否同一 operations */
  private static _nextId = 0;
  private readonly _instanceId = FluidOperations._nextId++;

  /** 待处理的单次注入队列（UI 交互的一次性注入） */
  private pendingInjections: InjectionConfig[] = [];

  /** 持续注入源列表（每帧都会执行，直到被移除） */
  private continuousSources: { id: number; config: InjectionConfig }[] = [];
  private nextSourceId = 1;

  /**
   * 持续注入总开关。
   * 关闭时暂停所有持续注入源的处理，但保留源列表（队列独立存在）。
   * 再次开启后，所有源自动恢复注入。
   */
  private continuousInjectionEnabled = false;

  /** 初速度调试：帧计数器，用于每帧应用日志节流（每 30 帧打印一次） */
  private _velDebugFrameCounter = 0;

  constructor(injector: FluidInjector) {
    this.injector = injector;
    console.log(`[diag] FluidOperations 构造, id=${this._instanceId}`);
  }

  // ==================== 注入队列管理（一次性注入） ====================

  /**
   * UI 调用的入队接口。
   * 将一次注入操作加入队列，下一帧 processQueue 时执行。
   * 这是 UI 与物理引擎之间的安全接口，避免与渲染循环竞争纹理交换。
   *
   * @param config 注入源配置（纹理坐标，已通过 adaptInjectionConfig 转换）
   */
  public queueInjection(config: InjectionConfig): void {
    // 深拷贝，防止外部修改
    this.pendingInjections.push({ ...config });
    console.log(`[diag] queueInjection id=${this._instanceId}: push后 len=${this.pendingInjections.length}, vel=(${config.velocity.x},${config.velocity.y}), pos=(${config.position.x.toFixed(3)},${config.position.y.toFixed(3)}), radius=${config.radius}`);
  }

  /**
   * 在每帧 step 中调用，处理所有待执行的一次性注入。
   * 通常在物理计算前调用，确保本帧生效。
   *
   * 注意：一次性注入是瞬时冲量，不乘以 dt（与持续注入的 velocity*dt 不同）。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param _dt 时间步长（秒）—— 一次性注入不使用 dt，保留参数以匹配调度接口
   * @param gridDensity density 网格（MCSDA scalar 模式传入，vector 模式传 null）
   */
  public processQueue(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    _dt: number,
    gridDensity: FluidGrid | null = null,
  ): void {
    const _n = this.pendingInjections.length;
    if (_n === 0) return;
    console.log(`[diag] processQueue id=${this._instanceId}: 处理 ${_n} 个注入`);

    // 批量处理队列中的所有注入
    for (const config of this.pendingInjections) {
      this.applyOneShotInjection(gridColor, gridVelocity, config, gridDensity);
    }

    // 清空队列
    this.pendingInjections = [];
  }

  // ==================== 持续注入源管理 ====================

  /**
   * 新增一个持续注入源（每帧自动执行）。
   * 返回源 ID，用于后续更新或移除。
   *
   * @param config 注入源配置（纹理坐标，已通过 adaptInjectionConfig 转换）
   * @returns 源 ID
   */
  public addContinuousSource(config: InjectionConfig): number {
    const id = this.nextSourceId++;
    this.continuousSources.push({ id, config: { ...config } });
    // ★ 初速度调试：记录新增源的初速度（纹理坐标，Y向上为正）
    console.log(`[初速度] 新增源 #${id}: 初速度=(${config.velocity.x.toFixed(2)},${config.velocity.y.toFixed(2)}) px/s, 位置=(${config.position.x.toFixed(3)},${config.position.y.toFixed(3)}), rate=${config.rate}`);
    return id;
  }

  /**
   * 更新指定持续注入源的参数（upsert 模式：不存在则自动添加）。
   *
   * @param id 源 ID
   * @param config 新的注入配置（纹理坐标）
   * @returns 是否实际添加了新源（用于 UI 同步 ID）
   */
  public updateContinuousSource(id: number, config: InjectionConfig): boolean {
    const src = this.continuousSources.find(s => s.id === id);
    if (src) {
      src.config = { ...config };
      // ★ 初速度调试：记录更新后的初速度（纹理坐标，Y向上为正）
      console.log(`[初速度] 更新源 #${id}: 初速度=(${config.velocity.x.toFixed(2)},${config.velocity.y.toFixed(2)}) px/s, 位置=(${config.position.x.toFixed(3)},${config.position.y.toFixed(3)}), rate=${config.rate}`);
      return false;
    } else {
      // ★ upsert 模式：源不存在时自动添加（防止编辑器重建后源丢失的问题）
      console.warn(`[初速度] 源 #${id} 不存在（当前源数=${this.continuousSources.length}），自动添加为新源`);
      const newId = this.nextSourceId++;
      this.continuousSources.push({ id: newId, config: { ...config } });
      console.log(`[初速度] 自动恢复源: 旧ID=${id} → 新ID=${newId}, 初速度=(${config.velocity.x.toFixed(2)},${config.velocity.y.toFixed(2)}) px/s`);
      return true;
    }
  }

  /**
   * 移除指定持续注入源。
   *
   * @param id 源 ID
   */
  public removeContinuousSource(id: number): void {
    this.continuousSources = this.continuousSources.filter(s => s.id !== id);
  }

  /** 清除所有持续注入源 */
  public clearContinuousSources(): void {
    this.continuousSources = [];
  }

  /**
   * 设置持续注入总开关。
   * 关闭时暂停所有持续注入源的处理，但保留源列表（队列独立存在），
   * 再次开启后所有源自动恢复注入。
   *
   * @param enabled 是否启用持续注入
   */
  public setContinuousInjectionEnabled(enabled: boolean): void {
    this.continuousInjectionEnabled = enabled;
  }

  /** 获取当前活跃的持续注入源数量 */
  public get continuousSourceCount(): number {
    return this.continuousSources.length;
  }

  /**
   * 获取所有持续注入源的快照（用于 UI 可视化）。
   * 返回的是深拷贝，外部修改不影响内部状态。
   */
  public getContinuousSourcesSnapshot(): {
    id: number;
    position: { x: number; y: number };
    radius: number;
    velocity: { x: number; y: number };
    color: [number, number, number, number];
    rate: number;
    enabled: boolean;
  }[] {
    return this.continuousSources.map(s => ({
      id: s.id,
      position: { ...s.config.position },
      radius: s.config.radius,
      velocity: { ...s.config.velocity },
      color: [...s.config.color] as [number, number, number, number],
      rate: s.config.rate,
      enabled: s.config.enabled,
    }));
  }

  /**
   * 在每帧 step 中调用，处理所有活跃的持续注入源。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param dt 时间步长（秒）
   * @param gridDensity density 网格（MCSDA scalar 模式传入，vector 模式传 null）
   */
  public processContinuousSources(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    dt: number,
    gridDensity: FluidGrid | null = null,
  ): void {
    // 总开关关闭时暂停所有持续注入源（但保留源列表，重新开启后自动恢复）
    if (!this.continuousInjectionEnabled) return;
    if (this.continuousSources.length === 0) return;

    // ★ 初速度调试：节流日志（每 30 帧打印一次），记录每帧初速度应用情况
    this._velDebugFrameCounter++;
    const shouldLog = this._velDebugFrameCounter % 30 === 0;

    for (const src of this.continuousSources) {
      if (shouldLog) {
        const c = src.config;
        console.log(`[初速度] 每帧应用 源#${src.id}: 速度=(${c.velocity.x.toFixed(2)},${c.velocity.y.toFixed(2)}) px/s (直接注入，不乘dt), dt=${dt.toFixed(4)}s`);
      }
      this.applyInjection(gridColor, gridVelocity, dt, src.config, gridDensity);
    }
  }

  /**
   * 执行一次独立的注入（一次性注入，忽略 rate，直接覆盖/叠加）。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param config 注入源配置（纹理坐标）
   * @param gridDensity density 网格（scalar 模式传入，vector 模式传 null）
   */
  private applyOneShotInjection(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    config: InjectionConfig,
    gridDensity: FluidGrid | null = null,
  ): void {
    if (!config.enabled) return;

    const pos: InjectionOptions = {
      position: { x: config.position.x, y: config.position.y },
      radius: config.radius,
    };

    // 1. 颜色注入（直接设为目标值，混合率 1.0）
    this.injector.injectColor(
      gridColor,
      {
        h: config.color[0],
        s: config.color[1],
        l: config.color[2],
        a: config.color[3],
      },
      1.0,
      pos,
    );

    // 2. 速度注入（一次性注入：瞬时冲量，不乘 dt）
    //    一次性注入只执行一次，不会累加爆炸，直接注入速度值即可。
    //    持续注入才会乘 dt 防止累加（见 applyInjection）。
    this.injector.injectVelocity(
      gridVelocity,
      { x: config.velocity.x, y: config.velocity.y },
      pos,
    );

    // ★ 3. density 注入（MCSDA scalar 模式）：config.density 有值且 gridDensity 非 null 时注入
    if (gridDensity && config.density !== undefined) {
      this.injector.injectDensity(gridDensity, config.density, 1.0, pos);
    }
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
   * ⚠️ 速度注入语义：
   *   config.velocity 单位为 px/s，乘以 dt 后为每帧速度增量（px），
   *   与重力（gravity * dt）物理语义一致。
   *   持续注入时每帧累加 velocity * dt，相当于加速度为 velocity 的持续推动。
   *   不会无限制累加爆炸——后续由 clampVelocity 全局限幅。
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
    gridDensity: FluidGrid | null = null,
  ): void {
    if (!config.enabled) return;

    // ★ 颜色混合率直接使用 config.rate（不再乘以 dt），并限制在 [0,1]
    // 持续注入模式下，颜色需要迅速显现以形成稳定的"颜料源"效果，
    // 与一次性注入一致——每帧都以高混合率向目标色逼近。
    const rate = Math.min(1.0, Math.max(0.0, config.rate));

    // 位置和速度已通过接口适配层转换为纹理坐标，直接使用
    const texPos: InjectionOptions = {
      position: { x: config.position.x, y: config.position.y },
      radius: config.radius,
    };

    // 颜色注入（混合率直接使用 rate，立即显现）
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

    // ★ 速度注入（持续注入场景）：config.velocity 是速度值（px/s），
    //   乘以 dt 后为每帧速度增量（px），与重力（gravity * dt）物理语义一致。
    //   持续注入时每帧累加 velocity * dt，相当于加速度为 velocity 的持续推动。
    //   不会无限制累加爆炸——由 clampVelocity 全局限幅。
    this.injector.injectVelocity(
      gridVelocity,
      { x: config.velocity.x * dt, y: config.velocity.y * dt },
      texPos,
    );

    // ★ density 注入（MCSDA scalar 模式）：config.density 有值且 gridDensity 非 null 时注入
    //   持续注入场景下，density 也持续注入，形成稳定的浓度源
    if (gridDensity && config.density !== undefined) {
      this.injector.injectDensity(gridDensity, config.density, rate, texPos);
    }
  }

  // ==================== 速度限幅 ====================

  /**
   * 全局速度限幅。
   *
   * 遍历速度场，将所有速度矢量的长度限制在 maxSpeed 以内。
   * 防止持续注入、压力投影误差累积等导致的速度爆炸。
   *
   * @param gridVelocity 速度网格
   * @param maxSpeed 最大速度（px/s）
   */
  clampVelocity(gridVelocity: FluidGrid, maxSpeed: number): void {
    this.injector.clampVelocity(gridVelocity, maxSpeed);
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
