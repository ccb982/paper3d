import * as THREE from 'three';
import { FluidGrid } from '../core/FluidGrid';
import type { AdvectionMask } from '../core/FluidGrid';
import { AdvectionSolver } from '../solvers/AdvectionSolver';
import { LevelSetSolver } from '../solvers/LevelSetSolver';
import { GPUOps } from '../core/GPUOps';
import { FluidInjector } from '../core/FluidInjector';
import { FluidOperations, type InjectionConfig } from './FluidOperations';

// ============================================================
// 类型定义
// ============================================================

/**
 * 视口模式：
 * - 'color'：颜色场（HSL→RGB 直接显示）
 * - 'velocity'：速度场（HSV 方向色可视化）
 * - 'composite'：合成（底图 + 残差混合）
 * - 'density'：浓缩场（density 标量场灰度显示，仅 scalar 模式有意义）
 * - 'obstacle'：障碍物掩码（墙体灰白可视化）
 * - 'levelset'：Level Set φ 场（signed distance 可视化：红=内部/蓝=外部/白=零等值线）
 */
export type ViewMode = 'color' | 'velocity' | 'composite' | 'density' | 'obstacle' | 'levelset';

/** 速度场数据类型：'half-float'（16位半精度，显存减半）或 'float'（32位单精度，高精度） */
export type VelocityDataType = 'half-float' | 'float';

/**
 * HalfFloat（IEEE 754 binary16）→ Float32 解码。
 * 用于从 Uint16Array 回读 half-float 纹理时手动解码。
 * 
 * 格式（16 位）：
 *   bit 15    = 符号位（0=正, 1=负）
 *   bit 10-14 = 指数位（5位，偏移 15）
 *   bit 0-9   = 尾数位（10位，隐含前导 1）
 */
export function halfToFloat(half: number): number {
  const sign = (half >> 15) & 0x1;
  const exponent = (half >> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  // 零值或次正规数
  if (exponent === 0) {
    if (mantissa === 0) return sign ? -0 : 0;
    // 次正规数：(-1)^sign × 2^(-14) × (0.mantissa)
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
  }
  // 无穷或 NaN
  if (exponent === 31) {
    if (mantissa === 0) return sign ? -Infinity : Infinity;
    return NaN;
  }
  // 正规数：(-1)^sign × 2^(exponent-15) × (1 + mantissa/1024)
  const floatMantissa = mantissa / 1024;
  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + floatMantissa);
}

export interface FluidEditorConfig {
  resolution: { w: number; h: number };
  /** 逐通道平流开关（物理 RGBA，逻辑 HSLA：R=H, G=S, B=L, A=Alpha） */
  channels: { r: boolean; g: boolean; b: boolean; a: boolean };
  enableAdvection: boolean;
  enablePressure: boolean;
  /** 压力迭代次数（红-黑 SOR，每轮含红+黑两个 Pass） */
  pressureIterations: number;
  /** SOR 过松弛因子（1.5~1.8） */
  pressureOmega: number;
  /** 压力边界模式：'neumann'（零梯度，自由流出）或 'dirichlet'（固定压力=0，容器壁） */
  pressureBoundaryMode: 'dirichlet' | 'neumann';
  /** 是否启用压力热启动（用上一帧压力作为初始猜测，大幅减少迭代次数） */
  enableWarmStart: boolean;
  enableLevelSet: boolean;   // Level Set 总开关（驱动 phiGrid 创建/释放与 step 计算）
  /** 全局加速度/力（像素/秒²），二维矢量（屏幕坐标系，Y向下为正） */
  gravity: { x: number; y: number };
  /** 恒定注入源配置 */
  injection: {
    enabled: boolean;
    position: { x: number; y: number };  // 归一化 (0~1)，Y向下为正（0=顶部，1=底部）
    radius: number;                       // 归一化半径
    rate: number;                         // 每帧注入量 (0~1)
    velocity: { x: number; y: number };   // 注入速度（像素/秒），Y向下为正
    color: [number, number, number, number]; // RGBA
  };
  /** 颜色场平流边界模式：'clamp'（钳制）、'repeat'（重复）、'zero'（越界消失） */
  colorBoundaryMode?: 'clamp' | 'repeat' | 'zero';
  /** 速度场数据类型：'half-float'（16位半精度，显存减半）或 'float'（32位单精度，高精度） */
  velocityDataType?: VelocityDataType;
  /**
   * 全局速度限幅上限（px/s）。每帧 step 末尾对速度场做限幅，防止速度爆炸。
   * 设为 0 或 Infinity 表示禁用限幅。默认 5000。
   */
  maxVelocity?: number;

  /**
   * ★ 运动粘度 ν（cells²/s），0=无粘性（旧默认）。
   * 速度场显式扩散：∂v/∂t = ν∇²v —— 平滑剪切层/射流（小尺度结构衰减最快），
   * 保留大尺度运动 → 水团获得"内聚"手感。废弃模拟器同款机制（其 ν=1000 为动态粘度/密度）。
   */
  viscosity?: number;

  /**
   * 全局速度缩放因子（无方向标量）。
   *
   * 每帧 step 末尾对整个速度场乘以此系数：
   *   - 1.0：无影响（默认）
   *   - < 1.0：速度扣除（全局阻尼，流体逐渐减速）
   *   - > 1.0：速度增加（全局加速，流体逐渐加速）
   *
   * 不改变速度方向，仅缩放大小。可用于模拟粘性阻力或持续能量注入。
   * 与重力（有方向加速度）正交，可同时启用。
   */
  velocityScale?: number;

  /**
   * 平流模式：
   * - 'vector'（默认，旧模式）：4 通道颜色场（HSLA）参与平流，残差动态流动
   * - 'scalar'（标量浓度模式）：仅 1 通道 density 场平流，残差静态化，
   *   合成时用 density × 通道系数调制残差强度（MCSDA 方案）
   */
  advectionMode?: 'vector' | 'scalar';

  /**
   * 合成模式（仅 advectionMode='scalar' 时生效）。
   *
   * ★ 公式：final = base + delta ± (density/baseline × mul)
   *   - 'add'（默认）：final = base + delta + (factor × mul)
   *   - 'sub'：final = base + delta - (factor × mul)
   *
   * 残差增量 delta 直接叠加到基础色（不被 density 调制），
   * density/baseline × mul 作为独立偏移项，combineMode 控制其加减方向。
   */
  combineMode?: 'add' | 'sub';

  /**
   * 标量浓度模式配置（仅 advectionMode='scalar' 时生效）。
   *
   * ★ 数学模型：final = base + delta ± (density/baseline × mul)
   *   factor = density / baseline
   *   dH = (residualH × 2 - 1) × rangeH   // 残差解码为增量（与矢量模式相同）
   *   finalH = fract(baseH + dH + sign × factor × hMul)   // 色相环回绕
   *   finalS = clamp(baseS + dS + sign × factor × sMul, 0, 1)
   *   finalL = clamp(baseL + dL + sign × factor × lMul, 0, 1)
   *   finalA = clamp(baseA + dA + sign × factor × aMul, 0, 1)
   *   - delta 直接叠加（不被 density 调制），density×mul 是独立偏移项
   *   - density：1 通道 Uint8 动态场（0~1），参与平流
   *   - baseline：基准浓度，factor = density / baseline
   *     density < baseline → factor<1，偏移项小（削弱）
   *     density > baseline → factor>1，偏移项大（增强）
   *     density = 0 → 无偏移（只显示 base + delta）
   *   - mul：各通道系数（UI 范围 -0.2~0.2，step 0.0001 精细控制；shader 不钳制，键盘可输入更大值），控制 density 偏移的方向和强度
   *   - sign：combineMode='add' 时 +1，'sub' 时 -1
   */
  scalarConfig?: {
    hMultiplier: number;     // 色相系数，默认 0.1，UI 范围 -0.2~0.2（step 0.0001）
    sMultiplier: number;     // 饱和度系数，默认 0.1
    lMultiplier: number;     // 明度系数，默认 0.1
    aMultiplier: number;     // 透明度系数，默认 0.1
    baselineDensity: number; // 基准浓度，默认 1.0，UI 范围 0.001~1.0（step 0.0001）
    decayRate: number;       // 衰减速率，默认 0，范围 0~0.99（每帧 density *= 1-decayRate，step 0.0001）
  };

  /**
   * Level Set 模块配置（轻量化，默认关闭，热插拔）。
   * 仅当 enableLevelSet=true 时生效：创建 phiGrid 并在 step 中执行
   *   φ 平流 → 周期性重初始化 → 表面张力注入（CSF 模型）。
   * φ 场初始化来源：scalar 模式取 densityGrid.R，vector 模式取 colorGrid.A。
   */
  levelSetConfig?: {
    /** 重初始化间隔（帧数）：每 N 帧执行一次「φ 重建 + reinit」，默认 10 */
    reinitInterval: number;
    /** 每次重初始化的迭代次数（Godunov 上风轮数），默认 2 */
    reinitIterations: number;
    /** 表面张力系数 σ（0=禁用张力），默认 0 */
    surfaceTension: number;
    /** 窄带宽度/作用半径（像素），表面张力仅在 |φ|<radius 区域施力，默认 5 */
    narrowBandWidth: number;
    /** ★ φ 直接约束液体（外部渐隐 → 液体紧凑圆润）；默认 false */
    constrainLiquid?: boolean;
    /** ★ 空气区 φ 钳制（φ>maxAirPhi 压回，防空气泄漏进水） */
    clampAirPhi?: boolean;
    /** 空气区 φ 上限（默认 0 = 空气区压到 0） */
    maxAirPhi?: number;
    /** ★ 水体区负向补偿（φ<0 向负推进，防水体流失） */
    compensateWaterPhi?: boolean;
    /** 水体补偿速率（像素/帧，默认 0.1） */
    waterCompensationRate?: number;
    /**
     * ★ 外向速度抑制（0~1，默认 0=关闭）：界面窄带内削减指向空气侧的法向速度。
     * 确定性收拢保证——不依赖张力符号与 φ 噪声质量。1=界面完全不可外扩。
     */
    outwardDamping?: number;
  };

  /**
   * 障碍物（墙体）开关。
   * 启用后，可通过画笔在 obstacleGrid 上涂抹墙体，
   * 流体无法穿墙（平流被拦截、压力归零、注入被屏蔽）。
   * 关闭时自动释放 obstacleGrid 显存。
   */
  enableObstacles?: boolean;
}

// ============================================================
// FluidEditor —— 核心管理层（第3层）
// ============================================================

/**
 * FluidEditor 是流体模拟的"指挥中心"，持有所有场和求解器。
 *
 * 每帧流程（step）：
 *   重力 → 注入源 → 速度自平流 → 颜色平流 → 边界处理 → 压力投影
 *
 * 架构：
 *   - 注入操作委托给 FluidOperations（第2层），
 *     FluidOperations 内部调用 FluidInjector（第1层）的原子注入函数。
 *   - 平流/边界/压力等非注入 Pass 直接使用 this.gpu，不经过注入器。
 *
 * 使用方式：
 *   const editor = new FluidEditor(renderer, config);
 *   editor.step(dt);  // 每帧调用
 *   const tex = editor.getColorTexture();  // 获取当前颜色纹理
 */
