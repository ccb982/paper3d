import * as THREE from 'three';
import { FluidGrid, type AdvectionMask } from './core/FluidGrid';
import { GPUOps } from './core/GPUOps';
import { AdvectionSolver } from './solvers/AdvectionSolver';
import { LevelSetSolver } from './solvers/LevelSetSolver';
import { FluidInjector } from './core/FluidInjector';

// ============================================================
// 类型定义
// ============================================================

/** 视口模式（与编辑器一致，但本解算器主要用于 composite 输出） */
export type FluidViewMode = 'color' | 'velocity' | 'composite' | 'density' | 'obstacle';

/** 持续注入源 / 一次性注入配置 */
export interface InjectionConfig {
  enabled: boolean;
  position: { x: number; y: number };          // 归一化 (0~1)，Y向下为正
  radius: number;                              // 归一化半径
  velocity: { x: number; y: number };          // 像素/秒，Y向下为正
  color?: [number, number, number, number];    // HSLA (vector 模式注入颜色)
  density?: number;                            // 0~1 (scalar 模式注入浓度)
  rate?: number;                               // 混合率 0~1
  /** 波形方向控制 */
  wave?: { enabled: boolean; amplitude: number; frequency: number; phase?: number };
  /** 路径点巡游 */
  waypoints?: { x: number; y: number }[];
  waypointMode?: 'forward' | 'backward' | 'pingpong';
  waypointSpeed?: number;
  /** ★ 间歇注入（脉冲）：注入 onDuration 秒 → 暂停 offDuration 秒 → 循环。
   *   间歇切换增强视觉对比（连续注入会糊成一片）。无该字段 = 持续注入。 */
  intermittent?: { onDuration: number; offDuration: number };
}

/**
 * ★ 爆炸注入配置（参照旧库 FluidSimulatorAdapter.explode）。
 * 散度脉冲（径向推/吸）+ 可选水量 + 时间包络 + 各向异性/扰动。
 * 旧库参数参考：strength 25000→5000（5连爆递减）、radius 0.15、duration 0.1s、
 *   createWater 首末次 true、waterMultiplier 末次 2、扰动 offset ±0.01。
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
  /** 包络时长（秒，默认 0.1）；强度按 1-t/duration 线性衰减 */
  duration?: number;
  /** ★ 每帧衰减系数（0~1，默认 0.9）：包络改为指数衰减 envelope ×= decay。
   *   线性包络（1-t）前几帧强度≈1 持续高压注入 → 速度场膨胀填满纹理；
   *   指数衰减让冲击波快速消退，尾部平滑。调小（0.7~0.85）= 更短促的爆炸 */
  decay?: number;
  /** 水量倍数（默认 1；旧库末次爆炸 2） */
  waterMultiplier?: number;
  /** 各向异性模式：0=各向同性, 1=四极子, 2=偶极子（旧库 explodeAnisotropic） */
  anisotropyMode?: 0 | 1 | 2;
  /** 各向异性相位（弧度） */
  anisotropyPhase?: number;
  /** 各向异性强度 0~1 */
  anisotropyStrength?: number;
  /** 随机扰动强度（碎片感/不规则冲击波，默认 0） */
  perturbation?: number;
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
    enabled: boolean;            // 总开关
    reinitIterations: number;    // 重初始化迭代次数（默认 2）
    surfaceTension: number;      // 表面张力系数 σ（0=禁用；δ 归一化后建议 1~5）
    smoothingRadius: number;     // 表面张力作用半径（像素）
    reinitInterval?: number;     // φ 重建+reinit 间隔帧数（默认 10）
    narrowBandWidth?: number;    // 窄带半宽（像素；张力 δ 与液体约束带）
    constrainLiquid?: boolean;   // φ 直接约束液体（外部渐隐，紧凑圆润）
    clampAirPhi?: boolean;       // 空气区 φ 钳制（防空气泄漏进水）
    maxAirPhi?: number;          // 空气区 φ 上限（默认 0）
    compensateWaterPhi?: boolean;// 水体区负向补偿（防水体流失）
    waterCompensationRate?: number; // 水体补偿速率（默认 0.1）
  };
  continuousSources: InjectionConfig[];
  /**
   * 墙体掩码（1 bit/像素位图压缩，data = base64）。
   * 主绘画页面导入多帧物理配置时可选携带；存在时优先于区域边界光栅化。
   */
  obstacle?: { width: number; height: number; data: string };
}

