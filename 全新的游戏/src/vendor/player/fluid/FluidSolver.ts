import * as THREE from 'three';
import { FluidGrid, type AdvectionMask } from './core/FluidGrid';
import { GPUOps } from './core/GPUOps';
import { AdvectionSolver } from './solvers/AdvectionSolver';
import { LevelSetSolver } from './solvers/LevelSetSolver';
import { FluidInjector } from './core/FluidInjector';

// ============================================================
// 类型定义
// ============================================================

/** 持续注入源 / 一次性注入配置 */
export interface InjectionConfig {
  enabled: boolean;
  position: { x: number; y: number };          // 归一化 (0~1)，Y向下为正
  radius: number;                              // 归一化半径
  velocity: { x: number; y: number };          // 像素/秒，Y向下为正
  color?: [number, number, number, number];    // HSLA (vector 模式注入颜色)
  density?: number;                            // 0~1 (scalar 模式注入浓度)
  rate?: number;                               // 混合率 0~1
  wave?: { enabled: boolean; amplitude: number; frequency: number; phase?: number };
  waypoints?: { x: number; y: number }[];
  waypointMode?: 'forward' | 'backward' | 'pingpong';
  waypointSpeed?: number;
  /** ★ 间歇注入（脉冲）：注入 onDuration 秒 → 暂停 offDuration 秒 → 循环。
   *   间歇切换增强视觉对比（连续注入会糊成一片）。无该字段 = 持续注入。 */
  intermittent?: { onDuration: number; offDuration: number };
}

/**
 * ★ 爆炸注入配置（参照旧库 FluidSimulatorAdapter.explode）。
 * 散度脉冲（压力源，推开流体）+ 可选水量 + 指数时间包络 + 扰动。
 */
export interface ExplosionConfig {
  /** 爆炸中心（归一化 0~1，Y向下为正） */
  cx: number;
  cy: number;
  /** 归一化半径 */
  radius: number;
  /** 散度强度：负 = 向外爆炸（源），正 = 向内收缩（汇）。旧库爆炸用 25000 量级 */
  strength: number;
  /** 是否注入水团（vector=颜色 alpha，scalar=密度） */
  createWater?: boolean;
  /** 水团颜色（HSLA，vector 模式；缺省白色 h=0.55 s=0.3 l=0.85） */
  waterColor?: [number, number, number, number];
  /** 硬性截止时长（秒，默认 0.1） */
  duration?: number;
  /** ★ 每帧衰减系数（0~1，默认 0.9）：指数包络 envelope ×= decay，
   *   防止前几帧高压持续注入导致速度场膨胀填满纹理 */
  decay?: number;
  /** 水量倍数（默认 1） */
  waterMultiplier?: number;
  /** 随机扰动强度（碎片感/不规则冲击波，默认 0） */
  perturbation?: number;
  /**
   * ★ 爆炸期间临时抬升全局速度上限（px/s）：触发时覆盖 maxVelocity，
   * velCapDuration 秒后开始 smoothstep 回落——水团能被炸飞，之后张力/外速抑制再收拢。
   * 不设 = 不改变限幅。
   */
  velCap?: number;
  /** velCap 保持时长（秒，默认 = duration + 0.5） */
  velCapDuration?: number;
  /** velCap 回落时长（秒，默认 1.5） */
  velCapRecovery?: number;
}

export interface FluidSolverConfig {
  resolution: { w: number; h: number };
  channels: { r: boolean; g: boolean; b: boolean; a: boolean }; // 物理 RGBA，逻辑 HSLA
  enableAdvection: boolean;
  enablePressure: boolean;
  pressureIterations: number;
  pressureOmega: number;
  pressureBoundaryMode: 'dirichlet' | 'neumann';
  enableWarmStart: boolean;
  gravity: { x: number; y: number };           // 像素/秒²
  velocityScale: number;
  maxVelocity: number;
  /** ★ 运动粘度 ν（cells²/s），0=无粘性。速度扩散抹平射流/剪切 → 水团内聚 */
  viscosity?: number;
  colorBoundaryMode: 'clamp' | 'repeat' | 'zero';
  advectionMode: 'vector' | 'scalar';
  combineMode: 'add' | 'sub';
  scalarConfig: {
    hMultiplier: number;
    sMultiplier: number;
    lMultiplier: number;
    aMultiplier: number;
    baselineDensity: number;
    decayRate: number;
  };
  /** Level Set 模块配置（轻量化，默认关闭） */
  levelSetConfig: {
    enabled: boolean;
    reinitIterations: number;
    surfaceTension: number;
    smoothingRadius: number;
    reinitInterval?: number;
    narrowBandWidth?: number;
    constrainLiquid?: boolean;
    clampAirPhi?: boolean;
    maxAirPhi?: number;
    compensateWaterPhi?: boolean;
    waterCompensationRate?: number;
    /** ★ 外向速度抑制（0~1）：界面窄带内削减指向空气侧的法向速度，确定性收拢保证 */
    outwardDamping?: number;
  };
  continuousSources: InjectionConfig[];
  obstacle?: { width: number; height: number; data: string };
}

export const defaultFluidConfig: FluidSolverConfig = {
  resolution: { w: 512, h: 512 },
  channels: { r: true, g: true, b: true, a: true },
  enableAdvection: true,
  enablePressure: true,
  pressureIterations: 20,
  pressureOmega: 1.7,
  pressureBoundaryMode: 'dirichlet',
  enableWarmStart: true,
  gravity: { x: 0, y: 0 },
  velocityScale: 1,
  maxVelocity: 5000,
  viscosity: 0,
  colorBoundaryMode: 'clamp',
  advectionMode: 'vector',
  combineMode: 'add',
  scalarConfig: {
    hMultiplier: 1,
    sMultiplier: 1,
    lMultiplier: 1,
    aMultiplier: 1,
    baselineDensity: 1.0,
    decayRate: 0,
  },
  levelSetConfig: {
    enabled: false,
    reinitIterations: 2,
    surfaceTension: 10000,
    smoothingRadius: 2,
    reinitInterval: 10,
    narrowBandWidth: 5,
    constrainLiquid: false,
    clampAirPhi: true,
    maxAirPhi: 0,
    compensateWaterPhi: true,
    waterCompensationRate: 0.1,
  },
  continuousSources: [],
};

// ============================================================
// 路径点巡游状态
// ============================================================
interface WaypointState {
  logicalStep: number;
  progress: number;
  currentPosition: { x: number; y: number };
  lastWaypointCount: number;
}

// ============================================================
// FluidSolver —— 轻量解算器门面（播放器版）
// ============================================================
//
// 移植自主编辑器 FluidSolver（另起的绘画网页），保留全部物理语义：
//   - GPU Pass 使用 vUv=uv（不翻转 Y）；composite() 渲染到内部 RenderTarget
//   - 压力 SOR 散度公式：div = (vR.x-vL.x)*0.5*uInvRes.x + ...（乘 invRes）
//   - clearGrid 用 renderer.clear()（单通道密度场安全）
//   - 残差原始数据永不被消耗：_pendingResidual 上传后不置 null
//
// 播放器用法：
//   - loadResidual(residualData, w, h)：上传量化残差（RGBA Uint8，R=H 量化 6bit 等）
//   - setBaseHsl(data, w, h)：上传 Float32 HSLA 基础色（MCSDA 合成）
//   - step(dt)：单步模拟；composite()：产出合成纹理
//   - getCompositeTexture()：喂给渲染网格的 uColorTex
export class FluidSolver {
  private renderer: THREE.WebGLRenderer;
  private gpu: GPUOps;
  private advectionSolver: AdvectionSolver;
  private levelSetSolver: LevelSetSolver;
  private injector: FluidInjector;