export class FluidEditor {
  private renderer: THREE.WebGLRenderer;
  private gpu: GPUOps;
  private injector: FluidInjector;
  private operations: FluidOperations;

  /** 可变的配置引用（通过 updateConfig 更新） */
  config: FluidEditorConfig;

  // 场
  colorGrid!: FluidGrid;
  velocityGrid!: FluidGrid;
  pressureGrid!: FluidGrid;   // 单通道、half-float，用于红-黑 SOR 压力迭代
  /** ★ 散度源场（爆炸/源汇的压力方程源项；solvePressure 前注入、消费后清空） */
  divergenceGrid!: FluidGrid;
  /** ★ MCSDA 标量浓度场：1 通道 Uint8（RedFormat），仅 advectionMode='scalar' 时参与平流 */
  densityGrid!: FluidGrid;

  /**
   * ★ 障碍物（墙体）掩码纹理 —— 静态单通道 Uint8（RedFormat + NearestFilter）。
   * 0=流体（空），255=墙体（满）。不需要 swap/ping-pong，墙体是静态的。
   * 仅当 enableObstacles=true 时创建；关闭时使用 dummyWhiteTex 代替。
   */
  private obstacleTarget: THREE.WebGLRenderTarget | null = null;
  /** 障碍物临时副本（用于绘制时 copy-before-draw，避免读写同一纹理） */
  private obstacleTempTarget: THREE.WebGLRenderTarget | null = null;
  /** 1×1 白色哑纹理，用于障碍物关闭时替代 obstacleTarget 传入各着色器 */
  private dummyObstacleTex: THREE.DataTexture | null = null;

  // 求解器
  private advectionSolver: AdvectionSolver;
  /** Level Set 求解器（φ 平流/重初始化/表面张力，热插拔） */
  private levelSetSolver: LevelSetSolver;
  /** ★ 爆炸限幅覆盖（velCap）：抬升值 / 保持截止时刻 / 回落完成时刻（this.time 秒） */
  private velCapOverride: { value: number; until: number; recoverUntil: number } | null = null;
  /** Level Set φ 场（1 通道 half-float，懒加载，enableLevelSet=true 时创建） */
  private _phiGrid: FluidGrid | null = null;
  /** ★ 残差模板缓存（initializeColorFromImageData 时深拷贝）——
   *   分辨率/速度场精度切换会 rebuildGrids + initFields（colorGrid 清空），
   *   重建后自动重新上传，否则残差纹理丢失 */
  private _pendingResidualImage: ImageData | null = null;
  /** reinit 间隔帧数计数器（每 reinitInterval 帧执行一次重初始化） */
  private levelSetFrameCount = 0;

  // 时间（秒）
  private time = 0;

  // 帧计数（用于调试）
  private frameCount = 0;

  // 复用像素缓冲区，避免每帧分配
  private pixelBuffer: Uint8Array | null = null;

  constructor(renderer: THREE.WebGLRenderer, config: FluidEditorConfig) {
    this.renderer = renderer;
    this.config = { ...config };

    this.gpu = new GPUOps();
    this.injector = new FluidInjector(renderer, this.gpu);
    this.operations = new FluidOperations(this.injector);
    // ★ 初始化通道掩码（注入时冻结未勾选的通道）
    this.operations.setChannelMask(this.config.channels);

    this.advectionSolver = new AdvectionSolver(renderer);
    this.levelSetSolver = new LevelSetSolver(renderer, this.gpu);

    this.rebuildGrids();

    this.initFields();

  }

  // ==================== 配置更新 ====================

  /**
   * 运行时更新配置。如果分辨率变化则重建纹理网格。
   * 重建后立即调用 initFields() 清空新纹理，防止 WebGL 错误 1282（未初始化纹理）。
   */
  updateConfig(updates: Partial<FluidEditorConfig>): void {
    if (updates.resolution) {
      console.log('[FluidEditor.updateConfig] resolution 更新:', updates.resolution.w, 'x', updates.resolution.h, '(当前:', this.config.resolution.w, 'x', this.config.resolution.h, ')');
    }
    const oldRes = this.config.resolution;
    const oldVelType = this.config.velocityDataType;
    const oldEnableObstacles = this.config.enableObstacles;
    const oldEnableLevelSet = this.config.enableLevelSet;
    const oldChannels = { ...this.config.channels };
    Object.assign(this.config, updates);

    // ★ 同步通道掩码到 FluidOperations（注入时冻结未勾选的通道）
    if (updates.channels) {
      this.operations.setChannelMask(this.config.channels);
      // ★ 取消勾选的通道：恢复默认残差模板值（该通道回归导入时的静态残差，
      //   勾选的通道保持当前流动状态）
      const restoreMask = {
        r: oldChannels.r && !this.config.channels.r,
        g: oldChannels.g && !this.config.channels.g,
        b: oldChannels.b && !this.config.channels.b,
        a: oldChannels.a && !this.config.channels.a,
      };
      if (restoreMask.r || restoreMask.g || restoreMask.b || restoreMask.a) {
        this.restoreChannelsFromTemplate(restoreMask);
      }
    }

    const resChanged =
      updates.resolution &&
      (updates.resolution.w !== oldRes.w || updates.resolution.h !== oldRes.h);
    const velTypeChanged =
      updates.velocityDataType && updates.velocityDataType !== oldVelType;

    // ★ 处理障碍物开关变化
    if (updates.enableObstacles !== undefined && updates.enableObstacles !== oldEnableObstacles) {
      if (updates.enableObstacles) {
        this.enableObstaclesMode();
      } else {
        this.disableObstaclesMode();
      }
    }

    // ★ 处理 Level Set 开关变化（热插拔 phiGrid）
    if (updates.enableLevelSet !== undefined && updates.enableLevelSet !== oldEnableLevelSet) {
      if (updates.enableLevelSet) {
        this.enableLevelSetMode();
      } else {
        this.disableLevelSetMode();
      }
    }

    // ★ 分辨率变化时重建障碍物目标（如果已启用）
    if (resChanged && this.config.enableObstacles && this.obstacleTarget) {
      this.recreateObstacleTarget();
    }

    if (resChanged || velTypeChanged) {
      this.rebuildGrids();
      // ★ 重建纹理后必须立即 initFields()，否则新纹理没有初始化数据，
      // 后续 injectColor/injectVelocity 等操作会触发 WebGL INVALID_OPERATION (1282)
      //   initFields 内部自动恢复残差模板（_pendingResidualImage）
      this.initFields();
    }

    // ★ 分辨率变化时 rebuildGrids() 会释放 _phiGrid 并置 null。
    // 若 LevelSet 仍启用，此处重建 phiGrid，避免 LevelSet 静默失效
    // （enableLevelSetMode 内部已做存在性检查，重复调用安全）。
    if (resChanged && this.config.enableLevelSet) {
      this.enableLevelSetMode();
    }
  }

  // ==================== 接口适配层 ====================
  // 职责：将用户接口坐标转换为底层纹理坐标
  // 用户约定：Y向下为正（0=顶部，1=底部）
  // ★ 当前实现为直通（不做任何取反/翻转）：
  //   - 位置：flipY=false 使纹理 Y 向下为正，与用户坐标系一致，无需转换
  //   - 速度：渲染链路中 Y 方向已有翻转处理，此处再取反会造成双重翻转
  //     （历史上因此出现过注入初速度方向反了的 bug，切勿恢复取反）

  /**
   * 将用户接口的注入配置转换为底层纹理坐标的配置。
   * 这是唯一的坐标转换入口，Operations 层和 Injector 层不关心坐标系。
   */
  private adaptInjectionConfig(config: InjectionConfig): InjectionConfig {
    const adapted: InjectionConfig = {
      ...config,
      // 位置：Y向下为正，纹理坐标也Y向下为正（因为flipY=false），无需转换
      position: { x: config.position.x, y: config.position.y },
      // ★ 速度：用户反馈两种数据类型下注入初速度方向都反了，
      //   仅对注入初速度方向取反修复——移除原先的 Y 取反，让速度直接透传。
      //   （纹理渲染链路中 Y 方向已有翻转处理，此处再取反会导致双重翻转）
      velocity: { x: config.velocity.x, y: config.velocity.y },
    };
    return adapted;
  }

  // ==================== 每帧更新 ====================

  /**
   * 将一次注入操作加入队列，下一帧 step 时执行。
   * 这是 UI 交互的唯一安全入口（避免与渲染循环竞争纹理交换）。
   *
   * @param config 注入源配置（用户接口坐标，Y向下为正）
   */
  public queueInjection(config: InjectionConfig): void {
    // ★ 接口适配层：将用户坐标转换为纹理坐标
    const adaptedConfig = this.adaptInjectionConfig(config);
    // ★ 委托给 operations 管理队列
    this.operations.queueInjection(adaptedConfig);
  }

  /**
   * ★ 爆炸注入（参照旧库 explode）：散度脉冲 + 水量 + 时间包络 + 各向异性/扰动。
   * 参数均为纹理坐标（归一化 0~1，Y向下为正），与 queueInjection 一致。
   * config.velCap：爆炸期间临时抬升全局速度上限（见 ExplosionConfig 注释）。
   */
  public explode(config: import('../FluidSolver').ExplosionConfig): void {
    this.operations.explode(config);
    // ★ 限幅联动：爆炸瞬间抬升速度上限，包络结束后自动回落——
    //   否则日常限幅（如 50px/s）会把冲击冲量当场钳死，只见膨胀不见飞散
    if (config.velCap && config.velCap > 0) {
      const dur = config.velCapDuration ?? (config.duration ?? 0.1) + 0.5;
      const recovery = config.velCapRecovery ?? 1.5;
      this.velCapOverride = {
        value: config.velCap,
        until: this.time + dur,
        recoverUntil: this.time + dur + recovery,
      };
    }
  }

  /**
   * 设置持续注入源（替换旧的 config.injection 方式）。
   * 新增一个持续注入源，每帧自动执行，直到移除。
   *
   * @param config 注入源配置（用户接口坐标，Y向下为正）
   * @returns 源 ID（用于后续更新或移除）
   */
  public addContinuousInjection(config: InjectionConfig): number {
    const adaptedConfig = this.adaptInjectionConfig(config);
    return this.operations.addContinuousSource(adaptedConfig);
  }

  /**
   * 更新持续注入源参数（upsert 模式：不存在则自动添加新源）。
   *
   * @param id 源 ID（来自 addContinuousInjection 返回值）
   * @param config 新的注入配置（用户接口坐标）
   * @returns 实际使用的源 ID（如果是 upsert 添加，会返回新 ID）
   */
  public updateContinuousInjection(id: number, config: InjectionConfig): number {
    const adaptedConfig = this.adaptInjectionConfig(config);
    const wasAdded = this.operations.updateContinuousSource(id, adaptedConfig);
    // 如果是 upsert 添加（ID 变了），需要返回新 ID 供 UI 更新引用
    if (wasAdded) {
      const sources = this.operations.getContinuousSourcesSnapshot();
      const latestId = sources.length > 0 ? sources[sources.length - 1].id : id;
      return latestId;
    }
    return id;
  }