export const defaultFluidConfig: FluidSolverConfig = {
  resolution: { w: 512, h: 512 },
  channels: { r: true, g: true, b: true, a: true },
  enableAdvection: true,
  enablePressure: true,
  pressureIterations: 50,
  pressureOmega: 1.7,
  pressureBoundaryMode: 'dirichlet',
  enableWarmStart: true,
  gravity: { x: 0, y: 0 },
  velocityScale: 1,
  maxVelocity: 5000,
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
// FluidSolver —— 轻量解算器门面（主编辑器版）
// ============================================================
//
// 设计要点（对照 fluid-player.html 移植，携带 4 个关键 bug 修复）：
//   1. GPU Pass 的 Y-flip 约定：复用的 GPUOps/AdvectionSolver 已用 vUv=uv（不翻转 Y）；
//      只有 composite() 显示着色器用 vUv=vec2(uv.x,1.0-uv.y)。切勿在 GPU Pass 翻转。
//   2. 压力 SOR 散度公式：div = (vR.x-vL.x)*0.5*uInvRes.x + ...（乘 invRes，不是除）。
//   3. clearGrid 用 renderer.clear()，不用 shader 输出 vec4(0)（单通道密度场可能清不干净）。
//   4. 残差原始数据永不被消耗：_pendingResidual 上传后不置 null，供 reset / 重新加载恢复。
//
// 与 fluid-player.html 的差异：
//   - 不自建 canvas/renderer，直接接收主画布的 WebGLRenderer。
//   - composite() 渲染到内部 RenderTarget（不直接上屏），由 MainCanvas 把
//     getCompositeTexture() 喂给区域 COLOR mesh 的 uColorTex，复用模板缓冲裁剪 +
//     VAT 位移 + textureOffset/Scale/Rotation，让流体直接绘制在区域帧纹理之上。
//   - 复用底层 core 类（FluidGrid/GPUOps/AdvectionSolver/FluidInjector），不引入
//     FluidEditor/FluidOperations/FluidEditorUI。
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
  /** ★ 散度源场（爆炸/源汇的压力方程源项；solvePressure 前注入、消费后清空） */
  divergenceGrid!: FluidGrid;

  // ★ Level Set φ 场（懒加载，仅启用时分配显存）
  private _phiGrid: FluidGrid | null = null;
  /** ★ Level Set 重建间隔帧计数（每 reinitInterval 帧执行一次「φ 重建 + reinit」） */
  private levelSetFrameCount = 0;

  // 基础色纹理（FloatType RGBA HSLA，0~1）——合成用
  private baseHslTex: THREE.DataTexture | null = null;
  // 原始残差数据（永不消耗，供 reset 恢复）
  private _pendingResidual: Uint8Array | null = null;
  private _residualWidth = 0;
  private _residualHeight = 0;

  // 障碍物纹理（从区域实体 boundary 光栅化而来）
  private obstacleTex: THREE.Texture | null = null;

  // 合成输出目标（每帧 composite() 写入，MainCanvas 读取其 texture）
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

  // ★ 活跃爆炸队列（step 内逐帧推进包络，播完移除）
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

    // 合成场景（全屏四边形，Y-flip 用于显示）
    this.compositeScene = new THREE.Scene();
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.compositeScene.add(this.compositeQuad);

    this.rebuildGrids();
    this.initFields();

    // ★ 若配置启用 Level Set，立即初始化 φ 场
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
    // ★ 散度源场（爆炸/注入源的压力方程源项；solvePressure 消费后清空）
    this.divergenceGrid = new FluidGrid({ w, h }, 1, 'half-float');

    // ★ Level Set φ 场同步重建（仅当已存在时）
    if (this._phiGrid) {
      this._phiGrid.dispose();
      this._phiGrid = new FluidGrid({ w, h }, 1, 'half-float');
      this.initPhiField();
    }

    // 重建合成目标（分辨率跟随）
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
    // ★ 不设置 colorSpace：WebGLRenderTarget 默认 NoColorSpace，
    //   ShaderMaterial 采样时不会注入颜色空间转换。
  }

  // ==================== 数据加载 ====================

  /**
   * 上传残差 ImageData 到 colorGrid。
   * 期望格式（与编辑器 buildFluidTexturesFromRawFrame 一致）：
   *   R = qH/63*255, G = qS/31*255, B = qL/31*255, A = 255
   * 合成着色器反量化：dH = (r/255 * 2 - 1) * uResidualRangeH（uResidualRangeH=0.5）
   */
  loadResidual(imageData: ImageData): void {
    const data = new Uint8Array(imageData.data.buffer.slice(0));
    this._pendingResidual = data;
    this._residualWidth = imageData.width;
    this._residualHeight = imageData.height;
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

    // copy pass：DataTexture → colorGrid（GPUOps 已用 vUv=uv，与 DataTexture flipY=false 对齐）
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
   * 用于合成视口的 base + delta ± density 调制。
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

  /**
   * 启用 Level Set 演化（热插拔开）。
   * 首次调用时懒加载创建 phiGrid 并初始化 φ 场。
   */
  enableLevelSet(): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.enabled = true;
    // 触发 phiGrid getter 创建并初始化（赋值给 _ 避免无副作用表达式警告）
    const _ = this.phiGrid;
    void _;
  }

  /**
   * 禁用 Level Set 演化（热插拔关）。
   * 释放 phiGrid 显存，后续 step() 跳过所有 Level Set 计算。
   */
  disableLevelSet(): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.enabled = false;
    this._phiGrid?.dispose();
    this._phiGrid = null;
  }

  /**
   * 重置 φ 场为初始距离场（清除流动痕迹）。
   */
  resetLevelSet(): void {
    if (!this._phiGrid) return;
    this.initPhiField();
  }

  /**
   * 动态调整表面张力系数（不需要重建网格）。
   */
  setSurfaceTension(sigma: number): void {
    if (!this.config.levelSetConfig) return;
    this.config.levelSetConfig.surfaceTension = sigma;
  }

  /**
   * φ 场初始化：基于 density（scalar 模式）或 colorGrid.alpha（vector 模式）推断 SDF。
   *   density > 0.5 → φ < 0（内部）
   *   density < 0.5 → φ > 0（外部）
   */
  private initPhiField(): void {
    if (!this._phiGrid) return;
    const ls = this.config.levelSetConfig;
    const scale = ls?.smoothingRadius ?? 2;
    const isScalar = this.config.advectionMode === 'scalar';
    // scalar 模式用 densityGrid；vector 模式用 colorGrid.alpha
    const sourceTex = isScalar ? this.densityGrid.read : this.colorGrid.read;
    const mode: 0 | 1 = isScalar ? 0 : 1;
    this.levelSetSolver.initPhiField(this._phiGrid, sourceTex, mode, scale);
  }

  /**
   * ★ φ 场后处理（空气钳制 + 水体补偿）——与流体编辑器一致。
   * 读取配置 → 委托 LevelSetSolver.applyPhiCorrection。
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

  /** 用 renderer.clear() 清空渲染目标（比 shader 输出 vec4(0) 可靠，单通道也安全） */
  private clearGrid(grid: FluidGrid): void {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(grid.write);
    this.renderer.clear(true, true, true);
    this.renderer.setRenderTarget(prev);
    grid.swap();
  }

  /** 用特定值填充网格（保留：density 等单值场初始化） */
  private fillGrid(grid: FluidGrid, value: number): void {
    const w = grid.resolution.w;
    const h = grid.resolution.h;

    if (grid.dataType === 'uint8') {
      // Uint8 格式
      const uintVal = Math.round(value * 255);
      // 对于 RedFormat（1通道），创建 R 通道数据
      // 对于 RGBAFormat（4通道），创建 RGBA 数据
      const ch = grid.channelCount;
      const data = new Uint8Array(w * h * ch);
      for (let i = 0; i < w * h; i++) {
        data[i * ch + 0] = uintVal;
        if (ch >= 2) data[i * ch + 1] = 0;
        if (ch >= 3) data[i * ch + 2] = 0;
        if (ch >= 4) data[i * ch + 3] = 255;
      }
      const texFormat = ch === 1 ? THREE.RedFormat : THREE.RGBAFormat;
      const tex = new THREE.DataTexture(data, w, h, texFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.flipY = false;
      tex.needsUpdate = true;

      const mat = this.gpu.getMaterial('fluid_fill', {
        uTex: { value: tex },
      }, ch === 1 ? `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).r, 0.0, 0.0, 1.0); }
      ` : `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(uTex, vUv); }
      `);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(grid.write);
      this.renderer.clear(true, true, true);
      this.gpu.render(this.renderer, grid.write, mat);
      this.renderer.setRenderTarget(prev);
      grid.swap();
      tex.dispose();
    } else {
      // Float 格式
      const ch = grid.channelCount;
      const data = new Float32Array(w * h * Math.max(ch, 4));
      for (let i = 0; i < w * h; i++) {
        data[i * Math.max(ch, 4)] = value;
      }
      const texFormat = ch === 1 ? THREE.RedFormat : THREE.RGBAFormat;
      const tex = new THREE.DataTexture(data, w, h, texFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.flipY = false;
      tex.needsUpdate = true;

      const mat = this.gpu.getMaterial('fluid_fill', {
        uTex: { value: tex },
      }, ch === 1 ? `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).r, 0.0, 0.0, 1.0); }
      ` : `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(uTex, vUv); }
      `);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(grid.write);
      this.renderer.clear(true, true, true);
      this.gpu.render(this.renderer, grid.write, mat);
      this.renderer.setRenderTarget(prev);
      grid.swap();
      tex.dispose();
    }
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
    // 重力是持续加速度：每帧注入 g*dt（速度增量）
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

  // ==================== 爆炸注入（参照旧库 explode）====================

  /**
   * ★ 触发一次爆炸（参照旧库 FluidSimulatorAdapter.explode）：
   *   散度脉冲（径向推/吸）+ 可选水量 + 时间包络 + 各向异性/扰动。
   *   进入活跃队列，step 内按包络逐帧注入，播完自动移除。
   *   旧库参数参考：strength 25000（爆炸）/ -2000（恒定膨胀）、radius 0.15、
   *   duration 0.1、首末次 createWater=true、末次 waterMultiplier=2、
   *   扰动 offset ±0.01（perturbation 0.4 → 碎片感）。
   */
  explode(config: ExplosionConfig): void {
    this.activeExplosions.push({ ...config, elapsed: 0, envelope: 1 });
  }

  /** 活跃爆炸逐帧推进：包络强度 + 散度/水量注入（step 内调用） */
  private processExplosions(dt: number): void {
    if (this.activeExplosions.length === 0) return;
    const isScalar = this.config.advectionMode === 'scalar';
    const ch = this.config.channels;

    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const ex = this.activeExplosions[i];
      const duration = ex.duration ?? 0.1;
      ex.elapsed += dt;

      // ★ 时间包络：指数衰减 envelope ×= decay（默认 0.9）。
      //   线性包络（1-t）前几帧强度≈1 持续高压注入 → 速度场膨胀填满纹理；
      //   指数衰减让冲击波快速消退、尾部平滑，不会持续填充。
      //   duration 仍是硬性截止。
      const decay = ex.decay ?? 0.9;
      ex.envelope *= Math.max(0, Math.min(1, decay));
      const envelope = ex.envelope;
      if (envelope <= 0.01 || ex.elapsed >= duration) {
        this.activeExplosions.splice(i, 1);
        continue;
      }

      const opts = {
        position: { x: ex.cx, y: ex.cy },
        radius: ex.radius,
        obstacle: this.obstacleTex || undefined,
      };

      // ① ★ 散度源注入（旧库 addDivergenceImpulse 的正确物理）：
      //   写入 divergenceGrid → 压力方程源项 ∇²p = ∇·u + f →
      //   压力梯度推动周围流体向外（爆炸推力，水体被真正推开/撕裂）
      //   加随机扰动（碎片感）：中心/半径微偏移 → 非完美同心圆
      const perturb = ex.perturbation ?? 0;
      const jitterX = perturb > 0 ? (Math.random() - 0.5) * 2 * perturb * ex.radius : 0;
      const jitterY = perturb > 0 ? (Math.random() - 0.5) * 2 * perturb * ex.radius : 0;
      this.injector.injectDivergenceSource(this.divergenceGrid, ex.strength * envelope, {
        position: { x: ex.cx + jitterX, y: ex.cy + jitterY },
        radius: ex.radius * (1 + perturb * (Math.random() - 0.5)),
        obstacle: this.obstacleTex || undefined,
      });

      // ② 直接速度冲击（撕裂感：先给速度场冲量，与压力梯度叠加成碎片感）
      //   强度 = 散度的 ~8%（主推力走压力传导，冲量给撕裂边缘）
      const velImpulse = ex.strength * envelope * 0.08;
      const jitterAngle = Math.random() * Math.PI * 2;
      this.injector.injectVelocity(this.velocityGrid, {
        x: Math.cos(jitterAngle) * velImpulse * dt,
        y: Math.sin(jitterAngle) * velImpulse * dt,
      }, {
        position: { x: ex.cx + jitterX, y: ex.cy + jitterY },
        radius: ex.radius,
        obstacle: this.obstacleTex || undefined,
      });

      // ③ 各向异性修正（模式 1=四极子, 2=偶极子）：角向权重 → 偏移的散度源
      const mode = ex.anisotropyMode ?? 0;
      const anisoStrength = ex.anisotropyStrength ?? 0;
      if (mode > 0 && anisoStrength > 0) {
        const phase = ex.anisotropyPhase ?? 0;
        const weight = (m: number, a: number) => {
          if (mode === 1) return Math.cos(2 * a + phase);      // 四极子
          return Math.cos(a + phase);                           // 偶极子
        };
        // 角向偏移的散度源 → 冲击波被拉长/不对称（撕裂方向感）
        const dirs = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        for (const a of dirs) {
          const w = weight(mode, a) * anisoStrength * ex.strength * envelope;
          if (Math.abs(w) < 1e-6) continue;
          this.injector.injectDivergenceSource(this.divergenceGrid, w * 0.5, {
            position: {
              x: ex.cx + Math.cos(a) * ex.radius * 0.4,
              y: ex.cy + Math.sin(a) * ex.radius * 0.4,
            },
            radius: ex.radius * 0.5,
            obstacle: this.obstacleTex || undefined,
          });
        }
      }

      // ④ 水量注入（旧库 createWater）：vector = 颜色 alpha（可自定义颜色），scalar = 密度
      const waterMult = ex.waterMultiplier ?? 1;
      if (ex.createWater && waterMult > 0) {
        const rate = Math.min(1, 0.6 * envelope * waterMult);
        if (isScalar) {
          this.injector.injectDensity(this.densityGrid, rate, rate, opts);
        } else {
          // 水团颜色：默认白色（h 0.55, s 0.3, l 0.85），可用 waterColor 自定义 HSLA
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
        float eps = 1.0 / resolution.x;
        if (vUv.x < eps) vel = texture2D(velTex, vec2(vUv.x + eps, vUv.y)).rg;
        else if (vUv.x > 1.0 - eps) vel = texture2D(velTex, vec2(vUv.x - eps, vUv.y)).rg;
        if (vUv.y < eps) vel = texture2D(velTex, vec2(vUv.x, vUv.y + eps)).rg;
        else if (vUv.y > 1.0 - eps) vel = texture2D(velTex, vec2(vUv.x, vUv.y - eps)).rg;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  // ==================== 压力投影（红-黑 SOR）====================

  private solvePressure(iterations: number, omega: number): void {
    const { w, h } = this.config.resolution;
    if (w === 0 || h === 0) return;
    if (!this.config.enableWarmStart) this.clearGrid(this.pressureGrid);
    for (let iter = 0; iter < iterations; iter++) {
      this.runSORPass('red', omega);
      this.runSORPass('black', omega);
    }
  }

  private runSORPass(color: 'red' | 'black', omega: number): void {
    const { w, h } = this.config.resolution;
    const isRedPass = color === 'red';
    const boundaryMode = this.config.pressureBoundaryMode || 'dirichlet';

    const mat = this.gpu.getMaterial(`fluid_sor_${isRedPass ? 'red' : 'black'}_${boundaryMode}`, {
      uPressure: { value: this.pressureGrid.read },
      uVelocity: { value: this.velocityGrid.read },
      uDivSource: { value: this.divergenceGrid.read },
      uObstacle: { value: this.getObstacleTex() },
      uOmega: { value: omega },
      uInvRes: { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
      uIsRed: { value: isRedPass ? 1 : 0 },
      uBoundaryMode: { value: boundaryMode === 'neumann' ? 1 : 0 },
    }, `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uDivSource;
      uniform sampler2D uObstacle;
      uniform float uOmega;
      uniform vec2 uInvRes;
      uniform int uIsRed;
      uniform int uBoundaryMode;
      varying vec2 vUv;
      void main(){
        // 墙内压力强制为 0
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
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
        // ★ scalar 模式：colorGrid 保持静态（不平流），density 流动提供动态调制
      } else {
        this.advect(this.colorGrid, this.velocityGrid.read, dt,
          cfg.channels, cfg.colorBoundaryMode || 'clamp', true);
      }
    }

    // 3.2 ★ Level Set 模块（热插拔，仅启用且 phiGrid 已初始化时执行）
    //    两种模式（与流体编辑器一致）：
    //      A. 约束模式（constrainLiquid=true）→ 每帧「φ 重建 + reinit + 约束」：
    //         φ 始终与当前液体同步，液体被持续收拢成紧凑圆润团块
    //      B. 追踪模式（默认）→ φ 平流 + 周期性重建 + 表面张力
    const ls = this.config.levelSetConfig;
    if (ls?.enabled && this._phiGrid) {
      const iterations = ls.reinitIterations;
      const band = ls.narrowBandWidth ?? ls.smoothingRadius ?? 5;
      const constrain = !!ls.constrainLiquid;

      if (constrain) {
        // ★ 约束模式：每帧从当前液体场重建 φ（注入即同步）+ Godunov reinit + 约束
        this.initPhiField();
        this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTex(), iterations, 0.5);
        this.applyPhiCorrection();
        const mode = this.config.advectionMode === 'scalar' ? 0 : 1;
        const targetGrid = this.config.advectionMode === 'scalar' ? this.densityGrid : this.colorGrid;
        this.levelSetSolver.applyLiquidConstraint(
          targetGrid, this._phiGrid.read, this.getObstacleTex(), mode, band, 0.02,
        );
      } else {
        // (1) φ 平流（跟随速度场流动）
        this.levelSetSolver.advectPhi(
          this._phiGrid, this.velocityGrid.read, dt, this.getObstacleTex(),
        );
        // (2) 周期性「φ 重建 + Godunov 重初始化」：注入的新液体才有表面
        this.levelSetFrameCount++;
        const interval = ls.reinitInterval ?? 10;
        if (this.levelSetFrameCount >= interval) {
          this.levelSetFrameCount = 0;
          this.initPhiField();
          this.levelSetSolver.reinit(this._phiGrid, this.getObstacleTex(), iterations, 0.5);
          this.applyPhiCorrection();
        }
      }
      // (3) 表面张力注入（CSF 模型，σ>0 时启用，δ(φ) 归一化窄带施力）
      if (ls.surfaceTension > 0) {
        this.levelSetSolver.applySurfaceTension(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTex(),
          ls.surfaceTension, dt, band,
        );
      }
    }

    // 3.5 边界处理（压力投影之前，避免与梯度修正拮抗）
    this.applyBoundary();

    // 3.6 ★ 爆炸散度源注入（压力投影之前：∇²p = ∇·u + f，散度源成为压力源 →
    //   压力梯度推动流体向外 → 真正的爆炸推力/水体撕裂）
    this.processExplosions(dt);

    // 4. 压力投影（消费散度源；SOR 迭代期间源场保持有效）
    if (cfg.enablePressure) {
      this.solvePressure(cfg.pressureIterations, cfg.pressureOmega);
      this.applyPressureGradient();
    }

    // 4.5 ★ 清空散度源场（一次性消费；不参与平流/衰减）
    this.clearGrid(this.divergenceGrid);

    // 5. 速度缩放（阻尼/加速）
    const velScale = cfg.velocityScale ?? 1;
    if (velScale !== 1) this.scaleVelocity(velScale);

    // 6. 速度限幅（缩放之后，防爆炸）
    const maxVel = cfg.maxVelocity ?? 5000;
    if (maxVel > 0 && isFinite(maxVel)) this.clampVelocity(maxVel);

    this.time += dt;
  }

  // ==================== 合成（渲染到 compositeTarget）====================

  /**
   * 合成视口 → compositeTarget。
   *
   * 两种模式（根据 baseHslTex 是否存在自动选择）：
   *
   * 1. direct 模式（baseHslTex === null）：
   *    colorGrid 直接持有合成色 RGBA（来自 frameData.residualTexture，已 base+delta）。
   *    composite 直接采样 colorGrid 输出，流体平流的是帧纹理本身。
   *    ★ 这是主编辑器现有数据的默认模式（baseHslData 未填充时）。
   *
   * 2. MCSDA 模式（baseHslTex 存在）：
   *    colorGrid = 量化残差 delta，baseHslTex = Float32 HSL。
   *    final = base + delta ± (density/baseline × mul)
   *    与编辑器 ShaderLibrary 合成着色器公式完全一致。
   *
   * MainCanvas 读取 getCompositeTexture() 喂给区域 COLOR mesh 的 uColorTex。
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
      // direct 模式：直接采样 colorGrid
      u.uColorTex.value = this.colorGrid.read;
    }

    // ★ Level Set alpha 裁切（热插拔）
    const lsEnabled = !!(this.config.levelSetConfig?.enabled && this._phiGrid);
    u.uEnableLevelSet.value = lsEnabled ? 1 : 0;
    if (lsEnabled) {
      u.uPhiTexture.value = this._phiGrid!.read;
    }

    const prev = this.renderer.getRenderTarget();
    // ★ 解绑所有纹理单元：上一次绘制可能把 compositeTarget.texture 留在采样单元上
    //   （three 不自动解绑）→ 同一纹理既是渲染目标又是采样输入 = Feedback loop
    //   → GL 丢弃该次绘制 → 合成结果黑/旧（"区域色块图层丢失"的根因）
    this.unbindTextureUnits();
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.compositeScene, this.compositeCamera);
    this.renderer.setRenderTarget(prev);
  }

  /** 解绑所有 2D 纹理单元（离屏渲染前调用，防 Feedback loop） */
  private unbindTextureUnits(): void {
    const gl = this.renderer.getContext();
    for (let u = 0; u < 16; u++) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private buildCompositeMat(hasBase: boolean): THREE.ShaderMaterial {
    // ★ MainCanvas 约定：区域 COLOR mesh 的 UV.y = 1 - world.y（见 MainCanvas 三角剖分处
    //   uv[i*2+1] = p.y / texHeight，而 p.y = (1-world.y)*canvasHeight）。
    //   因此 uColorTex 数据 row 0 = world y=1（顶部）。
    //   boundBaseTexture/boundResidualTexture 均用 flipY=false 上传，数据 row 0 = world 顶部。
    //   colorGrid 经 loadResidual 的 copy pass（vUv=uv）同样保持 row 0 = world 顶部。
    //
    //   composite 渲染到 RenderTarget：UV(0,0) 在底部。若 vUv=uv（不翻转），
    //   target 底部(UV.y=0) 采样 colorGrid row 0 = world 顶部 →
    //   compositeTarget UV.y=0 = world 顶部，与 boundBaseTexture 完全一致。
    //   ★ 故此处不能再 Y-flip（fluid-player.html 的 vUv=vec2(uv.x,1.0-uv.y) 会双重翻转）。
    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    if (!hasBase) {
      // direct 模式：colorGrid 即合成色，直接输出
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
            // ★ Level Set alpha 裁切
            if (uEnableLevelSet == 1) {
              float phi = texture2D(uPhiTexture, vUv).r;
              // 表面附近（|φ|<1像素）alpha=1，远离表面（|φ|>3像素）alpha=0
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
      // ★ 与编辑器 ShaderLibrary 一致：取消勾选的通道仅关闭 density 调制项
      //   （×uChannels），静态残差 delta 始终参与合成（见 FluidEditorUI 合成注释）
      finalH = fract(baseHSLA.r + dH + offH * uChannels.x);
      finalS = clamp(baseHSLA.g + dS + offS * uChannels.y, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL + offL * uChannels.z, 0.0, 1.0);
      // ★ 显示 alpha = 基础色 alpha 与残差 alpha 的并集 + 密度项：
      //   残差平流时 alpha 随颜色流动，流到透明区域（基础色 alpha=0）仍显示；
      //   ★ 残差纹理约定：shape 外 alpha=0（中性）/ shape 内 255 → 背景纯透明
      finalA = clamp(max(baseHSLA.a, residual.a) + offA * uChannels.w, 0.0, 1.0);
    ` : /* glsl */ `
      // vector 模式：残差 delta 无条件叠加到 baseHSL（通道开关只控制平流，
      //   不参与合成——与编辑器语义一致，避免"导入参数后色相突变"）
      finalH = fract(baseHSLA.r + dH);
      finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);
      // ★ 显示 alpha = 基础色 alpha 与残差 alpha 的并集：残差流入透明区域仍显示；
      //   shape 外残差 alpha=0 → 背景纯透明
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

  /** 获取合成结果纹理（MainCanvas 喂给区域 COLOR mesh 的 uColorTex） */
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
      // ★ Level Set 启用状态切换
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
      // ★ 分辨率变化时 phiGrid 已在 rebuildGrids 中同步重建
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