  config: FluidSolverConfig;

  // 四场
  colorGrid!: FluidGrid;     // RGBA Uint8，量化残差（HSLA）
  velocityGrid!: FluidGrid;  // RG HalfFloat，像素/秒
  pressureGrid!: FluidGrid;  // R HalfFloat，压力
  densityGrid!: FluidGrid;   // R Uint8，标量浓度（scalar 模式）
  /** ★ 散度源场（爆炸/源汇压力源项；solvePressure 消费后清空） */
  divergenceGrid!: FluidGrid;

  // ★ Level Set φ 场（懒加载，仅启用时分配显存）
  private _phiGrid: FluidGrid | null = null;
  /** ★ Level Set 重建间隔帧计数（每 reinitInterval 帧执行一次「φ 重建 + reinit」） */
  private levelSetFrameCount = 0;
  /** ★ 爆炸限幅覆盖（velCap）：抬升值 / 保持截止 / 回落完成（this.time 秒） */
  private velCapOverride: { value: number; until: number; recoverUntil: number } | null = null;

  // 基础色纹理（FloatType RGBA HSLA，0~1）——合成用
  private baseHslTex: THREE.DataTexture | null = null;
  // 原始残差数据（永不消耗，供 reset 恢复）
  private _pendingResidual: Uint8Array | null = null;
  private _residualWidth = 0;
  private _residualHeight = 0;

  // 障碍物纹理（从区域实体 boundary 光栅化而来）
  private obstacleTex: THREE.Texture | null = null;

  // 合成输出目标（每帧 composite() 写入，渲染层读取其 texture）
  private compositeTarget: THREE.WebGLRenderTarget | null = null;
  private compositeScene: THREE.Scene;
  private compositeCamera: THREE.OrthographicCamera;
  private compositeQuad: THREE.Mesh;
  private compositeMat: THREE.ShaderMaterial | null = null;

  // 时间/帧
  private time = 0;
  private frameCount = 0;

  // 路径点状态（按源 id 索引）
  private waypointStates = new Map<number, WaypointState>();