  /** 移除指定持续注入源 */
  public removeContinuousInjection(id: number): void {
    this.operations.removeContinuousSource(id);
  }

  /** 清除所有持续注入源 */
  public clearContinuousInjections(): void {
    this.operations.clearContinuousSources();
  }

  /**
   * 设置持续注入总开关。
   * 关闭时暂停所有持续注入源的处理，但保留源列表（队列独立存在），
   * 再次开启后所有源自动恢复注入。
   *
   * @param enabled 是否启用持续注入
   */
  public setContinuousInjectionEnabled(enabled: boolean): void {
    this.operations.setContinuousInjectionEnabled(enabled);
  }

  /** 获取当前活跃的持续注入源数量 */
  public get continuousSourceCount(): number {
    return this.operations.continuousSourceCount;
  }

  /**
   * 获取所有持续注入源的快照（用于 UI 可视化绘制注入点位置和半径）。
   * 注意：返回的位置/速度已经是纹理坐标（adaptInjectionConfig 转换后）。
   * 纹理坐标系下 Y 向上为正（速度），但位置 Y 与用户坐标系一致（flipY=false）。
   */
  public getContinuousSources() {
    return this.operations.getContinuousSourcesSnapshot();
  }

  /**
   * 将颜色纹理通过掩码混合注入到颜色场中。
   * 用于"残差印章"模式：从 FTX 原始残差纹理采样生成的 colorTex，
   * 按 maskTex 指定的区域（白色=注入），以 rate 为混合率写入颜色场。
   *
   * @param colorTex 要注入的颜色纹理（RGBA, uint8）
   * @param maskTex 掩码纹理（R通道：0=不注入，255=完全注入）
   * @param rate 混合率 [0,1]，默认 1.0（完全覆盖）
   */
  public injectColorTexture(
    colorTex: THREE.Texture,
    maskTex: THREE.Texture,
    rate: number = 1.0,
  ): void {
    this.injector.injectColorTexture(this.colorGrid, colorTex, maskTex, rate);
  }

  /** 执行一帧模拟 */
  step(dt: number): void {
    if (dt <= 0) return;

    this.frameCount++;

    // ★ 同步障碍物纹理到 operations（注入屏蔽）
    this.operations.setObstacleTexture(this.getObstacleTexture());

    // ★ 0. 处理 UI 注入队列（优先执行，确保本帧生效）
    // 委托给 operations 处理一次性注入
    // ★ MCSDA：scalar 模式下传入 densityGrid，使带 density 字段的注入能写入浓度场
    const _gridDensity = this.config.advectionMode === 'scalar' ? this.densityGrid : null;
    this.operations.processQueue(this.colorGrid, this.velocityGrid, dt, _gridDensity);

    // 0. 重力（通过操作模块 → 底层注入器，二维矢量全局力）
    const g = this.config.gravity;
    if (g.x !== 0 || g.y !== 0) {
      this.operations.applyGravity(this.velocityGrid, dt, g);
    }

    // 1. 持续注入源（通过 operations 的持久化源列表，不依赖 React state）
    this.operations.processContinuousSources(this.colorGrid, this.velocityGrid, dt, _gridDensity, this.time);

    // 2. 平流（非注入 Pass，直接使用 this.gpu）
    if (this.config.enableAdvection) {
      this.advectVelocity(dt);
      // ★ MCSDA 模式分支：
      //   - 'vector'（旧模式）：平流 4 通道颜色场（HSLA delta），合成=base+delta
      //   - 'scalar'（标量浓度）：颜色纹理 = 静态模板（不注入、不平流），
      //     仅平流 1 通道 density 场 + 衰减，合成 = base + static_delta ± (flowing_density × mul)
      //   ★ scalar 模式下所有注入只影响 density，颜色保持预加载的静态模板。
      //     density 流动提供动态浓度调制（基准削弱/增强 + 通道系数）。
      if (this.config.advectionMode === 'scalar') {
        this.advectDensity(dt);
        this.decayDensity();
      } else {
        this.advectColor(dt);
      }
    }

    // 2.45 ★ Level Set 表面张力（CSF）——必须在压力投影【之前】施加（废弃模拟器的验证顺序）：
    //   张力在界面窄带产生散度速度 → 随后的压力投影把它转化为整体不可压缩向心流动，
    //   水团才能向内收缩成团。放在投影之后（旧实现）则张力速度不参与投影，
    //   直接被平流消费 → 只会把颜色抹开，σ 拉到多大都看不见。
    if (this.config.enableLevelSet && this._phiGrid) {
      const st = this.config.levelSetConfig?.surfaceTension ?? 0;
      // ★ σ 允许取负：shader 里 F=-σκδn̂，σ>0=向内收缩（水团），σ<0=向外扩散（爆裂/雾化）
      if (st !== 0) {
        const band = this.config.levelSetConfig?.narrowBandWidth ?? 5;
        this.levelSetSolver.applySurfaceTension(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTexture(), st, dt, band,
        );
      }
    }

    // 2.46 ★ 粘度（速度场扩散 ν∇²v）——力相，压力投影之前：
    //   抹平剪切层/射流（小尺度结构衰减最快），保留大尺度运动 → 水团内聚不散花
    this.applyViscosity(dt);

    // 2.5 边界处理 —— 移到压力投影之前，避免与压力梯度修正拮抗
    this.applyBoundary();

    // 2.6 ★ 爆炸散度源注入（压力投影之前：∇²p = ∇·u + f，散度源成为压力源 →
    //   压力梯度推动流体向外 → 真正的爆炸推力/水体撕裂）
    this.operations.processExplosions(this.colorGrid, this.velocityGrid, dt, _gridDensity, this.divergenceGrid);

    // 3. 压力投影（红-黑 SOR；消费散度源）
    if (this.config.enablePressure) {
      // ★ 自由表面边界：Level Set 启用时，压力只在液体内部（φ<0）求解，
      //   空气区压力恒为 0 —— 液体成为有表面的不可压缩整体（废弃模拟器的真实感核心）：
      //   注入动量推动的是整块水而非染色剂，表面像一层膜约束着体积。
      const fsPhi = (this.config.enableLevelSet && this._phiGrid)
        ? this._phiGrid.read : null;
      this.solvePressure(this.config.pressureIterations, this.config.pressureOmega, fsPhi);
      this.applyPressureGradient();
    }

    // 3.1 ★ 清空散度源场（一次性消费；不参与平流/衰减）
    this.clearGrid(this.divergenceGrid);

    // ★ 3.5 全局速度缩放（无方向阻尼/加速，压力投影之后）
    // velocityScale = 1 表示无影响（默认）；< 1 阻尼减速，> 1 加速
    const velScale = this.config.velocityScale ?? 1;
    if (velScale !== 1) {
      this.operations.scaleVelocity(this.velocityGrid, velScale);
    }

    // ★ 3.6 全局速度限幅（缩放之后，防止加速导致爆炸）
    // 防止持续注入、误差累积导致的速度爆炸
    // maxVelocity = 0 或 Infinity 表示禁用限幅
    // ★ 爆炸限幅覆盖：velCap 抬升 → 保持 → smoothstep 平滑回落（避免瞬时回正
    //   把飞散中的水团"撞墙式"钳停，速度骤降在视觉上等于一次急刹）
    let maxVel = this.config.maxVelocity ?? 5000;
    const capOv = this.velCapOverride;
    if (capOv) {
      if (this.time < capOv.until) {
        // 保持期：全速抬升
        maxVel = Math.max(maxVel, capOv.value);
      } else if (this.time < capOv.recoverUntil) {
        // 回落期：smoothstep 缓动 value → 配置值
        const t = (this.time - capOv.until) / Math.max(1e-6, capOv.recoverUntil - capOv.until);
        const s = t * t * (3.0 - 2.0 * t);
        maxVel = Math.max(maxVel, capOv.value + (maxVel - capOv.value) * s);
      } else {
        this.velCapOverride = null;
      }
    }
    if (maxVel > 0 && isFinite(maxVel)) {
      this.operations.clampVelocity(this.velocityGrid, maxVel);
    }

    // 3.7 ★ 外向速度抑制（确定性收拢，与张力符号/φ噪声无关）：
    //   界面窄带内削掉指向空气侧的法向速度 → 水团只可能收、不可能散。
    //   放在限幅后：本帧用于平流的最终速度场已无外扩分量。
    if (this.config.enableLevelSet && this._phiGrid) {
      const od = this.config.levelSetConfig?.outwardDamping ?? 0;
      if (od > 0) {
        this.levelSetSolver.applyOutwardVelDamping(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTexture(),
          this.config.levelSetConfig?.narrowBandWidth ?? 5, od,
        );
      }
    }

    // 4. ★ Level Set 模块（热插拔，仅启用且 phiGrid 已初始化时执行）
    //    两种模式：
    //      A. 约束模式（constrainLiquid=true）→ 每帧「φ 重建 + reinit + 约束」：
    //         φ 始终与当前液体同步，液体被持续收拢成紧凑圆润团块（稳定水感）
    //      B. 追踪模式（默认）→ φ 平流 + 周期性重建 + 表面张力
    if (this.config.enableLevelSet && this._phiGrid) {
      const lsCfg = this.config.levelSetConfig;
      const band = lsCfg?.narrowBandWidth ?? 5;
      const constrain = lsCfg?.constrainLiquid ?? false;
      const iterations = lsCfg?.reinitIterations ?? 2;

      if (constrain) {
        // ★ 约束模式：每帧从当前液体场重建 φ（注入即同步）+ Godunov reinit + 约束
        this.initPhiField();
        this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTexture(), iterations, 0.5);
        // φ 后处理（空气钳制 + 水体补偿）：修正符号平衡，防水泄漏/流失
        this.applyPhiCorrection();
        // ★ 去斑：补洞+拔刺 —— alpha 噪声像素经阈值/clamp 变成孤立翻转点，
        //   渲染 discard 出黑点、法线畸变出白点（见 debugReadPhi 指标①②）
        this.levelSetSolver.applyDespeckle(this._phiGrid, this.getObstacleTexture());
        const mode = this.config.advectionMode === 'scalar' ? 0 : 1;
        const targetGrid = this.config.advectionMode === 'scalar' ? this.densityGrid : this.colorGrid;
        this.levelSetSolver.applyLiquidConstraint(
          targetGrid, this._phiGrid.read, this.getObstacleTexture(), mode, band, 0.02,
        );
      } else {
        // (1) φ 平流（跟随速度场流动）
        this.levelSetSolver.advectPhi(
          this._phiGrid, this.velocityGrid.read, dt, this.getObstacleTexture(),
        );
        // (2) 周期性「φ 重建 + Godunov 重初始化」
        //   ★ 注入同步：先用当前 density/alpha 场重建 φ 初值（注入的新液体才有表面），
        //     再 Godunov 上风重初始化（保持 |∇φ|≈1，距离场真正收敛）
        this.levelSetFrameCount++;
        const interval = lsCfg?.reinitInterval ?? 10;
        if (this.levelSetFrameCount >= interval) {
          this.levelSetFrameCount = 0;
          this.initPhiField();
          this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTexture(), iterations, 0.5);
          this.applyPhiCorrection();
          this.levelSetSolver.applyDespeckle(this._phiGrid, this.getObstacleTexture());
          console.log(`[LevelSet] 注入同步 + reinit @ frame ${this.frameCount}：interval=${interval}，iterations=${iterations}`);
        }
      }

