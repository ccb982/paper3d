import type * as THREE from 'three';
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
 *   2. 纹理坐标层（当前实现为直通，见下方分层规范）
 *
 * 分层规范：
 *   - UI/Editor 层使用用户接口坐标
 *   - FluidEditor.adaptInjectionConfig() 负责坐标转换
 *     ★ 当前为直通：位置（flipY=false，纹理 Y 向下为正）与速度
 *       （渲染链路已有 Y 翻转处理，取反会造成双重翻转）均无需转换。
 *   - FluidOperations 层只处理已转换（此处即原样）的坐标
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
  /**
   * ★ 波形控制：用复变函数（sin）驱动方向向量旋转。
   * 启用后注入速度方向会按正弦规律左右摆动，保留速度大小不变。
   */
  wave?: {
    enabled: boolean;
    amplitude: number;   // 弧度，最大偏移角（0~π/2）
    frequency: number;   // Hz，摆动频率
    phase?: number;      // 初始相位（弧度），默认 0
  };
  /**
   * ★ 路径点列表：注入源将按顺序在这些点之间移动。
   * 若提供此数组且长度 >= 2，则覆盖静态 position，源会巡游。
   */
  waypoints?: { x: number; y: number }[];
  /**
   * 路径移动模式：
   * - 'forward'：正向循环 (0->1->...->n-1->0)
   * - 'backward'：反向循环 (n-1->...->0->n-1)
   * - 'pingpong'：往返 (0->1->...->n-1->...->0->...)
   */
  waypointMode?: 'forward' | 'backward' | 'pingpong';
  /** 移动速度（航点/秒），默认 1.0 */
  waypointSpeed?: number;
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

  /** 障碍物掩码纹理（静态，只读），设为 null 时注入无墙体屏蔽 */
  private obstacleTexture: THREE.Texture | null = null;

  /** 设置障碍物掩码纹理（由 FluidEditor 在启用/禁用墙体模式时调用） */
  setObstacleTexture(tex: THREE.Texture | null): void {
    this.obstacleTexture = tex;
  }

  /** 待处理的单次注入队列（UI 交互的一次性注入） */
  private pendingInjections: InjectionConfig[] = [];

  /** 持续注入源列表（每帧都会执行，直到被移除） */
  private continuousSources: { id: number; config: InjectionConfig }[] = [];
  private nextSourceId = 1;

  /**
   * ★ 路径点运行时状态：记录每个源的当前逻辑步进、段内进度、插值位置。
   * key = sourceId，仅在源配置了 waypoints 时使用。
   */
  private waypointStates: Map<number, {
    logicalStep: number;
    progress: number;
    currentPosition: { x: number; y: number };
    lastWaypointCount: number;
  }> = new Map();

  /**
   * 持续注入总开关。
   * 关闭时暂停所有持续注入源的处理，但保留源列表（队列独立存在）。
   * 再次开启后，所有源自动恢复注入。
   */
  private continuousInjectionEnabled = false;

  /**
   * ★ 通道掩码：控制注入时哪些通道被修改。
   * false = 冻结（注入时不写入该通道，保持原值不变）。
   * 从 FluidEditor.config.channels 同步。
   */
  private channelMask: { r: boolean; g: boolean; b: boolean; a: boolean } = { r: true, g: true, b: true, a: true };

  /** 设置通道掩码（从 FluidEditor.config.channels 同步） */
  setChannelMask(mask: { r: boolean; g: boolean; b: boolean; a: boolean }): void {
    this.channelMask = mask;
  }

  constructor(injector: FluidInjector) {
    this.injector = injector;
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
    if (this.pendingInjections.length === 0) return;

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
      return false;
    } else {
      // ★ upsert 模式：源不存在时自动添加（防止编辑器重建后源丢失的问题）
      console.warn(`[初速度] 源 #${id} 不存在（当前源数=${this.continuousSources.length}），自动添加为新源`);
      const newId = this.nextSourceId++;
      this.continuousSources.push({ id: newId, config: { ...config } });
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
    this.waypointStates.delete(id);
  }

  /** 清除所有持续注入源 */
  public clearContinuousSources(): void {
    this.continuousSources = [];
    this.waypointStates.clear();
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
    wave?: InjectionConfig['wave'];
    waypoints?: { x: number; y: number }[];
    waypointMode?: 'forward' | 'backward' | 'pingpong';
    waypointSpeed?: number;
    density?: number;
    /** ★ 原始完整配置，供 UI 保留未显式暴露的扩展字段（如 density） */
    config: InjectionConfig;
  }[] {
    return this.continuousSources.map(s => {
      // 若启用了路径点，返回插值后的当前位置（而非静态 position）
      const wps = s.config.waypoints;
      const wpState = wps && wps.length >= 2 ? this.waypointStates.get(s.id) : undefined;
      const position = wpState
        ? { ...wpState.currentPosition }
        : { ...s.config.position };
      return {
        id: s.id,
        position,
        radius: s.config.radius,
        velocity: { ...s.config.velocity },
        color: [...s.config.color] as [number, number, number, number],
        rate: s.config.rate,
        enabled: s.config.enabled,
        wave: s.config.wave ? { ...s.config.wave } : undefined,
        waypoints: wps ? wps.map(p => ({ ...p })) : undefined,
        waypointMode: s.config.waypointMode,
        waypointSpeed: s.config.waypointSpeed,
        density: s.config.density,
        config: { ...s.config },
      };
    });
  }

  /**
   * 在每帧 step 中调用，处理所有活跃的持续注入源。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param dt 时间步长（秒）
   * @param gridDensity density 网格（MCSDA scalar 模式传入，vector 模式传 null）
   * @param time 当前模拟时间（秒），用于波形驱动的方向旋转
   */
  public processContinuousSources(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    dt: number,
    gridDensity: FluidGrid | null = null,
    time: number = 0,
  ): void {
    // 总开关关闭时暂停所有持续注入源（但保留源列表，重新开启后自动恢复）
    if (!this.continuousInjectionEnabled) return;
    if (this.continuousSources.length === 0) return;

    for (const src of this.continuousSources) {
      let config = src.config;

      // ========== ★ 路径点插值：覆盖 position ===========
      const waypoints = config.waypoints;
      if (waypoints && waypoints.length >= 2) {
        const mode = config.waypointMode || 'forward';
        const speed = config.waypointSpeed ?? 1.0;
        const total = waypoints.length;

        // 获取或初始化运行时状态
        let state = this.waypointStates.get(src.id);
        if (!state || state.lastWaypointCount !== total) {
          // 首次或航点数变化时重置
          const startPos = mode === 'backward' ? waypoints[total - 1] : waypoints[0];
          state = {
            logicalStep: 0,
            progress: 0,
            currentPosition: { ...startPos },
            lastWaypointCount: total,
          };
          this.waypointStates.set(src.id, state);
        }

        // 推进进度
        state.progress += dt * speed;
        while (state.progress >= 1.0) {
          state.progress -= 1.0;
          state.logicalStep++;
        }

        // 根据模式计算当前段的起止索引
        let idx0: number, idx1: number;
        if (mode === 'forward') {
          idx0 = ((state.logicalStep % total) + total) % total;
          idx1 = (idx0 + 1) % total;
        } else if (mode === 'backward') {
          idx0 = total - 1 - ((state.logicalStep % total) + total) % total;
          idx1 = total - 1 - (((state.logicalStep + 1) % total) + total) % total;
        } else { // pingpong
          const cycle = total > 1 ? (total - 1) * 2 : 1;
          const pos = ((state.logicalStep % cycle) + cycle) % cycle;
          if (pos < total - 1) {
            idx0 = pos;
            idx1 = pos + 1;
          } else {
            const rev = cycle - pos; // total-1 → 0
            idx0 = rev;
            idx1 = Math.max(0, rev - 1);
          }
        }

        const p0 = waypoints[idx0];
        const p1 = waypoints[idx1];
        const t = state.progress;
        state.currentPosition = {
          x: p0.x + (p1.x - p0.x) * t,
          y: p0.y + (p1.y - p0.y) * t,
        };

        // ★ NaN 防护：确保插值位置有效
        if (!isFinite(state.currentPosition.x) || !isFinite(state.currentPosition.y)) {
          state.currentPosition = { ...waypoints[0] };
        }

        // 用插值位置覆盖静态 position
        config = { ...config, position: { ...state.currentPosition } };
      }

      // ========== 波形控制：旋转速度方向 ==========
      if (config.wave?.enabled) {
        const { amplitude, frequency, phase = 0 } = config.wave;
        const speedMag = Math.hypot(config.velocity.x, config.velocity.y);
        // ★ NaN/Infinity 防护：确保 amplitude 和 frequency 有效，且速度非零
        if (isFinite(amplitude) && isFinite(frequency) && isFinite(speedMag) && speedMag > 0) {
          const angle = amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
          const baseAngle = Math.atan2(config.velocity.y, config.velocity.x);
          const newAngle = baseAngle + angle;
          config = {
            ...config,
            velocity: { x: speedMag * Math.cos(newAngle), y: speedMag * Math.sin(newAngle) },
          };
        }
      }

      this.applyInjection(gridColor, gridVelocity, dt, config, gridDensity);
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
      obstacle: this.obstacleTexture || undefined,
    };

    // 1. ★ 颜色注入：仅 vector 模式（gridDensity === null）
    //    scalar 模式下所有注入只影响 density 纹理，颜色纹理保持静态模板
    //    ★ 混合率 = config.rate（0~1，injector 内部钳制），rate 控制注入强度
    if (gridDensity === null) {
      this.injector.injectColor(
        gridColor,
        {
          h: config.color[0],
          s: config.color[1],
          l: config.color[2],
          a: config.color[3],
        },
        config.rate,
        pos,
        this.channelMask,
      );
    }

    // 2. 速度注入（一次性注入：瞬时冲量，不乘 dt）
    //    一次性注入只执行一次，不会累加爆炸，直接注入速度值即可。
    //    持续注入才会乘 dt 防止累加（见 applyInjection）。
    this.injector.injectVelocity(
      gridVelocity,
      { x: config.velocity.x, y: config.velocity.y },
      pos,
    );

    // ★ 3. density 注入（MCSDA scalar 模式）：config.density 有值且 gridDensity 非 null 时注入
    //    ★ 混合率 = config.rate（与颜色注入一致，统一受强度控制）
    if (gridDensity && config.density !== undefined) {
      this.injector.injectDensity(gridDensity, config.density, config.rate, pos);
    }
  }

  // ==================== 基础操作 ====================

  /**
   * 施加重力/全局力（二维矢量）。
   *
   * 对全局速度场注入一个持续加速度（force × dt），模拟"风向"或"全局力场"。
   *
   * @param grid 速度网格
   * @param dt 时间步长（秒）
   * @param force 加速度矢量（像素/秒²），屏幕坐标系：Y向下为正
   */
  applyGravity(grid: FluidGrid, dt: number, force: { x: number; y: number }): void {
    if (force.x === 0 && force.y === 0) return;

    // flipY=false: 正Y=向下，与用户坐标一致，直接注入
    this.injector.injectVelocity(
      grid,
      { x: force.x * dt, y: force.y * dt },
      { global: true, obstacle: this.obstacleTexture || undefined },
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
   * ★ 与单次注入（applyOneShotInjection）完全一致：
   *   - 颜色/density 混合率 = config.rate（0~1，injector 内部钳制）
   *   - 速度不乘 dt（每帧注入完整 velocity，等频等量）
   *   两者唯一差别只在调用时机：单次=按住每帧入队，持续=持久源每帧调用。
   *   速度累积由 clampVelocity 全局限幅兜底，不会爆炸。
   *
   * @param gridColor 颜色网格
   * @param gridVelocity 速度网格
   * @param _dt 时间步长（保留以匹配调用接口，当前实现不使用——与单次注入一致不乘 dt）
   * @param config 注入源配置（已转换为纹理坐标）
   */
  applyInjection(
    gridColor: FluidGrid,
    gridVelocity: FluidGrid,
    _dt: number,
    config: InjectionConfig,
    gridDensity: FluidGrid | null = null,
  ): void {
    if (!config.enabled) return;

    // ★ NaN/Infinity 防护：如果位置或速度无效，跳过注入
    if (!isFinite(config.position.x) || !isFinite(config.position.y)) return;
    if (!isFinite(config.velocity.x) || !isFinite(config.velocity.y)) return;

    // ★ 持续注入与单次注入完全一致：颜色/density 混合率 = config.rate、速度不乘 dt
    const texPos: InjectionOptions = {
      position: { x: config.position.x, y: config.position.y },
      radius: config.radius,
      obstacle: this.obstacleTexture || undefined,
    };

    // ★ 颜色注入：仅 vector 模式（gridDensity === null），混合率 = config.rate
    //   scalar 模式下所有注入只影响 density 纹理，颜色纹理保持静态模板
    if (gridDensity === null) {
      this.injector.injectColor(
        gridColor,
        {
          h: config.color[0],
          s: config.color[1],
          l: config.color[2],
          a: config.color[3],
        },
        config.rate,
        texPos,
        this.channelMask,
      );
    }

    // ★ 速度注入：不乘 dt，每帧注入完整 velocity（与单次注入等频等量）
    //   速度累积由 clampVelocity 全局限幅兜底，不会爆炸。
    this.injector.injectVelocity(
      gridVelocity,
      { x: config.velocity.x, y: config.velocity.y },
      texPos,
    );

    // ★ density 注入（MCSDA scalar 模式）：混合率 = config.rate，与颜色注入一致
    if (gridDensity && config.density !== undefined) {
      this.injector.injectDensity(gridDensity, config.density, config.rate, texPos);
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

  // ==================== 全局速度缩放 ====================

  /**
   * 全局速度缩放（无方向阻尼/加速）。
   *
   * 对整个速度场乘以标量 scale：
   *   - < 1：速度扣除（阻尼）
   *   - > 1：速度增加（加速）
   *   - = 1：无影响
   *
   * @param gridVelocity 速度网格
   * @param scale 缩放系数
   */
  scaleVelocity(gridVelocity: FluidGrid, scale: number): void {
    this.injector.scaleVelocity(gridVelocity, scale);
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
}