  // 待执行的一次性注入队列
  private injectionQueue: InjectionConfig[] = [];
  /** ★ 活跃爆炸队列（step 内按指数包络逐帧推进，播完移除） */
  private activeExplosions: Array<ExplosionConfig & { elapsed: number; envelope: number }> = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    config: FluidSolverConfig,
    resolution: { w: number; h: number },
  ) {
    this.renderer = renderer;
    this.config = {
      ...config,
      resolution: { ...resolution },
      scalarConfig: { ...config.scalarConfig },
      levelSetConfig: { ...config.levelSetConfig },
    };

    this.gpu = new GPUOps();
    this.advectionSolver = new AdvectionSolver(renderer);
    this.levelSetSolver = new LevelSetSolver(renderer, this.gpu);
    this.injector = new FluidInjector(renderer, this.gpu);

    // 合成场景（全屏四边形）
    this.compositeScene = new THREE.Scene();
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.compositeScene.add(this.compositeQuad);

    this.rebuildGrids();
    this.initFields();

    if (this.config.levelSetConfig?.enabled) {
      this.enableLevelSet();
    }
  }

  // ★ Level Set φ 场懒加载 getter
  private get phiGrid(): FluidGrid {
    if (!this._phiGrid) {
      const { w, h } = this.config.resolution;
      this._phiGrid = new FluidGrid({ w, h }, 1, 'half-float');
      this.initPhiField();
    }
    return this._phiGrid;
  }

  // ==================== 网格构建 ====================

  private rebuildGrids(): void {
    const { w, h } = this.config.resolution;
    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();
    this.densityGrid?.dispose();
    this.divergenceGrid?.dispose();

    this.colorGrid = new FluidGrid({ w, h }, 4, 'uint8');
    this.velocityGrid = new FluidGrid({ w, h }, 2, 'half-float');
    this.pressureGrid = new FluidGrid({ w, h }, 1, 'half-float');
    this.densityGrid = new FluidGrid({ w, h }, 1, 'uint8');
    // ★ 散度源场（爆炸/源汇压力源项；solvePressure 消费后清空）
    this.divergenceGrid = new FluidGrid({ w, h }, 1, 'half-float');

    if (this._phiGrid) {
      this._phiGrid.dispose();
      this._phiGrid = new FluidGrid({ w, h }, 1, 'half-float');
      this.initPhiField();
    }

    this.compositeTarget?.dispose();
    this.compositeTarget = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  // ==================== 数据加载 ====================

  /**
   * 上传量化残差到 colorGrid。
   * 期望格式（RGBA Uint8）：
   *   R = qH/63*255, G = qS/31*255, B = qL/31*255, A = 255
   * 合成着色器反量化：dH = (r/255 * 2 - 1) * uResidualRangeH（uResidualRangeH=0.5）
   */
  loadResidual(data: Uint8Array, width: number, height: number): void {
    this._pendingResidual = new Uint8Array(data);
    this._residualWidth = width;
    this._residualHeight = height;
    this.uploadResidualToColorGrid();
  }

  private uploadResidualToColorGrid(): void {
    if (!this._pendingResidual) return;
    const w = this._residualWidth;
    const h = this._residualHeight;

    const tex = new THREE.DataTexture(
      this._pendingResidual,
      w, h, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.flipY = false;
    tex.needsUpdate = true;

    const mat = this.gpu.getMaterial('fluid_copy_residual', {
      uTex: { value: tex },
    }, `
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main(){ gl_FragColor = texture2D(uTex, vUv); }
    `);
    this.gpu.render(this.renderer, this.colorGrid.write, mat);
    this.colorGrid.swap();

    // 注意：_pendingResidual 不置 null，永久保留供 reset 恢复
    tex.dispose();
  }

  /**
   * 设置基础色 HSL 浮点纹理（FloatType RGBA，HSLA 0~1）。
   */
  setBaseHsl(data: Float32Array, width: number, height: number): void {
    if (width <= 0 || height <= 0 || data.length < width * height * 4) {
      this.clearBaseHsl();
      return;
    }
    this.baseHslTex?.dispose();
    this.baseHslTex = new THREE.DataTexture(
      data, width, height, THREE.RGBAFormat, THREE.FloatType,
    );
    this.baseHslTex.minFilter = THREE.LinearFilter;
    this.baseHslTex.magFilter = THREE.LinearFilter;
    this.baseHslTex.flipY = false;
    this.baseHslTex.needsUpdate = true;
  }

  /** 清除基础色纹理，使 composite 退化为 direct 模式（colorGrid 即合成色） */
  clearBaseHsl(): void {
    this.baseHslTex?.dispose();
    this.baseHslTex = null;
  }

  /** 设置障碍物纹理（R 通道：0=流体，255=墙）。null 表示无墙体。 */
  setObstacleTexture(tex: THREE.Texture | null): void {
    this.obstacleTex = tex;
  }

  private getObstacleTex(): THREE.Texture {
    return this.obstacleTex || this.getZeroObstacleTexFallback();
  }

  private _zeroObstacleFallback: THREE.DataTexture | null = null;
  private getZeroObstacleTexFallback(): THREE.Texture {
    if (!this._zeroObstacleFallback) {
      this._zeroObstacleFallback = new THREE.DataTexture(
        new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType,
      );
      this._zeroObstacleFallback.minFilter = THREE.NearestFilter;
      this._zeroObstacleFallback.magFilter = THREE.NearestFilter;
      this._zeroObstacleFallback.needsUpdate = true;
    }
    return this._zeroObstacleFallback;
  }

  // ==================== Level Set 公共 API ====================

  enableLevelSet(): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.enabled = true;
    const _ = this.phiGrid;
    void _;
  }

  disableLevelSet(): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.enabled = false;
    this._phiGrid?.dispose();
    this._phiGrid = null;
  }

  resetLevelSet(): void {
    if (!this._phiGrid) return;
    this.initPhiField();
  }

  setSurfaceTension(sigma: number): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.surfaceTension = sigma;
  }

  /**
   * φ 场初始化：基于 density（scalar 模式）或 colorGrid.alpha（vector 模式）推断 SDF。
   */
  private initPhiField(): void {
    if (!this._phiGrid) return;
    const ls = this.config.levelSetConfig;
    const scale = ls?.smoothingRadius ?? 2;
    const isScalar = this.config.advectionMode === 'scalar';
    const sourceTex = isScalar ? this.densityGrid.read : this.colorGrid.read;
    const mode: 0 | 1 = isScalar ? 0 : 1;
    this.levelSetSolver.initPhiField(this._phiGrid, sourceTex, mode, scale);
  }

  /**
   * ★ φ 场后处理（空气钳制 + 水体补偿）——与流体编辑器一致。
   */
  private applyPhiCorrection(): void {
    if (!this._phiGrid) return;
    const ls = this.config.levelSetConfig;
    const clampAir = ls?.clampAirPhi ?? true;
    const maxAirPhi = ls?.maxAirPhi ?? 0;
    const compensate = ls?.compensateWaterPhi ?? true;
    const compRate = ls?.waterCompensationRate ?? 0.1;
    this.levelSetSolver.applyPhiCorrection(
      this._phiGrid, this.getObstacleTex(), clampAir, maxAirPhi, compensate, compRate,
    );
  }

  // ==================== 场清零 ====================

  /**
   * 清空渲染目标为全零（比 shader 输出 vec4(0) 可靠，单通道也安全）。
   * ★ 必须临时把 clearColor 强制为黑/透明：renderer.clear() 写入的是"当前清屏色"，
   *   若全局清屏色非黑（如主场景的 0xcccccc），密度场会被初始化成 0.8 的假浓度——
   *   MCSDA sub 模式下整块纹理直接变近黑，随后被 decayRate 缓慢消化（=周期性黑团消散）。
   */
  private clearGrid(grid: FluidGrid): void {
    const prev = this.renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(grid.write);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.renderer.setRenderTarget(prev);
    grid.swap();
  }

  /** 初始化场：colorGrid 已由残差上传，仅清零速度/压力/密度 */
  initFields(): void {
    this.clearGrid(this.velocityGrid);
    this.clearGrid(this.pressureGrid);
    // ★ density 初始化为 0（与流体编辑器一致）。合成公式 factor=density/baseline，
    //   初始 0 → factor=0 无偏移；若初始化为 baseline 则全场 factor=1 整体提亮。
    this.clearGrid(this.densityGrid);
    // colorGrid 重新上传残差，恢复初始静态残差
    this.uploadResidualToColorGrid();
  }

  // ==================== 平流（委托 AdvectionSolver）====================

  /**
   * CFL 子步数：保证每个子步回溯距离 ≤ 1 像素。
   * 同时考虑重力（避免无速度时重力失稳）。
   */
  private computeSubSteps(dt: number): number {
    const maxVel = this.config.maxVelocity || 5000;
    const minGrid = Math.min(this.config.resolution.w, this.config.resolution.h);
    const cfl = Math.ceil((maxVel * dt) / minGrid);
    const g = this.config.gravity;
    const gMag = Math.sqrt(g.x * g.x + g.y * g.y);
    const gSub = Math.ceil((gMag * dt) / 50);
    return Math.max(1, Math.max(cfl, gSub));
  }

  private advect(grid: FluidGrid, velocityTex: THREE.Texture, dt: number, mask: AdvectionMask, boundaryMode: 'clamp' | 'repeat' | 'zero', wrapHue: boolean): void {
    const subSteps = this.computeSubSteps(dt);
    this.advectionSolver.advect(grid, velocityTex, dt, mask, {
      subSteps,
      boundaryMode,
      wrapHue,
      obstacleTexture: this.obstacleTex || undefined,
    });
  }

  // ==================== 重力 ====================

  private applyGravity(dt: number): void {
    const g = this.config.gravity;
    if (g.x === 0 && g.y === 0) return;
    this.injector.injectVelocity(
      this.velocityGrid,
      { x: g.x * dt, y: g.y * dt },
      { global: true, obstacle: this.obstacleTex || undefined },
    );
  }

  // ==================== 持续注入源 ====================

  private processContinuousSources(dt: number): void {
    const isScalar = this.config.advectionMode === 'scalar';
    const ch = this.config.channels;

    for (let i = 0; i < this.config.continuousSources.length; i++) {
      const src = this.config.continuousSources[i];
      if (!src.enabled) continue;

      // ★ 间歇注入脉冲门控：onDuration 秒注入 → offDuration 秒暂停 → 循环。
      //   用解算器累计时间（this.time）驱动，暂停/续播时相位连续、不跳变。
      const int = src.intermittent;
      if (int && int.onDuration > 0) {
        const period = int.onDuration + Math.max(0, int.offDuration || 0);
        if (period <= 0) continue;
        if (this.time % period >= int.onDuration) continue; // 间歇期：本帧不注入
      }

      const config = { ...src };

      // 路径点插值
      const wps = config.waypoints;
      if (wps && wps.length >= 2) {
        const mode = config.waypointMode || 'forward';
        const speed = config.waypointSpeed ?? 1.0;
        const total = wps.length;
        let state = this.waypointStates.get(i);
        if (!state || state.lastWaypointCount !== total) {
          const startPos = mode === 'backward' ? wps[total - 1] : wps[0];
          state = { logicalStep: 0, progress: 0, currentPosition: { ...startPos }, lastWaypointCount: total };
          this.waypointStates.set(i, state);
        }
        state.progress += dt * speed;
        while (state.progress >= 1.0) { state.progress -= 1.0; state.logicalStep++; }
        let idx0: number, idx1: number;
        if (mode === 'forward') {
          idx0 = ((state.logicalStep % total) + total) % total;
          idx1 = (idx0 + 1) % total;
        } else if (mode === 'backward') {
          idx0 = total - 1 - (((state.logicalStep % total) + total) % total);
          idx1 = total - 1 - ((((state.logicalStep + 1) % total) + total) % total);
        } else {
          const cycle = total > 1 ? (total - 1) * 2 : 1;
          const pos = ((state.logicalStep % cycle) + cycle) % cycle;
          if (pos < total - 1) { idx0 = pos; idx1 = pos + 1; }
          else { const rev = cycle - pos; idx0 = rev; idx1 = Math.max(0, rev - 1); }
        }
        const p0 = wps[idx0], p1 = wps[idx1], t = state.progress;
        state.currentPosition = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
        if (!isFinite(state.currentPosition.x) || !isFinite(state.currentPosition.y)) {
          state.currentPosition = { ...wps[0] };
        }
        config.position = { ...state.currentPosition };
      }

      // 波形方向控制
      if (config.wave?.enabled) {
        const { amplitude, frequency, phase = 0 } = config.wave;
        const speedMag = Math.hypot(config.velocity.x, config.velocity.y);
        if (isFinite(amplitude) && isFinite(frequency) && isFinite(speedMag) && speedMag > 0) {
          const angle = amplitude * Math.sin(2 * Math.PI * frequency * this.time + phase);
          const baseAngle = Math.atan2(config.velocity.y, config.velocity.x);
          const newAngle = baseAngle + angle;
          config.velocity = { x: speedMag * Math.cos(newAngle), y: speedMag * Math.sin(newAngle) };
        }
      }

      if (!isFinite(config.position.x) || !isFinite(config.position.y)) continue;
      if (!isFinite(config.velocity.x) || !isFinite(config.velocity.y)) continue;

      const opts = {
        position: config.position,
        radius: config.radius,
        obstacle: this.obstacleTex || undefined,
      };

      // 颜色注入（仅 vector 模式）
      if (!isScalar && config.color) {
        this.injector.injectColor(
          this.colorGrid,
          { h: config.color[0], s: config.color[1], l: config.color[2], a: config.color[3] },
          config.rate ?? 1.0,
          opts,
          ch,
        );
      }
      // 速度注入
      this.injector.injectVelocity(this.velocityGrid, config.velocity, opts);
      // density 注入（仅 scalar 模式）
      if (isScalar && config.density !== undefined) {
        this.injector.injectDensity(this.densityGrid, config.density, 1.0, opts);
      }
    }
  }

  /** 一次性注入入队（画布点击触发） */
  queueInjection(config: InjectionConfig): void {
    this.injectionQueue.push(config);
  }

  private processInjectionQueue(): void {
    if (this.injectionQueue.length === 0) return;
    const isScalar = this.config.advectionMode === 'scalar';
    const ch = this.config.channels;
    for (const inj of this.injectionQueue) {
      const opts = {
        position: inj.position,
        radius: inj.radius,
        obstacle: this.obstacleTex || undefined,
      };
      if (!isScalar && inj.color) {
        this.injector.injectColor(
          this.colorGrid,
          { h: inj.color[0], s: inj.color[1], l: inj.color[2], a: inj.color[3] },
          inj.rate ?? 1.0, opts, ch,
        );
      } else if (isScalar && inj.density !== undefined) {
        this.injector.injectDensity(this.densityGrid, inj.density, 1.0, opts);
      }
      this.injector.injectVelocity(this.velocityGrid, inj.velocity, opts);
    }
    this.injectionQueue.length = 0;
  }

  // ==================== 爆炸注入（散度源 → 压力源 → 推开流体）====================

  /** ★ 触发一次爆炸（参照旧库 explode）：散度源（压力源→推开流体）+ 直接速度冲击 */
  explode(config: ExplosionConfig): void {
    this.activeExplosions.push({ ...config, elapsed: 0, envelope: 1 });
    // ★ 限幅联动：抬升 → 保持 → smoothstep 缓落（否则日常限幅会钳死冲击）
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

  /** 活跃爆炸逐帧推进（step 内、压力投影前调用） */
  private processExplosions(dt: number): void {
    if (this.activeExplosions.length === 0) return;
    const isScalar = this.config.advectionMode === 'scalar';
    const ch = this.config.channels;

    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const ex = this.activeExplosions[i];
      const duration = ex.duration ?? 0.1;
      ex.elapsed += dt;

      // ★ 指数包络：envelope ×= decay（防前几帧高压持续注入 → 填满纹理）
      const decay = ex.decay ?? 0.9;
      ex.envelope *= Math.max(0, Math.min(1, decay));
      const envelope = ex.envelope;
      if (envelope <= 0.01 || ex.elapsed >= duration) {
        this.activeExplosions.splice(i, 1);
        continue;
      }

      const obstacle = this.obstacleTex || undefined;
      const perturb = ex.perturbation ?? 0;
      const jitterX = perturb > 0 ? (Math.random() - 0.5) * 2 * perturb * ex.radius : 0;
      const jitterY = perturb > 0 ? (Math.random() - 0.5) * 2 * perturb * ex.radius : 0;

      // ① 散度源注入（压力方程源项 → 压力梯度推开流体）
      this.injector.injectDivergenceSource(this.divergenceGrid, ex.strength * envelope, {
        position: { x: ex.cx + jitterX, y: ex.cy + jitterY },
        radius: ex.radius * (1 + perturb * (Math.random() - 0.5)),
        obstacle,
      });

      // ② ★ 速度冲击 = 径向主推力（逐像素远离中心，方向随 strength 符号翻转）
      //    + 随机抖动降为撕裂细节
      const radialSpeed = -ex.strength * envelope * 0.12;
      this.injector.injectRadialVelocity(this.velocityGrid, radialSpeed * dt, {
        position: { x: ex.cx + jitterX, y: ex.cy + jitterY },
        radius: ex.radius,
        obstacle,
      });
      const velImpulse = ex.strength * envelope * 0.03;
      const jitterAngle = Math.random() * Math.PI * 2;
      this.injector.injectVelocity(this.velocityGrid, {
        x: Math.cos(jitterAngle) * velImpulse * dt,
        y: Math.sin(jitterAngle) * velImpulse * dt,
      }, {
        position: { x: ex.cx + jitterX, y: ex.cy + jitterY },
        radius: ex.radius,
        obstacle,
      });

      // ③ 水量注入（可选）：vector = 颜色 alpha，scalar = 密度
      const waterMult = ex.waterMultiplier ?? 1;
      if (ex.createWater && waterMult > 0) {
        const rate = Math.min(1, 0.6 * envelope * waterMult);
        const opts = {
          position: { x: ex.cx, y: ex.cy },
          radius: ex.radius,
          obstacle,
        };
        if (isScalar) {
          this.injector.injectDensity(this.densityGrid, rate, rate, opts);
        } else {
          const wc = ex.waterColor ?? [0.55, 0.3, 0.85, rate];
          this.injector.injectColor(
            this.colorGrid,
            { h: wc[0], s: wc[1], l: wc[2], a: wc[3] },
            rate, opts, ch,
          );
        }
      }
    }
  }

  // ==================== 边界处理（零梯度，自由流出）====================

  private applyBoundary(): void {
    const { w, h } = this.config.resolution;
    const mat = this.gpu.getMaterial('fluid_boundary', {
      velTex: { value: this.velocityGrid.read },
      resolution: { value: new THREE.Vector2(w, h) },
    }, `
      uniform sampler2D velTex;
      uniform vec2 resolution;
      varying vec2 vUv;
      void main(){
        vec2 vel = texture2D(velTex, vUv).rg;
        float epsX = 1.0 / resolution.x;
        float epsY = 1.0 / resolution.y;
        if (vUv.x < epsX) vel = texture2D(velTex, vec2(vUv.x + epsX, vUv.y)).rg;
        else if (vUv.x > 1.0 - epsX) vel = texture2D(velTex, vec2(vUv.x - epsX, vUv.y)).rg;
        if (vUv.y < epsY) vel = texture2D(velTex, vec2(vUv.x, vUv.y + epsY)).rg;
        else if (vUv.y > 1.0 - epsY) vel = texture2D(velTex, vec2(vUv.x, vUv.y - epsY)).rg;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  // ==================== 压力投影（红-黑 SOR）====================

  private solvePressure(iterations: number, omega: number, phiTex: THREE.Texture | null = null): void {
    const { w, h } = this.config.resolution;
    if (w === 0 || h === 0) return;
    if (!this.config.enableWarmStart) this.clearGrid(this.pressureGrid);
    for (let iter = 0; iter < iterations; iter++) {
      this.runSORPass('red', omega, phiTex);
      this.runSORPass('black', omega, phiTex);
    }
  }

  private runSORPass(color: 'red' | 'black', omega: number, phiTex: THREE.Texture | null = null): void {
    const { w, h } = this.config.resolution;
    const isRedPass = color === 'red';
    const boundaryMode = this.config.pressureBoundaryMode || 'dirichlet';

    // ★ 自由表面模式用独立材质 key（shader 不同，避免缓存串扰）
    const key = `fluid_sor_${isRedPass ? 'red' : 'black'}_${boundaryMode}${phiTex ? '_fs' : ''}`;
    const mat = this.gpu.getMaterial(key, {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uDivSource: { value: this.divergenceGrid.read },
      uObstacle: { value: this.getObstacleTex() },
      uPhi: { value: phiTex ?? this.getObstacleTex() },
      uPhiOn: { value: phiTex ? 1 : 0 },
      uOmega: { value: omega },
      uInvRes: { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
      uIsRed: { value: isRedPass ? 1 : 0 },
      uBoundaryMode: { value: boundaryMode === 'neumann' ? 1 : 0 },
    }, `
      uniform sampler2D uPressure;
      uniform sampler2D uDivSource;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform float uOmega;
      uniform vec2 uInvRes;
      uniform int uIsRed;
      uniform int uBoundaryMode;
      uniform sampler2D uPhi;
      uniform int uPhiOn;   // 1=自由表面边界（φ>0 空气区压力恒 0）
      varying vec2 vUv;
      void main(){
        // 墙内压力强制为 0
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        // ★ 自由表面：空气区（φ>0）压力强制为 0 —— 液体是有表面的不可压缩整体
        if (uPhiOn == 1 && texture2D(uPhi, vUv).r > 0.0) {
          gl_FragColor = vec4(0.0);
          return;
        }
        vec2 ts = uInvRes;
        // Dirichlet: 边缘压力 = 0
        if (uBoundaryMode == 0) {
          if (vUv.x < ts.x || vUv.x > 1.0 - ts.x || vUv.y < ts.y || vUv.y > 1.0 - ts.y) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }
        }
        // 红黑判断
        vec2 pixel = vUv / ts;
        ivec2 ipixel = ivec2(int(pixel.x), int(pixel.y));
        int parity = (ipixel.x + ipixel.y) & 1;
        if (uIsRed == 1) {
          if (parity == 0) { gl_FragColor = texture2D(uPressure, vUv); return; }
        } else {
          if (parity == 1) { gl_FragColor = texture2D(uPressure, vUv); return; }
        }
        // 邻居压力
        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;
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
        // ★ 散度（中心差分）：div = (vR.x - vL.x)*0.5*ts.x + (vT.y - vB.y)*0.5*ts.y
        //   注意是 * ts（= * 1/res），不是 / ts。/ ts 会差 res² 倍，压力解完全错误。
        vec2 vR = texture2D(uVelocity, vUv + vec2( ts.x, 0.0)).rg;
        vec2 vL = texture2D(uVelocity, vUv + vec2(-ts.x, 0.0)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0,  ts.y)).rg;
        vec2 vB = texture2D(uVelocity, vUv + vec2(0.0, -ts.y)).rg;
        float div = (vR.x - vL.x) * 0.5 * ts.x + (vT.y - vB.y) * 0.5 * ts.y;
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

  private applyPressureGradient(): void {
    const { w, h } = this.config.resolution;
    const mat = this.gpu.getMaterial('fluid_pressureGradient', {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uObstacle: { value: this.getObstacleTex() },
      uInvRes: { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
    }, `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      varying vec2 vUv;
      void main(){
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        vec2 ts = uInvRes;
        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;
        vec2 gradP = vec2(pR - pL, pT - pB) * 0.5 / ts;
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel -= gradP;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  /**
   * ★ 粘度：速度场显式扩散 ∂v/∂t = ν∇²v（与编辑器 VelocitySolver.applyViscosity 同款）。
   * 稳定性：ν·dt ≤ 0.2/步，超出子步分摊（上限 64 步，等效强度饱和不失稳）。
   */
  private applyViscosity(dt: number): void {
    const nu = this.config.viscosity ?? 0;
    if (nu <= 0 || dt <= 0) return;

    const w = this.velocityGrid.resolution.w;
    const h = this.velocityGrid.resolution.h;
    const total = nu * dt;
    const steps = Math.min(64, Math.max(1, Math.ceil(total / 0.2)));
    const perStep = Math.min(0.2, total / steps);

    const mat = this.gpu.getMaterial('fluid_viscosity_v1', {
      uVelocity: { value: this.velocityGrid.read },
      uObstacle: { value: this.getObstacleTex() },
      uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
      uDtNu: { value: perStep },
    }, `
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      uniform float uDtNu;
      varying vec2 vUv;
      void main(){
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
        gl_FragColor = vec4(vC + uDtNu * (vL + vR + vT + vB - 4.0 * vC), 0.0, 1.0);
      }
    `);

    for (let i = 0; i < steps; i++) {
      mat.uniforms.uVelocity.value = this.velocityGrid.read;
      this.gpu.render(this.renderer, this.velocityGrid.write, mat);
      this.velocityGrid.swap();
    }
  }

  // ==================== 速度限幅/缩放 ====================

  private clampVelocity(maxSpeed: number): void {
    const mat = this.gpu.getMaterial('fluid_clampVel', {
      uVelocity: { value: this.velocityGrid.read },
      uMaxSpeed: { value: maxSpeed },
    }, `
      uniform sampler2D uVelocity;
      uniform float uMaxSpeed;
      varying vec2 vUv;
      void main(){
        vec2 vel = texture2D(uVelocity, vUv).rg;
        float len = length(vel);
        if (len > uMaxSpeed) vel = vel / len * uMaxSpeed;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  private scaleVelocity(scale: number): void {
    const mat = this.gpu.getMaterial('fluid_scaleVel', {
      uVelocity: { value: this.velocityGrid.read },
      uScale: { value: scale },
    }, `
      uniform sampler2D uVelocity;
      uniform float uScale;
      varying vec2 vUv;
      void main(){
        vec2 vel = texture2D(uVelocity, vUv).rg;
        gl_FragColor = vec4(vel * uScale, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  // ==================== density 衰减 ====================

  private decayDensity(): void {
    const decayRate = this.config.scalarConfig?.decayRate ?? 0;
    if (!decayRate || decayRate <= 0) return;
    const keep = Math.max(0.01, 1 - Math.min(0.99, decayRate));
    const mat = this.gpu.getMaterial('fluid_decayDensity', {
      uDensity: { value: this.densityGrid.read },
      uKeep: { value: keep },
    }, `
      uniform sampler2D uDensity;
      uniform float uKeep;
      varying vec2 vUv;
      void main(){
        float d = texture2D(uDensity, vUv).r;
        gl_FragColor = vec4(d * uKeep, 0.0, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.densityGrid.write, mat);
    this.densityGrid.swap();
  }

  // ==================== 单步模拟 ====================

  step(dt: number): void {
    if (dt <= 0) return;
    this.frameCount++;
    const cfg = this.config;
    const isScalar = cfg.advectionMode === 'scalar';

    // 0. 一次性注入队列（优先执行，本帧生效）
    this.processInjectionQueue();

    // 1. 重力
    this.applyGravity(dt);

    // 2. 持续注入源
    this.processContinuousSources(dt);

    // 3. 平流
    if (cfg.enableAdvection) {
      // 速度自平流
      this.advect(this.velocityGrid, this.velocityGrid.read, dt,
        { r: true, g: true, b: false, a: false }, 'clamp', false);
      // 颜色/density 平流
      if (isScalar) {
        this.advect(this.densityGrid, this.velocityGrid.read, dt,
          { r: true, g: false, b: false, a: false }, 'clamp', false);
        this.decayDensity();
      } else {
        this.advect(this.colorGrid, this.velocityGrid.read, dt,
          cfg.channels, cfg.colorBoundaryMode || 'clamp', true);
      }
    }

    // 3.2 ★ Level Set 模块（热插拔，仅启用且 phiGrid 已初始化时执行）
    //    两种模式（与流体编辑器一致）：
    //      A. 约束模式（constrainLiquid=true）→ 每帧「φ 重建 + reinit + 约束」
    //      B. 追踪模式（默认）→ φ 平流 + 周期性重建 + 表面张力
    const ls = this.config.levelSetConfig;
    if (ls?.enabled && this._phiGrid) {
      const iterations = ls.reinitIterations;
      const band = ls.narrowBandWidth ?? ls.smoothingRadius ?? 5;
      const constrain = !!ls.constrainLiquid;

      if (constrain) {
        this.initPhiField();
        this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTex(), iterations, 0.5);
        this.applyPhiCorrection();
        // ★ 去斑：补洞+拔刺（alpha 噪声像素→孤立翻转点→渲染黑/白点）
        this.levelSetSolver.applyDespeckle(this._phiGrid, this.getObstacleTex());
        const mode = this.config.advectionMode === 'scalar' ? 0 : 1;
        const targetGrid = this.config.advectionMode === 'scalar' ? this.densityGrid : this.colorGrid;
        this.levelSetSolver.applyLiquidConstraint(
          targetGrid, this._phiGrid.read, this.getObstacleTex(), mode, band, 0.02,
        );
      } else {
        this.levelSetSolver.advectPhi(
          this._phiGrid, this.velocityGrid.read, dt, this.getObstacleTex(),
        );
        // 周期性「φ 重建 + Godunov reinit」：注入的新液体才有表面
        this.levelSetFrameCount++;
        const interval = ls.reinitInterval ?? 10;
        if (this.levelSetFrameCount >= interval) {
          this.levelSetFrameCount = 0;
          this.initPhiField();
          this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTex(), iterations, 0.5);
          this.applyPhiCorrection();
          this.levelSetSolver.applyDespeckle(this._phiGrid, this.getObstacleTex());
        }
      }
      if (ls.surfaceTension > 0) {
        this.levelSetSolver.applySurfaceTension(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTex(),
          ls.surfaceTension, dt, band,
        );
      }
    }

    // 3.45 ★ 粘度（速度场扩散 ν∇²v）——力相，投影之前：抹平射流/剪切 → 内聚
    this.applyViscosity(dt);

    // 3.5 边界处理（压力投影之前，避免与梯度修正拮抗）
    this.applyBoundary();

    // 3.6 ★ 爆炸散度源注入（压力投影之前：∇²p = ∇·u + f → 压力梯度推动流体向外）
    this.processExplosions(dt);

    // 4. 压力投影（消费散度源）
    if (cfg.enablePressure) {
      // ★ 自由表面边界：LS 开启时压力只在液体内部求解（真实感核心，§3.5）
      const fsPhi = (ls?.enabled && this._phiGrid) ? this._phiGrid.read : null;
      this.solvePressure(cfg.pressureIterations, cfg.pressureOmega, fsPhi);
      this.applyPressureGradient();
    }

    // 4.5 ★ 清空散度源场（一次性消费；不参与平流/衰减）
    this.clearGrid(this.divergenceGrid);

    // 5. 速度缩放（阻尼/加速）
    const velScale = cfg.velocityScale ?? 1;
    if (velScale !== 1) this.scaleVelocity(velScale);

    // 6. 速度限幅（缩放之后，防爆炸）⊕ 爆炸 velCap 三段态（抬升→缓落→失效）
    let maxVel = cfg.maxVelocity ?? 5000;
    const capOv = this.velCapOverride;
    if (capOv) {
      if (this.time < capOv.until) {
        maxVel = Math.max(maxVel, capOv.value);
      } else if (this.time < capOv.recoverUntil) {
        const t = (this.time - capOv.until) / Math.max(1e-6, capOv.recoverUntil - capOv.until);
        const ease = t * t * (3.0 - 2.0 * t);
        maxVel = Math.max(maxVel, capOv.value + (maxVel - capOv.value) * ease);
      } else {
        this.velCapOverride = null;
      }
    }
    if (maxVel > 0 && isFinite(maxVel)) this.clampVelocity(maxVel);

    // 6.5 ★ 外向速度抑制（确定性收拢；与张力符号/φ噪声无关）
    if (ls?.enabled && this._phiGrid) {
      const od = ls.outwardDamping ?? 0;
      if (od > 0) {
        const band = ls.narrowBandWidth ?? ls.smoothingRadius ?? 5;
        this.levelSetSolver.applyOutwardVelDamping(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTex(), band, od,
        );
      }
    }

    this.time += dt;
  }

  // ==================== 合成（渲染到 compositeTarget）====================

  /**
   * 合成视口 → compositeTarget。
   *
   * 两种模式（根据 baseHslTex 是否存在自动选择）：
   * 1. direct 模式（baseHslTex === null）：colorGrid 即合成色，直接输出。
   * 2. MCSDA 模式（baseHslTex 存在）：final = base + delta ± (density/baseline × mul)
   */
  composite(): void {
    if (!this.compositeTarget) return;
    const hasBase = !!this.baseHslTex;
    // ★ key 包含 advectionMode：scalar/vector 编译期分离，模式切换时重建材质
    const key = hasBase
      ? `fluid_composite_mcsda_${this.config.advectionMode === 'scalar' ? 'scalar' : 'vector'}`
      : 'fluid_composite_direct';

    if (!this.compositeMat || this.compositeMat.userData.key !== key) {
      this.compositeMat?.dispose();
      this.compositeMat = this.buildCompositeMat(hasBase);
      this.compositeMat.userData.key = key;
      this.compositeQuad.material = this.compositeMat;
    }

    const u = this.compositeMat.uniforms;
    if (hasBase) {
      u.uBaseTexture.value = this.baseHslTex;
      u.uResidual.value = this.colorGrid.read;
      const sc = this.config.scalarConfig;
      const ch = this.config.channels;
      if (this.config.advectionMode === 'scalar') {
        u.uDensity.value = this.densityGrid.read;
        (u.uChannelMul.value as THREE.Vector4).set(sc.hMultiplier, sc.sMultiplier, sc.lMultiplier, sc.aMultiplier);
        u.uBaseline.value = sc.baselineDensity;
        u.uCombineMode.value = this.config.combineMode === 'sub' ? 1 : 0;
      }
      (u.uChannels.value as THREE.Vector4).set(ch.r ? 1 : 0, ch.g ? 1 : 0, ch.b ? 1 : 0, ch.a ? 1 : 0);
    } else {
      u.uColorTex.value = this.colorGrid.read;
    }

    // ★ Level Set alpha 裁切（热插拔）
    const lsEnabled = !!(this.config.levelSetConfig?.enabled && this._phiGrid);
    u.uEnableLevelSet.value = lsEnabled ? 1 : 0;
    if (lsEnabled) {
      u.uPhiTexture.value = this._phiGrid!.read;
    }

    const prev = this.renderer.getRenderTarget();
    // ★ 透明底：compositeTarget 区域外必须 alpha=0（用渲染器当前 clear color
    //   会是不透明深蓝 → 烘焙/叠加后子弹边缘变黑；编辑器是透明底所以正常）
    const prevClearColor = new THREE.Color();
    this.renderer.getClearColor(prevClearColor);
    const prevClearAlpha = this.renderer.getClearAlpha();
    // ★ 防Feedback loop：上次外部绘制可能把 compositeTarget.texture 留在采样单元上
    //   （同一纹理既是目标又是输入 = 绘制被丢弃）。
    //   用 three 官方的 resetState() 让内部绑定缓存与真实 GL 状态重新同步，
    //   后续绘制会真正重绑采样纹理。禁止用裸 gl.bindTexture 清绑——
    //   那会让 WebGLState 缓存失同步，导致后续材质跳过 bindTexture 采样到空纹理（黑帧/闪帧）。
    this.renderer.resetState();
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.compositeScene, this.compositeCamera);
    this.renderer.setClearColor(prevClearColor, prevClearAlpha);
    this.renderer.setRenderTarget(prev);
  }

  private buildCompositeMat(hasBase: boolean): THREE.ShaderMaterial {
    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    if (!hasBase) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColorTex: { value: null },
          uPhiTexture: { value: null },
          uEnableLevelSet: { value: 0 },
        },
        vertexShader,
        fragmentShader: /* glsl */ `
          uniform sampler2D uColorTex;
          uniform sampler2D uPhiTexture;
          uniform int uEnableLevelSet;
          varying vec2 vUv;
          void main(){
            gl_FragColor = texture2D(uColorTex, vUv);
            if (uEnableLevelSet == 1) {
              float phi = texture2D(uPhiTexture, vUv).r;
              float alphaMask = 1.0 - smoothstep(1.0, 3.0, abs(phi));
              gl_FragColor.a *= alphaMask;
            }
          }
        `,
        depthTest: false,
        depthWrite: false,
      });
    }

    // MCSDA 模式：base + delta ± density 调制（★ 编译期分离：vector 版无 density 采样）
    const isScalar = this.config.advectionMode === 'scalar';
    const scalarUniforms: Record<string, { value: unknown }> = isScalar ? {
      uDensity: { value: null },
      uCombineMode: { value: 0 },
      uChannelMul: { value: new THREE.Vector4(0.1, 0.1, 0.1, 0.1) },
      uBaseline: { value: 1.0 },
    } : {};
    const scalarBody = isScalar ? /* glsl */ `
      float density = texture2D(uDensity, vUv).r;
      // ★ 与流体编辑器保持一致：factor = density / baseline
      float factor = density / max(0.0001, uBaseline);
      // ★ 与编辑器一致：add = +factor×mul；sub 时 H/S/L 取 -abs（残差为 0 处依旧
      //   被密度拉出雾气），A 通道取 +abs（雾气越浓越实，不被减去模式压没）
      float offH = (uCombineMode == 0) ? (factor * uChannelMul.x) : (-abs(factor * uChannelMul.x));
      float offS = (uCombineMode == 0) ? (factor * uChannelMul.y) : (-abs(factor * uChannelMul.y));
      float offL = (uCombineMode == 0) ? (factor * uChannelMul.z) : (-abs(factor * uChannelMul.z));
      float offA = (uCombineMode == 0) ? (factor * uChannelMul.w) : (abs(factor * uChannelMul.w));
      // ★ 与编辑器一致：取消勾选的通道仅关闭 density 调制项（×uChannels），
      //   静态残差 delta 始终参与合成
      finalH = fract(baseHSLA.r + dH + offH * uChannels.x);
      finalS = clamp(baseHSLA.g + dS + offS * uChannels.y, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL + offL * uChannels.z, 0.0, 1.0);
      // ★ 显示 alpha = 基础色 alpha 与残差 alpha 的并集 + 密度项：
      //   残差平流时 alpha 随颜色流动，流到透明区域（基础色 alpha=0）仍显示；
      //   ★ 残差纹理约定：区域外 alpha=0（与编辑器统一）→ 背景保持透明
      finalA = clamp(max(baseHSLA.a, residual.a) + offA * uChannels.w, 0.0, 1.0);
    ` : /* glsl */ `
      // vector 模式：残差 delta 无条件叠加到 baseHSL（通道开关只控制平流，
      //   不参与合成——与编辑器语义一致，避免"导入参数后色相突变"）
      finalH = fract(baseHSLA.r + dH);
      finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);
      // ★ 显示 alpha = 基础色 alpha 与残差 alpha 的并集：残差流入透明区域仍显示
      finalA = max(baseHSLA.a, residual.a);
    `;

    return new THREE.ShaderMaterial({
      uniforms: {
        uBaseTexture: { value: null },
        uResidual: { value: null },
        uResidualRangeH: { value: 0.5 },
        uResidualRangeSL: { value: 0.5 },
        ...scalarUniforms,
        uChannels: { value: new THREE.Vector4(1, 1, 1, 1) },
        uPhiTexture: { value: null },
        uEnableLevelSet: { value: 0 },
      },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBaseTexture;
        uniform sampler2D uResidual;
        uniform float uResidualRangeH;
        uniform float uResidualRangeSL;
        ${isScalar ? `
        uniform sampler2D uDensity;
        uniform int uCombineMode;
        uniform vec4 uChannelMul;
        uniform float uBaseline;
        ` : ''}
        uniform vec4 uChannels;
        uniform sampler2D uPhiTexture;
        uniform int uEnableLevelSet;
        varying vec2 vUv;

        vec3 hsl2rgb(vec3 hsl){
          float h = hsl.x, s = hsl.y, l = hsl.z;
          vec3 rgb = clamp(abs(mod(h*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0*l - 1.0));
        }

        void main(){
          vec4 baseHSLA = texture2D(uBaseTexture, vUv);
          vec4 residual = texture2D(uResidual, vUv);

          float dH = (residual.r * 2.0 - 1.0) * uResidualRangeH;
          float dS = (residual.g * 2.0 - 1.0) * uResidualRangeSL;
          float dL = (residual.b * 2.0 - 1.0) * uResidualRangeSL;
          float dA = (residual.a * 2.0 - 1.0) * uResidualRangeSL;

          float finalH, finalS, finalL, finalA;
          ${scalarBody}
          // ★ 通道开关不再做整通道 mix（此前 mix(baseHSLA, final, uChannels) 在
          //   取消勾选时丢弃整个残差 delta → "导入物理参数后 HSL 突变"）：
          //   取消的通道仅在 scalar 模式关闭 density 调制项（scalarBody ×uChannels），
          //   vector 模式无通道分支，与编辑器 ShaderLibrary 合成公式一致。

          vec3 rgb = hsl2rgb(vec3(finalH, finalS, finalL));
          gl_FragColor = vec4(rgb, finalA);

          // ★ Level Set alpha 裁切（表面羽化）
          if (uEnableLevelSet == 1) {
            float phi = texture2D(uPhiTexture, vUv).r;
            float alphaMask = 1.0 - smoothstep(1.0, 3.0, abs(phi));
            gl_FragColor.a *= alphaMask;
          }
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** 获取合成结果纹理（渲染层喂给网格的 uColorTex） */
  getCompositeTexture(): THREE.Texture | null {
    return this.compositeTarget ? this.compositeTarget.texture : null;
  }

  // ==================== 重置 ====================

  reset(): void {
    this.frameCount = 0;
    this.time = 0;
    this.waypointStates.clear();
    this.injectionQueue.length = 0;
    this.initFields();
    // ★ 立即重新合成：compositeTarget 里还留着上一发/预热结束时的旧画面，
    //   若不刷新，reset 后的首帧烘焙会采样到"上一发的完整尾焰残影"（一大片黑的元凶）
    this.composite();
  }

  // ==================== 配置更新 ====================

  updateConfig(updates: Partial<FluidSolverConfig>): void {
    const oldRes = this.config.resolution;
    const oldLsEnabled = this.config.levelSetConfig?.enabled;

    Object.assign(this.config, updates);
    if (updates.scalarConfig) {
      this.config.scalarConfig = { ...this.config.scalarConfig, ...updates.scalarConfig };
    }
    if (updates.levelSetConfig) {
      this.config.levelSetConfig = { ...this.config.levelSetConfig, ...updates.levelSetConfig };
      const newEnabled = this.config.levelSetConfig.enabled;
      if (newEnabled && !oldLsEnabled) {
        this.enableLevelSet();
      } else if (!newEnabled && oldLsEnabled) {
        this.disableLevelSet();
      }
    }

    const resChanged = updates.resolution &&
      (updates.resolution.w !== oldRes.w || updates.resolution.h !== oldRes.h);
    if (resChanged) {
      this.rebuildGrids();
      this.initFields();
    }
  }

  // ==================== 调试：每帧场回读 ====================

  private _dbgFailD = false;
  private _dbgFailV = false;

  /** 按 RT 实际 format/type 回读像素（自动匹配缓冲类型与分量数） */
  private dbgReadTarget(target: THREE.WebGLRenderTarget): { arr: Float32Array | Uint16Array | Uint8Array; comps: number } {
    const t = target.texture;
    const w = target.width, h = target.height;
    const comps = t.format === THREE.RedFormat ? 1 : t.format === THREE.RGFormat ? 2 : 4;
    const arr = t.type === THREE.HalfFloatType ? new Uint16Array(w * h * comps)
      : t.type === THREE.FloatType ? new Float32Array(w * h * comps)
        : new Uint8Array(w * h * comps);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, arr);
    return { arr, comps };
  }

  private dbgDecode(v: number | undefined, isHalf: boolean, isByte: boolean): number {
    if (v === undefined) return NaN;
    if (isByte) return v / 255;
    if (!isHalf) return v;
    const sign = (v >> 15) & 1, exp = (v >> 10) & 0x1f, mant = v & 0x3ff;
    if (exp === 0) return (sign ? -1 : 1) * Math.pow(2, -14) * (mant / 1024);
    if (exp === 31) return mant ? NaN : (sign ? -Infinity : Infinity);
    return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024);
  }

  /**
   * 每帧回读 density + velocity，输出紧凑统计行（两段独立容错，一段失败不影响另一段）。
   * 坐标约定：(x, yTop) 为归一化坐标、Y 向下为正；readPixels 行 0 = 底部。
   * 分带 [尾|中下|中上|头] 按行四等分（尾 = 底部 = readPixels 低行）。
   */
  debugReadFields(tag = ''): void {
    const { w, h } = this.config.resolution;
    const px = (col: number, row: number) =>
      `(${((col + 0.5) / w).toFixed(2)},${(1 - (row + 0.5) / h).toFixed(2)})`;
    const head = `${tag} f=${this.frameCount} t=${this.time.toFixed(2)}`;

    // ---- density（scalar 模式黑色的直接来源；单通道 uint8）----
    if (!this._dbgFailD) {
      try {
        const d = this.dbgReadTarget(this.densityGrid.readTarget);
        let dMax = -1, dMaxX = 0, dMaxY = 0, dSum = 0, dHot = 0;
        const bands = [0, 0, 0, 0]; // [尾|中下|中上|头]
        for (let row = 0; row < h; row++) {
          const bi = Math.min(3, Math.floor((row / h) * 4)); // row0=底=尾 → band0
          for (let col = 0; col < w; col++) {
            const val = this.dbgDecode(d.arr[row * w + col], false, true);
            dSum += val;
            if (val > 0.5) dHot++;
            if (val > dMax) { dMax = val; dMaxX = col; dMaxY = row; }
            bands[bi] += val;
          }
        }
        const bTotal = Math.max(1e-6, dSum);
        console.log(`[FluidDBG-dens] ${head}`
          + ` max=${dMax.toFixed(2)}@${px(dMaxX, dMaxY)} avg=${(dSum / (w * h)).toFixed(3)}`
          + ` Σ=${dSum.toFixed(0)} hot>0.5:${dHot}`
          + ` 带[尾|中下|中上|头]=${bands.map(b => (100 * b / bTotal).toFixed(0)).join('/')}`);
      } catch (e) {
        this._dbgFailD = true;
        console.warn('[FluidDBG] density 回读失败，已停用该段:', e);
      }
    }

    // ---- velocity ----
    if (!this._dbgFailV) {
      try {
        const isHalfV = this.velocityGrid.dataType === 'half-float';
        const isByteV = this.velocityGrid.dataType === 'uint8';
        const v = this.dbgReadTarget(this.velocityGrid.readTarget);
        const src = v.arr as ArrayLike<number>;
        let vMax = -1, vMaxX = 0, vMaxY = 0, vSum = 0, vCnt = 0;
        for (let i = 0; i < w * h; i++) {
          const vx = this.dbgDecode(src[i * v.comps], isHalfV, isByteV);
          const vy = this.dbgDecode(src[i * v.comps + 1], isHalfV, isByteV);
          if (!isFinite(vx) || !isFinite(vy)) continue;
          const m = Math.hypot(vx, vy);
          vSum += m; vCnt++;
          if (m > vMax) { vMax = m; vMaxX = i % w; vMaxY = Math.floor(i / w); }
        }
        console.log(`[FluidDBG-vel] ${head}`
          + ` max=${vMax.toFixed(0)}@${px(vMaxX, vMaxY)}`
          + ` avg=${vCnt ? (vSum / vCnt).toFixed(0) : 'NaN'}`);
      } catch (e) {
        this._dbgFailV = true;
        console.warn('[FluidDBG] velocity 回读失败，已停用该段:', e);
      }
    }
  }

  // ==================== 生命周期 ====================

  dispose(): void {
    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();
    this.densityGrid?.dispose();
    this.divergenceGrid?.dispose();
    this._phiGrid?.dispose();
    this._phiGrid = null;
    this.compositeTarget?.dispose();
    this.baseHslTex?.dispose();
    this.compositeMat?.dispose();
    (this.compositeQuad.geometry as THREE.BufferGeometry).dispose();
    this.gpu.dispose();
    this.advectionSolver.dispose();
    this.levelSetSolver.dispose();
  }
}