      // ★ 表面张力已移至 step() 的压力投影之前（见 2.45）：
      //   先施力后投影，张力的散度才会被压力求解转化为整体向心流动。
    }

    this.time += dt;
  }

  // ==================== GPU Pass 实现 ====================

  /**
   * 速度自平流。
   *
   * ★ 使用 CFL（Courant-Friedrichs-Lewy）条件动态计算子步数：
   *   subSteps = ceil(maxSpeed * dt / minGridSpacing)
   *
   * 确保每个子步内像素回溯距离 ≤ 1 个网格单元，避免：
   *   1. 薄墙穿透：高速像素跳过细窄边界
   *   2. 离散采样缺陷：反向追踪越过细节特征
   *   3. 重力为 0 时的盲区：原方案仅依赖重力计算 subSteps，无重力时高速注入会失稳
   *
   * maxSpeed 取自 config.maxVelocity（速度限幅上限）——这是当前帧速度的硬上界，
   * 无需采样速度场即可保证 CFL 满足。
   */
  private advectVelocity(dt: number): void {
    const mask: AdvectionMask = { r: true, g: true, b: false, a: false };

    // 1. 基于速度的 CFL 子步（主要稳定性保障）
    //    使用限幅值作为最大可能速度（当前帧速度场的硬上界）
    const maxPossibleSpeed = this.config.maxVelocity && this.config.maxVelocity > 0
      ? this.config.maxVelocity
      : 5000;
    const minGridSpacing = Math.min(this.config.resolution.w, this.config.resolution.h);
    const cflSubSteps = Math.ceil((maxPossibleSpeed * dt) / minGridSpacing);

    // 2. 兼顾重力的子步（重力很大时也需要分步）
    const g = this.config.gravity;
    const gMag = Math.sqrt(g.x * g.x + g.y * g.y);
    const gravitySubSteps = Math.ceil(gMag * dt / 50);

    // 3. 取两者较大值，至少为 1
    const subSteps = Math.max(1, Math.max(cflSubSteps, gravitySubSteps));

    this.advectionSolver.advect(
      this.velocityGrid,
      this.velocityGrid.read,
      dt,
      mask,
      // ★ wrapHue=false：速度场 R=vx（像素/秒），绝不能应用色相环包裹 fract，
      //   否则速度被截断到 [0,1) 导致横向速度清零。
      { boundaryMode: 'clamp', subSteps, wrapHue: false, obstacleTexture: this.getObstacleTexture() },
    );
  }

  /** 颜色平流（掩码由 config.channels 决定） */
  private advectColor(dt: number): void {
    const ch = this.config.channels;
    const mask: AdvectionMask = { r: ch.r, g: ch.g, b: ch.b, a: ch.a };
    if (!mask.r && !mask.g && !mask.b && !mask.a) {
      return;
    }

    const boundaryMode = this.config.colorBoundaryMode || 'clamp';

    // ★ 颜色平流同样使用 CFL 条件，避免颜色穿透薄边界
    const maxPossibleSpeed = this.config.maxVelocity && this.config.maxVelocity > 0
      ? this.config.maxVelocity
      : 5000;
    const minGridSpacing = Math.min(this.config.resolution.w, this.config.resolution.h);
    const cflSubSteps = Math.ceil((maxPossibleSpeed * dt) / minGridSpacing);
    const g = this.config.gravity;
    const gMag = Math.sqrt(g.x * g.x + g.y * g.y);
    const gravitySubSteps = Math.ceil(gMag * dt / 50);
    const subSteps = Math.max(1, Math.max(cflSubSteps, gravitySubSteps));

    this.advectionSolver.advect(
      this.colorGrid,
      this.velocityGrid.read,
      dt,
      mask,
      // ★ wrapHue=true：颜色场 R=Hue（色相），需要 fract 色相环包裹，
      //   防止 Catmull-Rom 插值越界导致色相跳变。
      { boundaryMode, subSteps, wrapHue: true, obstacleTexture: this.getObstacleTexture() },
    );
  }

  // ==================== MCSDA 标量浓度平流（scalar 模式专用） ====================

  /**
   * density 场平流（MCSDA 核心动态场）。
   *
   * 复用 AdvectionSolver，mask 仅 R 通道（densityGrid 是单通道 RedFormat），
   * wrapHue=false（density 是 [0,1] 标量浓度，非色相，绝不能 fract 包裹）。
   * CFL 子步同 advectColor，保证高速流动时 density 不穿透薄边界。
   */
  private advectDensity(dt: number): void {
    const mask: AdvectionMask = { r: true, g: false, b: false, a: false };

    const maxPossibleSpeed = this.config.maxVelocity && this.config.maxVelocity > 0
      ? this.config.maxVelocity
      : 5000;
    const minGridSpacing = Math.min(this.config.resolution.w, this.config.resolution.h);
    const cflSubSteps = Math.ceil((maxPossibleSpeed * dt) / minGridSpacing);
    const g = this.config.gravity;
    const gMag = Math.sqrt(g.x * g.x + g.y * g.y);
    const gravitySubSteps = Math.ceil(gMag * dt / 50);
    const subSteps = Math.max(1, Math.max(cflSubSteps, gravitySubSteps));

    this.advectionSolver.advect(
      this.densityGrid,
      this.velocityGrid.read,
      dt,
      mask,
      // ★ wrapHue=false：density 是 [0,1] 标量浓度，fract 包裹会破坏浓度语义
      { boundaryMode: 'clamp', subSteps, wrapHue: false, obstacleTexture: this.getObstacleTexture() },
    );
  }

  /**
   * density 场衰减（MCSDA 浓度消散）。
   *
   * 每帧把 density 乘以 (1 - decayRate)，模拟颜料挥发/扩散损失。
   * decayRate=0 时跳过（无衰减），decayRate=0.1 时每帧损失 10%。
   * 范围限制 [0, 0.99] 防止一帧清零。
   */
  private decayDensity(): void {
    const decayRate = this.config.scalarConfig?.decayRate ?? 0;
    if (!decayRate || decayRate <= 0) return;
    const keep = Math.max(0.01, 1 - Math.min(0.99, decayRate));

    const mat = this.gpu.getMaterial('decayDensity', {
      uDensity: { value: this.densityGrid.read },
      uKeep: { value: keep },
    }, /* glsl */ `
      uniform sampler2D uDensity;
      uniform float uKeep;
      varying vec2 vUv;
      void main() {
        float d = texture2D(uDensity, vUv).r;
        gl_FragColor = vec4(d * uKeep, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.densityGrid.write, mat);
    this.densityGrid.swap();
  }

  /** 边界处理：零梯度边界，让速度场能自由流出（配合颜色边界 zero 模式实现水流消失） */
  private applyBoundary(): void {
    const { w, h } = this.config.resolution;

    const mat = this.gpu.getMaterial('boundary', {
      velTex: { value: this.velocityGrid.read },
      resolution: { value: new THREE.Vector2(w, h) },
    }, /* glsl */ `
      uniform sampler2D velTex;
      uniform vec2 resolution;
      varying vec2 vUv;
      void main() {
        vec2 vel = texture2D(velTex, vUv).rg;
        // ★ 分轴 eps：X/Y 分辨率不同时各用各的像素尺寸，避免非正方形网格边界判断偏移
        float epsX = 1.0 / resolution.x;
        float epsY = 1.0 / resolution.y;
        if (vUv.x < epsX) {
          vel = texture2D(velTex, vec2(vUv.x + epsX, vUv.y)).rg;
        } else if (vUv.x > 1.0 - epsX) {
          vel = texture2D(velTex, vec2(vUv.x - epsX, vUv.y)).rg;
        }
        if (vUv.y < epsY) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y + epsY)).rg;
        } else if (vUv.y > 1.0 - epsY) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y - epsY)).rg;
        }
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  /**
   * ★ 粘度：速度场显式扩散 ∂v/∂t = ν∇²v（h=1 cell，离散 Laplacian = 四邻和−4·自身）。
   *
   * 稳定性（von Neumann）：显式扩散要求 ν·dt/h² ≤ 0.25 → 超出时子步分摊，
   * 子步数上限 MAX_STEPS=64（ν≈770@60fps 内精确，超过后等效粘度饱和不失稳）。
   *
   * 效果：剪切层/射流等小尺度结构按 e^{−νk²t} 最快衰减，大尺度运动保留 → 内聚感。
   */
  private applyViscosity(dt: number): void {
    const nu = this.config.viscosity ?? 0;
    if (nu <= 0 || dt <= 0) return;

    const w = this.velocityGrid.resolution.w;
    const h = this.velocityGrid.resolution.h;
    const total = nu * dt;
    const MAX_DIFF = 0.2;   // 单步扩散稳定上限（<0.25）
    const MAX_STEPS = 64;   // 子步上限（性能护栏；放开到 64 支持大粘度自由调控）
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(total / MAX_DIFF)));
    const perStep = Math.min(MAX_DIFF, total / steps);

    const mat = this.gpu.getMaterial('editor_viscosity_v1', {
      uVelocity: { value: this.velocityGrid.read },
      uObstacle: { value: this.getObstacleTexture() },
      uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
      uDtNu: { value: perStep },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      uniform float uDtNu;
      varying vec2 vUv;
      void main() {
        // 墙内速度保持（与表面张力 pass 一致）
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }
        vec2 ts = uInvRes;
        vec2 vC = texture2D(uVelocity, vUv).rg;
        vec2 vL = texture2D(uVelocity, vUv - vec2(ts.x, 0.0)).rg;
        vec2 vR = texture2D(uVelocity, vUv + vec2(ts.x, 0.0)).rg;
        vec2 vB = texture2D(uVelocity, vUv - vec2(0.0, ts.y)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0, ts.y)).rg;
        vec2 vel = vC + uDtNu * (vL + vR + vT + vB - 4.0 * vC);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    for (let i = 0; i < steps; i++) {
      mat.uniforms.uVelocity.value = this.velocityGrid.read;  // swap 后刷新读取缓冲
      this.gpu.render(this.renderer, this.velocityGrid.write, mat);
      this.velocityGrid.swap();
    }
  }

  // ==================== 压力投影（红-黑 SOR） ====================

  /**
   * 红-黑 SOR 压力迭代。
   * 使用 checkerboard 模式交替更新红色和黑色像素，
   * 每次迭代包含红+黑两个 Pass，压力场为单通道半精度浮点纹理。
   *
   * @param iterations 迭代轮数（每轮含红+黑两个 Pass）
   * @param omega 过松弛因子（推荐 1.5~1.8）
   * @param phiTex 自由表面 φ 场（null=全域求解）：提供时压力只在 φ<0（液体）内求解，
   *               空气区压力恒 0 —— 自由表面边界条件（真实水感核心）
   */
  private solvePressure(iterations: number, omega: number, phiTex: THREE.Texture | null = null): void {
    const { w, h } = this.config.resolution;
    if (w === 0 || h === 0) return;

    // 热启动：仅在第一次（无历史值）或禁用热启动时清零
    // 启用热启动时，用上一帧的压力值作为初始猜测，收敛速度大幅提升
    if (!this.config.enableWarmStart) {
      this.clearGrid(this.pressureGrid);
    }

    for (let iter = 0; iter < iterations; iter++) {
      // Pass 1: 更新红色像素 ((x+y) 为奇数 = 红色)
      this.runSORPass('red', omega, phiTex);
      // Pass 2: 更新黑色像素 ((x+y) 为偶数 = 黑色)
      this.runSORPass('black', omega, phiTex);
    }
  }

  /**
   * 执行单次红或黑 Pass。
   * 着色器根据 uColor uniform 控制本轮更新红色还是黑色像素：
   *   isRed = (pos.x + pos.y) & 1  → 1=红色，0=黑色
   *   当 uColor=0 时，只更新 isRed==1（红色）的像素
   *   当 uColor=1 时，只更新 isRed==0（黑色）的像素
   * 不更新的像素直接直传旧值。
   */
  private runSORPass(color: 'red' | 'black', omega: number, phiTex: THREE.Texture | null): void {
    // ★ 自由表面模式用独立材质 key（shader 不同，避免缓存串扰）
    const key = phiTex ? `sor_${color}_fs` : `sor_${color}_obstacle`;
    const mat = this.gpu.getMaterial(key, {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uDivSource: { value: this.divergenceGrid.read },
      uObstacle: { value: this.getObstacleTexture() },
      uPhi: { value: phiTex ?? this.getObstacleTexture() },
      uPhiOn: { value: phiTex ? 1 : 0 },
      uInvResolution: { value: new THREE.Vector2(1.0 / this.config.resolution.w, 1.0 / this.config.resolution.h) },
      uOmega: { value: omega },
      uColor: { value: color === 'red' ? 0 : 1 },
      uBoundaryMode: { value: this.config.pressureBoundaryMode === 'dirichlet' ? 1 : 0 },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uDivSource;
      uniform sampler2D uObstacle;
      uniform sampler2D uPhi;
      uniform int uPhiOn;         // 1=自由表面边界（φ>0 的空气区压力恒 0）
      uniform vec2 uInvResolution;
      uniform float uOmega;
      uniform int uColor;
      uniform int uBoundaryMode;  // 0=Neumann(零梯度), 1=Dirichlet(固定p=0)
      varying vec2 vUv;

      void main() {
        // ★ 墙体像素：压力强制为 0（墙体是不可压缩的硬边界）
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }

        // ★ 自由表面：空气区（φ>0）压力强制为 0 —— 液体是有表面的不可压缩整体
        if (uPhiOn == 1 && texture2D(uPhi, vUv).r > 0.0) {
          gl_FragColor = vec4(0.0);
          return;
        }

        // Dirichlet 边界：边界像素压力固定为 0
        if (uBoundaryMode == 1) {
          if (vUv.x <= uInvResolution.x || vUv.x >= 1.0 - uInvResolution.x
           || vUv.y <= uInvResolution.y || vUv.y >= 1.0 - uInvResolution.y) {
            gl_FragColor = vec4(0.0);
            return;
          }
        }

        ivec2 pos = ivec2(vUv / uInvResolution);
        int isRed = (pos.x + pos.y) & 1;   // 1=红色, 0=黑色
        int target = 1 - uColor;            // uColor=0→target=1(红色), uColor=1→target=0(黑色)
        if (isRed != target) {
          // 不是本轮目标像素，直传旧值
          gl_FragColor = texture2D(uPressure, vUv);
          return;
        }

        vec2 ts = uInvResolution;

        // 采样四邻域压力（墙体邻居的压力视为 0）
        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;

        // ★ 邻居是墙体/空气（自由表面模式）时，该方向压力视为 0（硬边界）
        if (texture2D(uObstacle, vUv + vec2(-ts.x, 0.0)).r > 0.5) pL = 0.0;
        if (texture2D(uObstacle, vUv + vec2( ts.x, 0.0)).r > 0.5) pR = 0.0;
        if (texture2D(uObstacle, vUv + vec2(0.0,  ts.y)).r > 0.5) pT = 0.0;
        if (texture2D(uObstacle, vUv + vec2(0.0, -ts.y)).r > 0.5) pB = 0.0;
        if (uPhiOn == 1) {
          if (texture2D(uPhi, vUv + vec2(-ts.x, 0.0)).r > 0.0) pL = 0.0;
          if (texture2D(uPhi, vUv + vec2( ts.x, 0.0)).r > 0.0) pR = 0.0;
          if (texture2D(uPhi, vUv + vec2(0.0,  ts.y)).r > 0.0) pT = 0.0;
          if (texture2D(uPhi, vUv + vec2(0.0, -ts.y)).r > 0.0) pB = 0.0;
        }

        // 计算散度（中心差分）
        vec2 vR = texture2D(uVelocity, vUv + vec2( ts.x, 0.0)).rg;
        vec2 vL = texture2D(uVelocity, vUv + vec2(-ts.x, 0.0)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0,  ts.y)).rg;
        vec2 vB = texture2D(uVelocity, vUv + vec2(0.0, -ts.y)).rg;

        float div = (vR.x - vL.x) * 0.5 * uInvResolution.x
                  + (vT.y - vB.y) * 0.5 * uInvResolution.y;
        // ★ 散度源项：∇²p = ∇·u + f（爆炸/源汇；负散度源 → 高压 → 向外推）
        div += texture2D(uDivSource, vUv).r;

        float pOld = texture2D(uPressure, vUv).r;
        float pNew = (pL + pR + pT + pB - div) / 4.0;
        pNew = (1.0 - uOmega) * pOld + uOmega * pNew;

        gl_FragColor = vec4(pNew, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.pressureGrid.write, mat);
    this.pressureGrid.swap();
  }

  /**
   * 压力梯度修正：从速度场中减去压力梯度，使速度场散度为零。
   *   新速度 = 旧速度 - grad(p)
   *     grad(p) = [ (pR-pL)/2·dx,  (pT-pB)/2·dy ] · resolution
   */
  private applyPressureGradient(): void {
    const mat = this.gpu.getMaterial('pressureGradient_obstacle', {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uObstacle: { value: this.getObstacleTexture() },
      uInvResolution: { value: new THREE.Vector2(1.0 / this.config.resolution.w, 1.0 / this.config.resolution.h) },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvResolution;
      varying vec2 vUv;

      void main() {
        // ★ 墙体像素：速度强制归零
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        vec2 ts = uInvResolution;

        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;

        // gradP = [ (pR-pL)/2, (pT-pB)/2 ] * resolution（标量压力梯度 → 像素/秒）
        vec2 gradP = vec2(pR - pL, pT - pB) * 0.5 / uInvResolution;
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel -= gradP;

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  /** 将 FluidGrid 零化（直接用 clear 代替全屏 Pass，零开销）。
   *  ★ 必须强制黑/透明清屏色：renderer.clear() 写入的是当前全局 clearColor，
   *    浅色主题下会把场初始化成假数据（事故记录 #001 同款）。 */
  private clearGrid(grid: FluidGrid): void {
    const target = grid.write;
    const prevTarget = this.renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.renderer.setRenderTarget(prevTarget);
    grid.swap();
  }

  // ==================== 纹理访问 ====================

  /** 获取颜色场纹理（用于显示） */
  getColorTexture(): THREE.Texture {
    const tex = this.colorGrid.read;
    return tex;
  }

  /** 获取速度场纹理（RG 通道，需要可视化转换） */
  getVelocityTexture(): THREE.Texture {
    const tex = this.velocityGrid.read;
    return tex;
  }

  /**
   * 获取 density 场纹理（R 通道，[0,1] 标量浓度）。
   * 仅 advectionMode='scalar' 时有意义，用于"浓缩"视口显示。
   */
  getDensityTexture(): THREE.Texture {
    return this.densityGrid.read;
  }

  /**
   * 获取 Level Set φ 场纹理（R 通道 half-float signed distance）。
   * 未启用 LevelSet 时返回 dummy 纹理（φ=0，视口显示为全白零等值线）。
   */
  getLevelSetTexture(): THREE.Texture {
    return this._phiGrid?.read ?? this.getDummyObstacleTex();
  }

  /**
   * ★ 诊断辅助：回读 density 场指定像素到 Uint8Array(4)（R 通道为 density）。
   */
  readDensityPixel(x: number, y: number, out: Uint8Array): void {
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.densityGrid.readTarget);
    this.renderer.readRenderTargetPixels(this.densityGrid.readTarget, x, y, 1, 1, out);
    this.renderer.setRenderTarget(prevRT);
  }

  /**
   * ★ 诊断辅助：回读颜色场（残差）指定像素到 Uint8Array(4)（RGBA）。
   */
  readColorPixel(x: number, y: number, out: Uint8Array): void {
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.colorGrid.readTarget);
    this.renderer.readRenderTargetPixels(this.colorGrid.readTarget, x, y, 1, 1, out);
    this.renderer.setRenderTarget(prevRT);
  }

  /** 获取当前模拟帧计数 */
  getFrameCount(): number {
    return this.frameCount;
  }

  /** 获取当前模拟时间（秒） */
  getTime(): number {
    return this.time;
  }

  /**
   * 控制台调试专用：打印颜色场统计信息。
   * 调用方式：window.fluidEditor.printColorStats()
   */
  printColorStats(): void {
    const pixels = this.readColorPixels();
    const { w, h } = this.config.resolution;
    let nonZero = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 0 || pixels[i+1] !== 0 || pixels[i+2] !== 0) nonZero++;
    }
    console.log(`[调试] 颜色场非零像素数: ${nonZero}/${pixels.length/4} (${(nonZero*100/(pixels.length/4)).toFixed(1)}%)`);
    // 中心像素
    const cx = Math.floor(w/2), cy = Math.floor(h/2);
    const idx = (cy * w + cx) * 4;
    console.log(`[调试] 中心像素 (${cx},${cy}): RGBA=(${pixels[idx]},${pixels[idx+1]},${pixels[idx+2]},${pixels[idx+3]})`);
  }

  /**
   * ★ 调试：φ 场全图回读 + 斑点诊断（Level Set 视图白黑噪点排查）。
   *
   * 统计五项指标：
   *   ① 液体内部"洞"：φ≥0 且 ≥3 个邻居 φ<-3 —— 渲染 discard 抠出透明洞（黑点）
   *   ② 孤立极值：|φ−四邻均值|>1px —— 法线畸变 → 镜面高光炸点（白点）
   *   ③ 红黑棋盘残差：偶/奇奇像素质心差 —— reinit 红黑迭代未收敛指标
   *   ④ 空气区精确零值数量 —— clampAirPhi 压平痕迹
   *   ⑤ NaN / ±Inf 计数
   */
  debugReadPhi(): void {
    if (!this._phiGrid) {
      console.log('[φ诊断] Level Set 未启用（无 phiGrid）');
      return;
    }
    const { w, h } = this._phiGrid.resolution;
    const count = w * h;
    const raw = new Uint16Array(count);
    const readTarget = this._phiGrid.readTarget;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(readTarget);
    this.renderer.readRenderTargetPixels(readTarget, 0, 0, w, h, raw);
    this.renderer.setRenderTarget(prevTarget);

    const phi = new Float32Array(count);
    let nan = 0, posInf = 0, negInf = 0;
    let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < count; i++) {
      const v = halfToFloat(raw[i]);
      phi[i] = v;
      if (Number.isNaN(v)) { nan++; continue; }
      if (v === Infinity) { posInf++; continue; }
      if (v === -Infinity) { negInf++; continue; }
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    // 邻居索引（边界跳过）
    const nb = (x: number, y: number) => {
      const i = y * w + x;
      return [phi[i - 1], phi[i + 1], phi[i - w], phi[i + w]];
    };

    // ① 液体内部"洞"（discard 黑点候选）+ ② 孤立极值（法线噪声）
    let holes = 0, extrema = 0;
    const holeSamples: string[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = phi[i];
        if (!isFinite(v)) continue;
        const [l, r, t, b] = nb(x, y);
        const deepNb = ([l, r, t, b].filter(p => p < -3)).length;
        if (v >= 0 && deepNb >= 3) {
          holes++;
          if (holeSamples.length < 5) holeSamples.push(`(${x},${y})φ=${v.toFixed(2)}`);
        }
        const avg = (l + r + t + b) / 4;
        if (Math.abs(v - avg) > 1.0 && isFinite(avg)) extrema++;
      }
    }

    // ③ 红黑棋盘残差（只统计液体内部 |φ|>band 的深层像素）
    const band = this.config.levelSetConfig?.narrowBandWidth ?? 5;
    let evenSum = 0, evenN = 0, oddSum = 0, oddN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = phi[i];
        if (!isFinite(v) || v > -band) continue;
        if ((x + y) & 1) { oddSum += v; oddN++; }
        else { evenSum += v; evenN++; }
      }
    }
    const checker = (evenN && oddN) ? (evenSum / evenN) - (oddSum / oddN) : 0;

    // ④ 空气区被钳平成精确 0 的像素数
    let zeros = 0;
    for (let i = 0; i < count; i++) if (phi[i] === 0) zeros++;

    console.log(
      `[φ诊断] ${w}×${h} min=${min.toFixed(2)} max=${max.toFixed(2)} mean=${(sum / count).toFixed(3)} | ` +
      `NaN=${nan} +Inf=${posInf} -Inf=${negInf}\n` +
      `[φ诊断] ①内部洞(discard黑点)=${holes}  ②孤立极值(白点候选)=${extrema} (${(extrema * 100 / count).toFixed(2)}%)\n` +
      `[φ诊断] ③红黑棋盘质心差=${checker.toFixed(4)}px (>0.05 即未收敛)  ④空气区精确零值=${zeros}` +
      (holeSamples.length ? `\n[φ诊断] 洞样本: ${holeSamples.join(' ')}` : '')
    );
  }

  /**
   * 读取速度场指定位置的像素值，自动根据 velocityDataType 选择读取方式。
   * - float: 用 Float32Array 直接读出 32 位浮点
   * - half-float: 用 Uint16Array 读取原始 16 位，再用 halfToFloat 解码
   */
  private readVelocityPixelData(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Float32Array {
    const dtype: VelocityDataType = this.config.velocityDataType || 'float';
    const count = width * height * 2; // 每像素 2 通道 (RG)

    if (dtype === 'float') {
      // 32位浮点：直接用 Float32Array 读取，Three.js/WebGL 自动填充为 float32
      const buf = new Float32Array(count);
      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.readRenderTargetPixels(target, x, y, width, height, buf);
      this.renderer.setRenderTarget(prevTarget);
      return buf;
    } else {
      // 16位半精度：用 Uint16Array 读取原始位模式，再手动解码
      const raw = new Uint16Array(count);
      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.readRenderTargetPixels(target, x, y, width, height, raw);
      this.renderer.setRenderTarget(prevTarget);

      // 解码 HalfFloat → Float32
      const result = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        result[i] = halfToFloat(raw[i]);
      }
      return result;
    }
  }

  /**
   * 采样指定像素位置的颜色和速度值。
   * @param x 像素 X 坐标（0 ~ w-1，UI 坐标系：左上角为原点）
   * @param y 像素 Y 坐标（0 ~ h-1，UI 坐标系：Y 向下为正）
   * @returns { h, s, l, a, velX, velY } HSLA 值（0~1）和速度值（像素/秒）
   */
  samplePixel(x: number, y: number): {
    residualH: number; // R 通道 = H 增量 (0~1)
    residualS: number; // G 通道 = S 增量 (0~1)
    residualL: number; // B 通道 = L 增量 (0~1)
    alpha: number;
    velX: number; velY: number;
  } {
    const { w, h } = this.config.resolution;
    // ★ 钳制：UI 坐标（左上角 0,0，Y向下）
    const px = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(h - 1, Math.floor(y)));
    // ★ 关键修正：WebGL readRenderTargetPixels 的原点在【左下角】(0,0)，
    //   而我们传进来的 py 是【左上角】坐标系。必须做 Y 翻转。
    const readPy = (h - 1) - py;

    // 1. 读取颜色像素（RGBA uint8）—— 颜色场就是 HSLA，直接读取（同样 Y 翻转）
    //    ★ 只回读 1 像素（而非整张纹理），与速度读取方式一致，避免逐像素全图 readback
    const colorPixels = new Uint8Array(4);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.colorGrid.readTarget);
    this.renderer.readRenderTargetPixels(this.colorGrid.readTarget, px, readPy, 1, 1, colorPixels);
    this.renderer.setRenderTarget(prevTarget);
    const r = colorPixels[0] / 255;     // = H 增量
    const g = colorPixels[1] / 255;     // = S 增量
    const b = colorPixels[2] / 255;     // = L 增量
    const a = colorPixels[3] / 255;     // = Alpha

    // 2. 读取速度像素（根据 velocityDataType 自动选择 float/half-float 读取方式）
    const velData = this.readVelocityPixelData(
      this.velocityGrid.readTarget,
      px, readPy, 1, 1,
    );
    const velX = velData[0];
    const velY = velData[1];

    // ★ 调试断言：如果读到 NaN 或极端值，输出警告（帮助定位读取问题）
    if (!(Number.isFinite(velX) && Number.isFinite(velY))) {
      const dtype = this.config.velocityDataType || 'float';
      console.warn(`[samplePixel] ⚠️ 速度读回异常（${dtype}）：velX=${velX}, velY=${velY} @ (${px},${py}) readY=${readPy} size=${w}x${h}`);
    }

    return { residualH: r, residualS: g, residualL: b, alpha: a, velX, velY };
  }

  /**
   * 将颜色场从 GPU 回读到 CPU（Uint8Array RGBA）。
   * 用于 Canvas 2D 显示（跨 WebGL 上下文安全）。
   */
  readColorPixels(): Uint8Array {
    const { w, h } = this.config.resolution;
    const size = w * h * 4;
    if (!this.pixelBuffer || this.pixelBuffer.length < size) {
      this.pixelBuffer = new Uint8Array(size);
    }
    const pixels = this.pixelBuffer.subarray(0, size);
    const target = this.colorGrid.readTarget;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    this.renderer.setRenderTarget(prevTarget);

    return pixels;
  }

  /**
   * 将速度场从 GPU 回读到 CPU（Uint8Array RGBA，R=velX, G=velY）。
   *
   * ★ 自动根据 velocityDataType 选择读取方式（float / half-float）。
   *   读回后将速度值映射到 [0,255] 用于 ImageData 显示。
   *   映射规则：以 uMaxVel 为参考最大速度，vel 范围 [-uMaxVel, +uMaxVel] → [0, 255]，
   *            0 速度 = 128（中灰），正速度 > 128，负速度 < 128。
   *
   * 注意：readRenderTargetPixels 返回的数组第 0 行对应纹理底部（WebGL 左下角原点），
   *       如果用于 putImageData 显示，需要做 Y 翻转（调用方负责）。
   *
   * @param maxVel 参考最大速度（用于归一化映射），默认 3000 px/s
   */
  readVelocityPixels(maxVel: number = 3000): Uint8Array {
    const { w, h } = this.config.resolution;
    // ★ 使用统一的辅助方法读取（自动处理 float / half-float）
    const raw = this.readVelocityPixelData(
      this.velocityGrid.readTarget,
      0, 0, w, h,
    );

    // 扩展为 RGBA uint8（速度值映射到 0-255 可视化）
    const rgba = new Uint8Array(w * h * 4);
    const scale = 127.5 / maxVel; // 0 速度 → 128，+maxVel → 255，-maxVel → 1
    for (let i = 0; i < w * h; i++) {
      const vx = raw[i * 2];
      const vy = raw[i * 2 + 1];
      // 钳制并映射：[-maxVel, +maxVel] → [1, 255]，0 → 128
      rgba[i * 4]     = Math.max(0, Math.min(255, Math.round(128 + vx * scale)));
      rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + vy * scale)));
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = 255;
    }

    return rgba;
  }

  // ==================== 初始化 ====================

  /** 根据当前 config 重新创建 FluidGrid */
  private rebuildGrids(): void {
    console.log('[FluidEditor.rebuildGrids] 分辨率:', this.config.resolution.w, 'x', this.config.resolution.h);
    const colorCh = Math.max(
      1,
      ['r', 'g', 'b', 'a'].filter(
        (k) => this.config.channels[k as keyof typeof this.config.channels],
      ).length,
    );

    const velDataType: VelocityDataType = this.config.velocityDataType || 'float';

    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.divergenceGrid?.dispose();
    this.pressureGrid?.dispose();
    this.densityGrid?.dispose();
    // ★ Level Set phiGrid：分辨率变化时释放，下次 step 前由 enableLevelSetMode 重建
    this._phiGrid?.dispose();
    this._phiGrid = null;

    this.colorGrid = new FluidGrid(
      this.config.resolution,
      colorCh as 1 | 2 | 3 | 4,
      'uint8',
    );
    // ★ 速度场/压力场数据类型：由 velocityDataType 配置决定
    //   'float'（默认）: 32位单精度，高精度，readPixels 用 Float32Array 直接读出
    //   'half-float': 16位半精度，显存减半，readPixels 用 Uint16Array + halfToFloat 手动解码
    this.velocityGrid = new FluidGrid(this.config.resolution, 2, velDataType);
    this.pressureGrid = new FluidGrid(this.config.resolution, 1, velDataType);
    // ★ 散度源场（爆炸/源汇压力源项）
    this.divergenceGrid = new FluidGrid(this.config.resolution, 1, velDataType);
    // ★ MCSDA density 场：1 通道 Uint8（RedFormat），与 colorGrid 分辨率一致
    this.densityGrid = new FluidGrid(this.config.resolution, 1, 'uint8');

    // ★ 障碍物纹理：分辨率变化时重建（仅当已启用时）
    if (this.config.enableObstacles && this.obstacleTarget) {
      this.recreateObstacleTarget();
    }
  }

  /** 初始化场数据：全透明空场 + 零速度 */
  public initFields(): void {
    const { w, h } = this.config.resolution;

    // 初始颜色场：完全透明（空场），依靠注入源产生动态流体
    let colorData: Float32Array | Uint8Array;
    if (this.colorGrid.dataType === 'uint8') {
      colorData = new Uint8Array(w * h * 4); // 默认全零 = 透明
    } else {
      colorData = new Float32Array(w * h * 4); // 默认全零 = 透明
    }
    this.uploadToGrid(this.colorGrid, colorData, 4);

    // 零速度
    let velData: Float32Array | Uint8Array;
    if (this.velocityGrid.dataType === 'uint8') {
      velData = new Uint8Array(w * h * 2);
    } else {
      velData = new Float32Array(w * h * 2);
    }
    this.uploadToGrid(this.velocityGrid, velData, 2);

    // ★ density 场初始化为 0（1 通道 Uint8）
    const densityData = new Uint8Array(w * h);
    this.uploadToGrid(this.densityGrid, densityData, 1);

    // ★ 散度源场清零（爆炸残留的散度源不参与重置后的模拟）
    this.clearGrid(this.divergenceGrid);

    // ★ 压力场清零（无论热启动开关，重置即从零压力开始）
    this.clearGrid(this.pressureGrid);

    // ★ 爆炸队列清空（重置时正在播放的爆炸立即停止）
    this.operations.clearExplosions();
    this.velCapOverride = null;  // 重置时同步清掉爆炸限幅覆盖

    // ★ Level Set φ 场重建（启用时水体形状随重置归零）
    if (this._phiGrid) {
      this.initPhiField();
    }

    // ★ 恢复残差模板（重置/网格重建清场后——否则残差纹理丢失）
    if (this._pendingResidualImage) {
      this.initializeColorFromImageData(this._pendingResidualImage);
    }
  }

  // ==================== 障碍物（墙体）管理 ====================

  /**
   * 获取当前障碍物纹理 —— 启用时返回 obstacleTarget.texture，否则返回 dummy 白色纹理。
   * 这样所有着色器都可以安全采样，无需每次检查 enableObstacles。
   */
  getObstacleTexture(): THREE.Texture {
    if (this.config.enableObstacles && this.obstacleTarget) {
      return this.obstacleTarget.texture;
    }
    return this.getDummyObstacleTex();
  }

  /**
   * 启用障碍物模式 —— 创建 obstacleTarget（懒初始化）。
   * 如果已创建则直接返回。
   */
  enableObstaclesMode(): void {
    if (this.config.enableObstacles && this.obstacleTarget) return;
    this.config.enableObstacles = true;
    this.createObstacleTarget();
  }

  /**
   * 禁用障碍物模式 —— 释放 obstacleTarget 显存。
   */
  disableObstaclesMode(): void {
    this.config.enableObstacles = false;
    this.disposeObstacleTarget();
  }

  // ==================== Level Set 模块（热插拔） ====================

  /**
   * 启用 Level Set 模式 —— 懒创建 phiGrid（1 通道 half-float）并初始化 φ 场。
   * 已创建则直接返回。φ 场来源：scalar 模式取 densityGrid.R，vector 模式取 colorGrid.A。
   */
  enableLevelSetMode(): void {
    if (this._phiGrid) {
      console.log('[LevelSet] 已启用，phiGrid 已存在，跳过创建');
      return;  // 已创建
    }
    const { w, h } = this.config.resolution;
    this._phiGrid = new FluidGrid({ w, h }, 1, 'half-float');
    this.levelSetFrameCount = 0;
    this.initPhiField();
    const src = this.config.advectionMode === 'scalar' ? 'densityGrid.R' : 'colorGrid.A';
    const lsCfg = this.config.levelSetConfig;
    console.log(`[LevelSet] ✅ 启用：phiGrid ${w}x${h} half-float，φ 来源=${src}，窄带=${lsCfg?.narrowBandWidth ?? 5}px，reinitInterval=${lsCfg?.reinitInterval ?? 10}帧，σ=${lsCfg?.surfaceTension ?? 0}`);
  }

  /**
   * 禁用 Level Set 模式 —— 释放 phiGrid 显存，后续 step() 跳过所有 Level Set 计算。
   */
  disableLevelSetMode(): void {
    console.log('[LevelSet] ❌ 禁用：释放 phiGrid');
    this._phiGrid?.dispose();
    this._phiGrid = null;
  }

  /**
   * 重新基于当前 density/colorGrid 初始化 φ 场（启用状态下可调用以重置 SDF）。
   */
  resetLevelSetPhi(): void {
    if (!this._phiGrid) return;
    this.initPhiField();
  }

  /**
   * 基于密度场（scalar）或颜色场 alpha（vector）推断初始 SDF。
   *   density > 0.5 / alpha > 0.5 → φ < 0（内部）
   *   density < 0.5 / alpha < 0.5 → φ > 0（外部）
   * 粗略初始化，需配合 reinit 才能得到真正的 SDF（|∇φ|≈1）。
   */
  private initPhiField(): void {
    if (!this._phiGrid) return;
    const lsCfg = this.config.levelSetConfig;
    const radius = lsCfg?.narrowBandWidth ?? 5;
    if (this.config.advectionMode === 'scalar') {
      // scalar 模式：density 场 R 通道
      this.levelSetSolver.initPhiField(this._phiGrid, this.densityGrid.read, 0, radius);
    } else {
      // vector 模式：颜色场 A 通道
      this.levelSetSolver.initPhiField(this._phiGrid, this.colorGrid.read, 1, radius);
    }
  }

  /**
   * ★ φ 场后处理（空气钳制 + 水体补偿）——老版本 FluidSimulator 的水感关键机制。
   * 读取配置 → 委托 LevelSetSolver.applyPhiCorrection。
   */
  private applyPhiCorrection(): void {
    if (!this._phiGrid) return;
    const lsCfg = this.config.levelSetConfig;
    const clampAir = lsCfg?.clampAirPhi ?? true;
    const maxAirPhi = lsCfg?.maxAirPhi ?? 0;
    const compensate = lsCfg?.compensateWaterPhi ?? true;
    const compRate = lsCfg?.waterCompensationRate ?? 0.1;
    this.levelSetSolver.applyPhiCorrection(
      this._phiGrid, this.getObstacleTexture(), clampAir, maxAirPhi, compensate, compRate,
    );
  }

  /**
   * 在障碍物纹理上绘制一个圆形笔刷（GPU 渲染）。
   * @param uv 中心位置（归一化 0~1）
   * @param radius 半径（归一化 0~1）
   * @param value 0=擦除，255=绘制墙体
   */
  updateObstacle(uv: { x: number; y: number }, radius: number, value: 0 | 255): void {
    if (!this.config.enableObstacles) return;
    this.ensureObstacleTarget();
    if (!this.obstacleTarget || !this.obstacleTempTarget) return;

    // ★ 关键修复：先把 obstacleTarget 复制到 obstacleTempTarget，
    //   然后着色器从 temp 采样（旧内容），写入 obstacleTarget（新内容）。
    //   避免 gpu.render 的 clear() 破坏原始内容。
    const copyMat = this.gpu.getMaterial('copyObstacle', {
      uSource: { value: this.obstacleTarget.texture },
    }, /* glsl */ `
      uniform sampler2D uSource;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(uSource, vUv);
      }
    `);
    this.gpu.render(this.renderer, this.obstacleTempTarget!, copyMat);

    // ★ 绘制笔刷：从 temp 采样旧内容，合成新内容到 obstacleTarget
    const mat = this.gpu.getMaterial('drawObstacle', {
      uObstacle: { value: this.obstacleTempTarget.texture },  // 从副本读
      uPos: { value: new THREE.Vector2(uv.x, uv.y) },
      uRadius: { value: radius },
      uValue: { value: value / 255 },
    }, /* glsl */ `
      uniform sampler2D uObstacle;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform float uValue;
      varying vec2 vUv;

      void main() {
        float current = texture2D(uObstacle, vUv).r;
        float d = distance(vUv, uPos);
        float brush = smoothstep(uRadius, uRadius * 0.5, d);
        // value=1.0: 写入墙体；value=0.0: 擦除墙体
        float next = (uValue > 0.5)
          ? max(current, brush)   // 绘制：取 max（不会擦除已有墙体）
          : max(current - brush, 0.0);  // 擦除：减去笔刷影响
        gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.obstacleTarget!, mat);

    // ★ 调试输出（节流：每 60 帧打印一次）
    if (Math.random() < 0.02) {
      const buf = new Uint8Array(4);
      const cx = Math.floor(uv.x * this.config.resolution.w);
      const cy = Math.floor(uv.y * this.config.resolution.h);
      this.readObstaclePixel(cx, cy, buf);
      console.log(`[obstacle] 画笔绘制: uv=(${uv.x.toFixed(3)},${uv.y.toFixed(3)}) r=${radius.toFixed(4)} v=${value} → 像素R=${buf[0]}`);
    }
  }

  /** 清空所有障碍物 */
  clearObstacles(): void {
    if (!this.config.enableObstacles) return;
    this.ensureObstacleTarget();

    const prevTarget = this.renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevAlpha = this.renderer.getClearAlpha();
    // ★ 掩码纹理 R>0.5 视为墙：清屏色若偏浅会把全场变成障碍物，必须强制黑
    this.renderer.setClearColor(0x000000, 0);
    if (this.obstacleTarget) {
      this.renderer.setRenderTarget(this.obstacleTarget);
      this.renderer.clear();
    }
    if (this.obstacleTempTarget) {
      this.renderer.setRenderTarget(this.obstacleTempTarget);
      this.renderer.clear();
    }
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.renderer.setRenderTarget(prevTarget);
    console.log('[obstacle] 清空所有障碍物');
  }

  /** 读取障碍物像素（诊断用） */
  readObstaclePixel(x: number, y: number, out: Uint8Array): void {
    if (!this.obstacleTarget) return;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.obstacleTarget);
    this.renderer.readRenderTargetPixels(this.obstacleTarget, x, y, 1, 1, out);
    this.renderer.setRenderTarget(prevRT);
  }

  /**
   * 获取墙纹理的位图压缩数据（1 bit / 像素）
   * @returns 包含位图数据和尺寸的对象，若未启用墙体则返回 null
   */
  public getObstacleBitmap(): { data: Uint8Array; width: number; height: number } | null {
    if (!this.obstacleTarget) {
      return null;
    }

    const { w, h } = this.config.resolution;
    const pixels = new Uint8Array(w * h * 4);

    // 从 GPU 回读墙纹理
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.obstacleTarget);
    this.renderer.readRenderTargetPixels(this.obstacleTarget, 0, 0, w, h, pixels);
    this.renderer.setRenderTarget(prevRT);

    // 打包为位图（1 bit / 像素）
    const byteLength = Math.ceil((w * h) / 8);
    const bitmap = new Uint8Array(byteLength);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        // R 通道 > 127 表示墙体（0=空，255=墙体）
        if (pixels[idx] > 127) {
          const pixelIndex = y * w + x;
          const byteIndex = Math.floor(pixelIndex / 8);
          const bitIndex = pixelIndex % 8;
          bitmap[byteIndex] |= (1 << bitIndex);
        }
      }
    }

    return { data: bitmap, width: w, height: h };
  }

  /**
   * 从 1 bit/像素 位图数据恢复墙体纹理（供多帧物理配置导入/切帧恢复）。
   * 与 getObstacleBitmap 的打包约定严格对称（LSB-first）；尺寸不匹配时最近邻缩放。
   */
  public setObstacleBitmap(bitmap: { data: Uint8Array; width: number; height: number }): void {
    const { w, h } = this.config.resolution;
    this.enableObstaclesMode();
    if (!this.obstacleTarget) return;

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const unpacked = new Uint8Array(srcW * srcH);
    for (let i = 0; i < srcW * srcH; i++) {
      if (bitmap.data[Math.floor(i / 8)] & (1 << (i % 8))) unpacked[i] = 255;
    }

    let data = unpacked;
    if (srcW !== w || srcH !== h) {
      data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(Math.floor((y * srcH) / h), srcH - 1);
        for (let x = 0; x < w; x++) {
          const sx = Math.min(Math.floor((x * srcW) / w), srcW - 1);
          data[y * w + x] = unpacked[sy * srcW + sx];
        }
      }
    }

    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.flipY = false; // 与 getObstacleBitmap 读回方向一致（row 0 = 顶部）
    tex.needsUpdate = true;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.LinearSRGBColorSpace;

    const copyMat = this.gpu.getMaterial('copyObstacleBitmap', {
      tex: { value: tex },
    }, /* glsl */ `
      uniform sampler2D tex;
      varying vec2 vUv;
      void main() {
        float v = texture2D(tex, vUv).r;
        gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.obstacleTarget, copyMat);
    tex.dispose();
    console.log(`[obstacle] 从位图恢复墙体 ${srcW}x${srcH} → ${w}x${h}`);
  }

  /** 创建 obstacleTarget + obstacleTempTarget（懒初始化） */
  private createObstacleTarget(): void {
    this.disposeObstacleTarget();
    const { w, h } = this.config.resolution;
    const rtOpts: THREE.RenderTargetOptions = {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.obstacleTarget = new THREE.WebGLRenderTarget(w, h, rtOpts);
    this.obstacleTempTarget = new THREE.WebGLRenderTarget(w, h, rtOpts);
    // 初始化为全 0（无障碍物）★ 强制黑清屏色，防浅色主题把全场写成墙
    const prevRT = this.renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.obstacleTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.obstacleTempTarget);
    this.renderer.clear();
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.renderer.setRenderTarget(prevRT);
    console.log('[obstacle] 创建 obstacleTarget', { w, h });
  }

  /** 分辨率变化时重建 obstacleTarget（保留已有内容的简化版 —— 直接清空） */
  private recreateObstacleTarget(): void {
    this.createObstacleTarget();
  }

  /** 确保 obstacleTarget 存在 */
  private ensureObstacleTarget(): void {
    if (!this.obstacleTarget) {
      this.createObstacleTarget();
    }
  }

  /** 销毁 obstacleTarget + obstacleTempTarget */
  private disposeObstacleTarget(): void {
    if (this.obstacleTarget) {
      this.obstacleTarget.dispose();
      this.obstacleTarget = null;
    }
    if (this.obstacleTempTarget) {
      this.obstacleTempTarget.dispose();
      this.obstacleTempTarget = null;
    }
  }

  /** 获取或创建 1×1 空白哑纹理（R=0 表示无障碍物） */
  private getDummyObstacleTex(): THREE.Texture {
    if (!this.dummyObstacleTex) {
      this.dummyObstacleTex = new THREE.DataTexture(
        new Uint8Array([0]),
        1, 1, THREE.RedFormat, THREE.UnsignedByteType,
      );
      this.dummyObstacleTex.minFilter = THREE.NearestFilter;
      this.dummyObstacleTex.magFilter = THREE.NearestFilter;
      this.dummyObstacleTex.needsUpdate = true;
    }
    return this.dummyObstacleTex;
  }

  /**
   * 从 ImageData 初始化颜色场（供 FTX 残差纹理导入）。
   *
   * 残差纹理是量化后的 H/S/L 增量（R=H增量, G=S增量, B=L增量），
   * 上传后由流体解算器（平流）驱动其流动。
   *
   * 如果 ImageData 尺寸与网格分辨率不匹配，自动缩放。
   */
  initializeColorFromImageData(imageData: ImageData): void {
    // ★ 缓存残差模板（网格重建后恢复用）
    this._pendingResidualImage = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height,
    );
    const { w, h } = this.config.resolution;
    let data: Uint8ClampedArray | Uint8Array = imageData.data;
    let width = imageData.width;
    let height = imageData.height;

    // 尺寸不匹配时缩放（最近邻插值，保留残差量化精度）
    if (width !== w || height !== h) {
      // 使用纯 Canvas 2D 缩放，避免 createImageBitmap 可能的坐标变换
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = width;
      srcCanvas.height = height;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.putImageData(imageData, 0, 0); // 直接写入原始像素，不做颜色空间转换

      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = w;
      dstCanvas.height = h;
      const dstCtx = dstCanvas.getContext('2d')!;
      dstCtx.imageSmoothingEnabled = false; // 最近邻插值，保留量化值
      dstCtx.drawImage(srcCanvas, 0, 0, w, h);

      const scaled = dstCtx.getImageData(0, 0, w, h);
      data = scaled.data;
      width = w;
      height = h;
    }

    // 上传到颜色网格（RGBA 四通道 uint8）
    const uploadData = data instanceof Uint8ClampedArray
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    this.uploadToGrid(this.colorGrid, uploadData, 4);
  }

  /**
   * 将 CPU 数据上传到 FluidGrid。
   * 使用临时 DataTexture + copy shader 渲染到 grid.write。
   * 
   * 注意：确保数据类型与目标网格匹配！
   * - uint8 网格：数据应在 [0, 255] 范围，使用 Uint8Array
   * - half-float/float 网格：数据应在 [-1, 1] 或 [0, 1] 范围，使用 Float32Array
   *
   * 公开接口，供外部从 ImageData 初始化残差纹理。
   */
  uploadToGrid(
    grid: FluidGrid,
    data: Float32Array | Uint8Array,
    channels: number,
  ): void {
    const { w, h } = this.config.resolution;

    // 根据目标网格的数据类型选择合适的纹理类型
    let texType: THREE.TextureDataType;
    if (grid.dataType === 'uint8') {
      texType = THREE.UnsignedByteType;
      // 如果传入的是 Float32Array，需要转换为 Uint8Array（假设数据在 [0, 1] 范围）
      if (data instanceof Float32Array) {
        const uint8Data = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
          uint8Data[i] = Math.round(data[i] * 255);
        }
        data = uint8Data;
      }
    } else {
      texType = THREE.FloatType;
      // 如果传入的是 Uint8Array，需要转换为 Float32Array
      if (data instanceof Uint8Array) {
        const floatData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
          floatData[i] = data[i] / 255;
        }
        data = floatData;
      }
    }

    // 根据通道数选择正确的纹理格式
    const formatMap: Record<number, THREE.PixelFormat> = {
      1: THREE.RedFormat,
      2: THREE.RGFormat,
      3: THREE.RGBAFormat,
      4: THREE.RGBAFormat,
    };
    const texFormat = formatMap[channels] || THREE.RGBAFormat;

    const tex = new THREE.DataTexture(
      data,
      w,
      h,
      texFormat,
      texType,
    );
    tex.flipY = false; // 统一坐标系：顶部=UV(0,0)，与主画布一致
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.LinearSRGBColorSpace; // 残差纹理存储的是量化HSL增量，不是颜色，禁止sRGB解码

    // 根据通道数选择对应的复制着色器
    const getCopyFS = (ch: number): string => {
      switch (ch) {
        case 1: return /* glsl */ `uniform sampler2D tex; varying vec2 vUv; void main() { float v = texture2D(tex, vUv).r; gl_FragColor = vec4(v, 0.0, 0.0, 1.0); }`;
        case 2: return /* glsl */ `uniform sampler2D tex; varying vec2 vUv; void main() { vec2 v = texture2D(tex, vUv).rg; gl_FragColor = vec4(v, 0.0, 1.0); }`;
        default: return /* glsl */ `uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }`;
      }
    };
    const copyKey = `copy_${channels}ch_${grid.dataType}`;
    const copyMat = this.gpu.getMaterial(copyKey, {
      tex: { value: tex },
    }, getCopyFS(channels));

    this.gpu.render(this.renderer, grid.write, copyMat);
    grid.swap();
    tex.dispose();
  }

  /**
   * ★ 取消勾选通道时恢复默认残差模板值：被取消的通道 = 导入时的静态残差，
   *   其余通道保持当前（流动中）状态。GPU mix pass：
   *   colorGrid = mix(当前, 模板, 取消通道掩码)
   */
  public restoreChannelsFromTemplate(restoreMask: { r: boolean; g: boolean; b: boolean; a: boolean }): void {
    if (!this._pendingResidualImage) return;
    const { w, h } = this.config.resolution;

    // 模板 → 缩放适配当前网格分辨率（最近邻，保留量化值）
    let tmpl = this._pendingResidualImage.data;
    let tw = this._pendingResidualImage.width;
    let th = this._pendingResidualImage.height;
    if (tw !== w || th !== h) {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = tw;
      srcCanvas.height = th;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.putImageData(this._pendingResidualImage, 0, 0);
      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = w;
      dstCanvas.height = h;
      const dstCtx = dstCanvas.getContext('2d')!;
      dstCtx.imageSmoothingEnabled = false;
      dstCtx.drawImage(srcCanvas, 0, 0, w, h);
      const scaled = dstCtx.getImageData(0, 0, w, h);
      tmpl = scaled.data;
      tw = w;
      th = h;
    }

    const tex = new THREE.DataTexture(
      new Uint8Array(tmpl),
      tw, th,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    tex.flipY = false;
    tex.needsUpdate = true;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.LinearSRGBColorSpace;

    const mat = this.gpu.getMaterial('restoreChannelsFromTemplate', {
      uCurrent: { value: this.colorGrid.read },
      uTemplate: { value: tex },
      uMask: { value: new THREE.Vector4(
        restoreMask.r ? 1 : 0,
        restoreMask.g ? 1 : 0,
        restoreMask.b ? 1 : 0,
        restoreMask.a ? 1 : 0,
      ) },
    }, /* glsl */ `
      uniform sampler2D uCurrent;
      uniform sampler2D uTemplate;
      uniform vec4 uMask;
      varying vec2 vUv;
      void main() {
        vec4 cur = texture2D(uCurrent, vUv);
        vec4 tmpl = texture2D(uTemplate, vUv);
        gl_FragColor = mix(cur, tmpl, uMask);
      }
    `);
    this.gpu.render(this.renderer, this.colorGrid.write, mat);
    this.colorGrid.swap();
    tex.dispose();
  }

  // ==================== 销毁 ====================

  dispose(): void {
    this.colorGrid?.dispose();
    this.divergenceGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();
    this.densityGrid?.dispose();
    this._phiGrid?.dispose();
    this._phiGrid = null;
    this.disposeObstacleTarget();
    this.dummyObstacleTex?.dispose();
    this.dummyObstacleTex = null;
    this.advectionSolver.dispose();
    this.levelSetSolver.dispose();
    this.gpu.dispose();
  }
}