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
    enabled: boolean;
    reinitIterations: number;
    surfaceTension: number;
    smoothingRadius: number;
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
    surfaceTension: 0,
    smoothingRadius: 2,
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

  // ★ Level Set φ 场（懒加载，仅启用时分配显存）
  private _phiGrid: FluidGrid | null = null;

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

    this.colorGrid = new FluidGrid({ w, h }, 4, 'uint8');
    this.velocityGrid = new FluidGrid({ w, h }, 2, 'half-float');
    this.pressureGrid = new FluidGrid({ w, h }, 1, 'half-float');
    this.densityGrid = new FluidGrid({ w, h }, 1, 'uint8');

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

  // ==================== 场清零 ====================

  /** 用 renderer.clear() 清空渲染目标（比 shader 输出 vec4(0) 可靠，单通道也安全） */
  private clearGrid(grid: FluidGrid): void {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(grid.write);
    this.renderer.clear(true, true, true);
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
      uObstacle: { value: this.getObstacleTex() },
      uOmega: { value: omega },
      uInvRes: { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
      uIsRed: { value: isRedPass ? 1 : 0 },
      uBoundaryMode: { value: boundaryMode === 'neumann' ? 1 : 0 },
    }, `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
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
      } else {
        this.advect(this.colorGrid, this.velocityGrid.read, dt,
          cfg.channels, cfg.colorBoundaryMode || 'clamp', true);
      }
    }

    // 3.2 ★ Level Set 模块（热插拔，仅启用且 phiGrid 已初始化时执行）
    const ls = this.config.levelSetConfig;
    if (ls?.enabled && this._phiGrid) {
      this.levelSetSolver.advectPhi(
        this._phiGrid, this.velocityGrid.read, dt, this.getObstacleTex(),
      );
      this.levelSetSolver.reinit(
        this._phiGrid, this.getObstacleTex(), ls.reinitIterations, 0.5,
      );
      if (ls.surfaceTension > 0) {
        this.levelSetSolver.applySurfaceTension(
          this.velocityGrid, this._phiGrid.read, this.getObstacleTex(),
          ls.surfaceTension, dt, ls.smoothingRadius,
        );
      }
    }

    // 3.5 边界处理（压力投影之前，避免与梯度修正拮抗）
    this.applyBoundary();

    // 4. 压力投影
    if (cfg.enablePressure) {
      this.solvePressure(cfg.pressureIterations, cfg.pressureOmega);
      this.applyPressureGradient();
    }

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
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.compositeScene, this.compositeCamera);
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
      float sign = (uCombineMode == 1) ? -1.0 : 1.0;
      // ★ 与编辑器 ShaderLibrary 一致：取消勾选的通道仅关闭 density 调制项
      //   （×uChannels），静态残差 delta 始终参与合成（见 FluidEditorUI 合成注释）
      finalH = fract(baseHSLA.r + dH + sign * factor * uChannelMul.x * uChannels.x);
      finalS = clamp(baseHSLA.g + dS + sign * factor * uChannelMul.y * uChannels.y, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL + sign * factor * uChannelMul.z * uChannels.z, 0.0, 1.0);
      finalA = clamp(baseHSLA.a + dA + sign * factor * uChannelMul.w * uChannels.w, 0.0, 1.0);
    ` : /* glsl */ `
      // vector 模式：残差 delta 无条件叠加到 baseHSL（通道开关只控制平流，
      //   不参与合成——与编辑器语义一致，避免"导入参数后色相突变"）
      finalH = fract(baseHSLA.r + dH);
      finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
      finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);
      finalA = clamp(baseHSLA.a + dA, 0.0, 1.0);
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

  // ==================== 生命周期 ====================

  dispose(): void {
    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();
    this.densityGrid?.dispose();
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
