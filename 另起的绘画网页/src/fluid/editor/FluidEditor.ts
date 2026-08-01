import * as THREE from 'three';
import { FluidGrid } from '../core/FluidGrid';
import type { AdvectionMask } from '../core/FluidGrid';
import { AdvectionSolver } from '../solvers/AdvectionSolver';
import { GPUOps } from '../core/GPUOps';
import { FluidInjector } from '../core/FluidInjector';
import { FluidOperations, type InjectionConfig } from './FluidOperations';

// ============================================================
// 类型定义
// ============================================================

export type ViewMode = 'color' | 'velocity' | 'composite';

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
  enableLevelSet: boolean;   // 预留
  /** 重力加速度（像素/秒²），正值向下（屏幕坐标系） */
  gravity: number;
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

  // 求解器
  private advectionSolver: AdvectionSolver;

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

    this.advectionSolver = new AdvectionSolver(renderer);

    this.rebuildGrids();

    this.initFields();

  }

  // ==================== 配置更新 ====================

  /**
   * 运行时更新配置。如果分辨率变化则重建纹理网格。
   * 重建后立即调用 initFields() 清空新纹理，防止 WebGL 错误 1282（未初始化纹理）。
   */
  updateConfig(updates: Partial<FluidEditorConfig>): void {
    const oldRes = this.config.resolution;
    const oldVelType = this.config.velocityDataType;
    Object.assign(this.config, updates);

    const resChanged =
      updates.resolution &&
      (updates.resolution.w !== oldRes.w || updates.resolution.h !== oldRes.h);
    const velTypeChanged =
      updates.velocityDataType && updates.velocityDataType !== oldVelType;

    if (resChanged || velTypeChanged) {
      this.rebuildGrids();
      // ★ 重建纹理后必须立即 initFields()，否则新纹理没有初始化数据，
      // 后续 injectColor/injectVelocity 等操作会触发 WebGL INVALID_OPERATION (1282)
      this.initFields();
    }
  }

  // ==================== 接口适配层 ====================
  // 职责：将用户接口坐标转换为底层纹理坐标
  // 用户约定：Y向下为正（0=顶部，1=底部）
  // 纹理坐标系：Y向上为正，位置无需转换；速度Y向上为正，需取反

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
    console.log(`[初速度] 坐标适配: 用户速度=(${config.velocity.x.toFixed(2)},${config.velocity.y.toFixed(2)}) → 纹理速度=(${adapted.velocity.x.toFixed(2)},${adapted.velocity.y.toFixed(2)}) [直接透传]`);
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

    // ★ 临时诊断探针：全场扫描 max|velX|/max|velY| 及位置（每 30 帧 readPixels 一次）
    // 用于定位横向速度 X 分量是否存在、在哪、何时丢失
    const _probe = (label: string) => {
      if (this.frameCount % 30 !== 0) return;
      const { w, h } = this.config.resolution;
      const data = this.readVelocityPixelData(this.velocityGrid.readTarget, 0, 0, w, h);
      let maxX = 0, maxY = 0, maxAbsX = 0, maxAbsY = 0, idxX = 0, idxY = 0;
      const n = w * h;
      for (let i = 0; i < n; i++) {
        const vx = data[i * 2], vy = data[i * 2 + 1];
        const ax = Math.abs(vx), ay = Math.abs(vy);
        if (ax > maxAbsX) { maxAbsX = ax; maxX = vx; idxX = i; }
        if (ay > maxAbsY) { maxAbsY = ay; maxY = vy; idxY = i; }
      }
      const xx = idxX % w, xy = Math.floor(idxX / w);
      const yx = idxY % w, yy = Math.floor(idxY / w);
      console.log(`[diag] ${label} res=${w}x${h}: maxVelX=${maxX.toFixed(2)} @(${xx},${xy}), maxVelY=${maxY.toFixed(2)} @(${yx},${yy})`);
    };

    _probe('0.start');

    // ★ 0. 处理 UI 注入队列（优先执行，确保本帧生效）
    // 委托给 operations 处理一次性注入
    this.operations.processQueue(this.colorGrid, this.velocityGrid, dt);
    _probe('1.afterQueue');

    // 0. 重力（通过操作模块 → 底层注入器）
    if (this.config.gravity !== 0) {
      this.operations.applyGravity(this.velocityGrid, dt, this.config.gravity);
    }
    _probe('2.afterGravity');

    // 1. 持续注入源（通过 operations 的持久化源列表，不依赖 React state）
    this.operations.processContinuousSources(this.colorGrid, this.velocityGrid, dt);
    _probe('3.afterContinuous');

    // 2. 平流（非注入 Pass，直接使用 this.gpu）
    if (this.config.enableAdvection) {
      // ★ 平流诊断：计算回溯目标位置并读取该位置原始速度
      // 回溯公式: backUv = uv - vel * dt / resolution（与着色器一致）
      {
        const { w, h } = this.config.resolution;
        const subSteps = Math.max(1, Math.ceil((this.config.maxVelocity ?? 5000) * dt / Math.min(w, h)));
        const subDt = dt / subSteps;
        for (const [px, py, label] of [[112, 120, 'inj'], [128, 128, 'ctr']] as const) {
          const vel = this.readVelocityPixelData(this.velocityGrid.readTarget, px, py, 1, 1);
          const vx = vel[0], vy = vel[1];
          // 着色器中 uv = vUv ≈ (px+0.5)/w（像素中心）
          const uvX = (px + 0.5) / w, uvY = (py + 0.5) / h;
          const backUvX = uvX - vx * subDt / w;
          const backUvY = uvY - vy * subDt / h;
          const backPx = Math.max(0, Math.min(w - 1, Math.floor(backUvX * w)));
          const backPy = Math.max(0, Math.min(h - 1, Math.floor(backUvY * h)));
          const backVel = this.readVelocityPixelData(this.velocityGrid.readTarget, backPx, backPy, 1, 1);
          console.log(`[diag] backtrace ${label}: from=(${px},${py}) vel=(${vx.toFixed(1)},${vy.toFixed(1)}) → backPos=(${backPx},${backPy}) backVel=(${backVel[0].toFixed(2)},${backVel[1].toFixed(2)}) subDt=${subDt.toFixed(5)}`);
        }
      }
      this.advectVelocity(dt);
      // ★ 平流诊断：平流后读取同样位置
      {
        const p1 = this.readVelocityPixelData(this.velocityGrid.readTarget, 112, 120, 1, 1);
        const p2 = this.readVelocityPixelData(this.velocityGrid.readTarget, 128, 128, 1, 1);
        console.log(`[diag] post-advect @(112,120)=(${p1[0].toFixed(2)},${p1[1].toFixed(2)}) @(128,128)=(${p2[0].toFixed(2)},${p2[1].toFixed(2)})`);
      }
      _probe('4a.afterAdvectVel');
      this.advectColor(dt);
      _probe('4b.afterAdvectColor');
    }

    // 2.5 边界处理 —— 移到压力投影之前，避免与压力梯度修正拮抗
    this.applyBoundary();
    _probe('5.afterBoundary');

    // 3. 压力投影（红-黑 SOR）
    if (this.config.enablePressure) {
      this.solvePressure(this.config.pressureIterations, this.config.pressureOmega);
      this.applyPressureGradient();
      _probe('6.afterPressure');
    }

    // ★ 3.5 全局速度限幅（压力投影之后）
    // 防止持续注入、误差累积导致的速度爆炸
    // maxVelocity = 0 或 Infinity 表示禁用限幅
    const maxVel = this.config.maxVelocity ?? 5000;
    if (maxVel > 0 && isFinite(maxVel)) {
      this.operations.clampVelocity(this.velocityGrid, maxVel);
    }
    _probe('7.afterClamp');

    // 4. Level Set（预留）
    // if (this.config.enableLevelSet) this.solveLevelSet();

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
    const gravitySubSteps = Math.ceil(Math.abs(this.config.gravity) * dt / 50);

    // 3. 取两者较大值，至少为 1
    const subSteps = Math.max(1, Math.max(cflSubSteps, gravitySubSteps));

    this.advectionSolver.advect(
      this.velocityGrid,
      this.velocityGrid.read,
      dt,
      mask,
      // ★ wrapHue=false：速度场 R=vx（像素/秒），绝不能应用色相环包裹 fract，
      //   否则速度被截断到 [0,1) 导致横向速度清零。
      { boundaryMode: 'clamp', subSteps, wrapHue: false },
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
    const gravitySubSteps = Math.ceil(Math.abs(this.config.gravity) * dt / 50);
    const subSteps = Math.max(1, Math.max(cflSubSteps, gravitySubSteps));

    this.advectionSolver.advect(
      this.colorGrid,
      this.velocityGrid.read,
      dt,
      mask,
      // ★ wrapHue=true：颜色场 R=Hue（色相），需要 fract 色相环包裹，
      //   防止 Catmull-Rom 插值越界导致色相跳变。
      { boundaryMode, subSteps, wrapHue: true },
    );
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
        float eps = 1.0 / resolution.x;
        if (vUv.x < eps) {
          vel = texture2D(velTex, vec2(vUv.x + eps, vUv.y)).rg;
        } else if (vUv.x > 1.0 - eps) {
          vel = texture2D(velTex, vec2(vUv.x - eps, vUv.y)).rg;
        }
        if (vUv.y < eps) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y + eps)).rg;
        } else if (vUv.y > 1.0 - eps) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y - eps)).rg;
        }
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  // ==================== 压力投影（红-黑 SOR） ====================

  /**
   * 红-黑 SOR 压力迭代。
   * 使用 checkerboard 模式交替更新红色和黑色像素，
   * 每次迭代包含红+黑两个 Pass，压力场为单通道半精度浮点纹理。
   *
   * @param iterations 迭代轮数（每轮含红+黑两个 Pass）
   * @param omega 过松弛因子（推荐 1.5~1.8）
   */
  private solvePressure(iterations: number, omega: number): void {
    const { w, h } = this.config.resolution;
    if (w === 0 || h === 0) return;

    // 热启动：仅在第一次（无历史值）或禁用热启动时清零
    // 启用热启动时，用上一帧的压力值作为初始猜测，收敛速度大幅提升
    if (!this.config.enableWarmStart) {
      this.clearGrid(this.pressureGrid);
    }

    for (let iter = 0; iter < iterations; iter++) {
      // Pass 1: 更新红色像素 ((x+y) 为奇数 = 红色)
      this.runSORPass('red', omega);
      // Pass 2: 更新黑色像素 ((x+y) 为偶数 = 黑色)
      this.runSORPass('black', omega);
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
  private runSORPass(color: 'red' | 'black', omega: number): void {
    const key = `sor_${color}`;
    const mat = this.gpu.getMaterial(key, {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uInvResolution: { value: new THREE.Vector2(1.0 / this.config.resolution.w, 1.0 / this.config.resolution.h) },
      uOmega: { value: omega },
      uColor: { value: color === 'red' ? 0 : 1 },
      uBoundaryMode: { value: this.config.pressureBoundaryMode === 'dirichlet' ? 1 : 0 },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform vec2 uInvResolution;
      uniform float uOmega;
      uniform int uColor;
      uniform int uBoundaryMode;  // 0=Neumann(零梯度), 1=Dirichlet(固定p=0)
      varying vec2 vUv;

      void main() {
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

        // 采样四邻域压力
        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;

        // 计算散度（中心差分）
        vec2 vR = texture2D(uVelocity, vUv + vec2( ts.x, 0.0)).rg;
        vec2 vL = texture2D(uVelocity, vUv + vec2(-ts.x, 0.0)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0,  ts.y)).rg;
        vec2 vB = texture2D(uVelocity, vUv + vec2(0.0, -ts.y)).rg;

        float div = (vR.x - vL.x) * 0.5 * uInvResolution.x
                  + (vT.y - vB.y) * 0.5 * uInvResolution.y;

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
    const mat = this.gpu.getMaterial('pressureGradient', {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uInvResolution: { value: new THREE.Vector2(1.0 / this.config.resolution.w, 1.0 / this.config.resolution.h) },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform vec2 uInvResolution;
      varying vec2 vUv;

      void main() {
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

  /** 将 FluidGrid 零化（直接用 clear 代替全屏 Pass，零开销） */
  private clearGrid(grid: FluidGrid): void {
    const target = grid.write;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
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
    const colorPixels = this.readColorPixels();
    const colorIdx = (readPy * w + px) * 4;
    const r = colorPixels[colorIdx] / 255;     // = H 增量
    const g = colorPixels[colorIdx + 1] / 255; // = S 增量
    const b = colorPixels[colorIdx + 2] / 255; // = L 增量
    const a = colorPixels[colorIdx + 3] / 255; // = Alpha

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

  /**
   * 导出当前状态为 JSON 数据。
   * 包含：颜色纹理、速度纹理、所有配置参数、帧计数、模拟时间。
   */
  exportState(): string {
    const { w, h } = this.config.resolution;
    
    // 1. 回读颜色数据（uint8）
    const colorPixels = this.readColorPixels();
    const colorData: number[][] = [];
    for (let i = 0; i < w * h; i++) {
      colorData.push([
        colorPixels[i * 4],
        colorPixels[i * 4 + 1],
        colorPixels[i * 4 + 2],
        colorPixels[i * 4 + 3],
      ]);
    }
    
    // 2. 回读速度数据（使用统一的 readVelocityPixelData，自动处理 float/half-float）
    const velPixels = this.readVelocityPixelData(
      this.velocityGrid.readTarget,
      0, 0, w, h,
    );
    
    // 直接转换为二维数组（readVelocityPixelData 已返回 Float32Array）
    const velData: number[][] = [];
    for (let i = 0; i < w * h; i++) {
      const velX = velPixels[i * 2];
      const velY = velPixels[i * 2 + 1];
      velData.push([velX, velY]);
    }

    // 3. 构建导出对象
    const exportData = {
      timestamp: Date.now(),
      frameCount: this.frameCount,
      time: this.time,
      resolution: { w, h },
      config: {
        gravity: this.config.gravity,
        channels: { ...this.config.channels },
        enableAdvection: this.config.enableAdvection,
        enablePressure: this.config.enablePressure,
        enableLevelSet: this.config.enableLevelSet,
        injection: { ...this.config.injection },
        colorBoundaryMode: this.config.colorBoundaryMode,
      },
      colorTexture: colorData,
      velocityTexture: velData,
    };

    return JSON.stringify(exportData, null, 2);
  }

  // ==================== 初始化 ====================

  /** 根据当前 config 重新创建 FluidGrid */
  private rebuildGrids(): void {
    const colorCh = Math.max(
      1,
      ['r', 'g', 'b', 'a'].filter(
        (k) => this.config.channels[k as keyof typeof this.config.channels],
      ).length,
    );

    const velDataType: VelocityDataType = this.config.velocityDataType || 'float';

    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();

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

  // ==================== 销毁 ====================

  dispose(): void {
    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();
    this.advectionSolver.dispose();
    this.gpu.dispose();
  }
}
