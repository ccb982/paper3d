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

export type ViewMode = 'color' | 'velocity';

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

  // 待处理注入队列（UI 交互安全入口，避免与渲染循环竞争）
  private pendingInjection: InjectionConfig | null = null;

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
   */
  updateConfig(updates: Partial<FluidEditorConfig>): void {
    const oldRes = this.config.resolution;
    Object.assign(this.config, updates);

    if (
      updates.resolution &&
      (updates.resolution.w !== oldRes.w || updates.resolution.h !== oldRes.h)
    ) {
      this.rebuildGrids();
    }
  }

  // ==================== 每帧更新 ====================

  /**
   * 将一次注入操作加入队列，下一帧 step 时执行。
   * 这是 UI 交互的唯一安全入口（避免与渲染循环竞争纹理交换）。
   */
  public queueInjection(config: InjectionConfig): void {
    this.pendingInjection = config;
  }

  /** 执行一帧模拟 */
  step(dt: number): void {
    if (dt <= 0) return;

    this.frameCount++;
    
    // 每 30 帧输出一次详细调试信息
    if (this.frameCount % 30 === 1) {
    }

    // ★ 0. 处理待定注入队列（UI 交互，一次性注入，不乘 dt）
    if (this.pendingInjection) {
      const config = this.pendingInjection;
      // 将用户坐标（Y向下）转换为纹理坐标（Y向上）
      const texPos = {
        position: { x: config.position.x, y: 1.0 - config.position.y },
        radius: config.radius,
      };
      // 颜色注入：直接覆盖（rate=1.0，不受 dt 影响）
      this.injector.injectColor(
        this.colorGrid,
        { h: config.color[0], s: config.color[1], l: config.color[2], a: config.color[3] },
        1.0,
        texPos,
      );
      // 速度注入：直接累加（不乘 dt）
      this.injector.injectVelocity(
        this.velocityGrid,
        { x: config.velocity.x, y: -config.velocity.y },
        texPos,
      );
      this.pendingInjection = null;
    }

    // 0. 重力（通过操作模块 → 底层注入器）
    if (this.config.gravity !== 0) {
      this.operations.applyGravity(this.velocityGrid, dt, this.config.gravity);
    }

    // 1. 注入源（通过操作模块 → 底层注入器）
    if (this.config.injection.enabled) {
      const inj = this.config.injection;
      const injConfig: InjectionConfig = {
        enabled: true,
        position: inj.position,
        radius: inj.radius,
        rate: inj.rate,
        velocity: inj.velocity,
        color: inj.color,
      };
      this.operations.applyInjection(
        this.colorGrid,
        this.velocityGrid,
        dt,
        injConfig,
      );
    }

    // 2. 平流（非注入 Pass，直接使用 this.gpu）
    if (this.config.enableAdvection) {
      this.advectVelocity(dt);
      this.advectColor(dt);
    }

    // 2.5 边界处理 —— 移到压力投影之前，避免与压力梯度修正拮抗
    this.applyBoundary();

    // 3. 压力投影（红-黑 SOR）
    if (this.config.enablePressure) {
      this.solvePressure(this.config.pressureIterations, this.config.pressureOmega);
      this.applyPressureGradient();
    }

    // 4. Level Set（预留）
    // if (this.config.enableLevelSet) this.solveLevelSet();

    this.time += dt;
  }

  // ==================== GPU Pass 实现 ====================

  /** 速度自平流 */
  private advectVelocity(dt: number): void {
    const mask: AdvectionMask = { r: true, g: true, b: false, a: false };
    const subSteps = Math.max(1, Math.ceil(Math.abs(this.config.gravity) * dt / 50));
    
    this.advectionSolver.advect(
      this.velocityGrid,
      this.velocityGrid.read,
      dt,
      mask,
      { boundaryMode: 'clamp', subSteps },
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
    
    this.advectionSolver.advect(
      this.colorGrid,
      this.velocityGrid.read,
      dt,
      mask,
      { boundaryMode, subSteps: 6 },
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
   * 采样指定像素位置的颜色和速度值。
   * @param x 像素 X 坐标（0 ~ w-1）
   * @param y 像素 Y 坐标（0 ~ h-1，注意：这是纹理坐标，Y向上为正）
   * @returns { h, s, l, a, velX, velY } HSLA 值（0~1）和速度值（像素/秒）
   */
  samplePixel(x: number, y: number): {
    h: number; s: number; l: number; a: number;
    velX: number; velY: number;
  } {
    const { w, h } = this.config.resolution;
    // 钳制到有效范围
    const px = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(h - 1, Math.floor(y)));

    // 1. 读取颜色像素（RGBA uint8）
    const colorPixels = this.readColorPixels();
    const idx = (py * w + px) * 4;
    const r = colorPixels[idx] / 255;
    const g = colorPixels[idx + 1] / 255;
    const b = colorPixels[idx + 2] / 255;
    const a = colorPixels[idx + 3] / 255;

    // RGB → HSL 转换
    const hsl = this.rgbToHsl(r, g, b);

    // 2. 读取速度像素（直接使用 Float32Array，让 Three.js 自动转换 half-float → float32）
    const velData = new Float32Array(2); // 只需两个通道 R (X) 和 G (Y)
    const target = this.velocityGrid.readTarget;
    const prevTarget = this.renderer.getRenderTarget();
    
    this.renderer.setRenderTarget(target);
    // Three.js 会自动将 half-float 或 float 纹理数据转为 32 位浮点数填充到 velData 中
    this.renderer.readRenderTargetPixels(target, px, py, 1, 1, velData);
    this.renderer.setRenderTarget(prevTarget);

    const velX = velData[0];
    const velY = velData[1];


    return { h: hsl.h, s: hsl.s, l: hsl.l, a, velX, velY };
  }

  /** RGB(0~1) → HSL(0~1) */
  private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return { h, s, l };
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

    // 统计非零像素
    let nonZeroCount = 0;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] !== 0) { nonZeroCount++; }
    }

    return pixels;
  }

  /**
   * 将速度场从 GPU 回读到 CPU（Uint8Array RGBA，R=velX, G=velY）。
   * 注意：velocityGrid 是 RG 双通道格式，readRenderTargetPixels 只返回 w*h*2 字节。
   * 此方法自动将其扩展为 w*h*4 字节的 RGBA 数据，以便 UI 直接构造 ImageData。
   */
  readVelocityPixels(): Uint8Array {
    const { w, h } = this.config.resolution;
    const raw = new Uint8Array(w * h * 2);
    const target = this.velocityGrid.readTarget;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, raw);
    this.renderer.setRenderTarget(prevTarget);

    // 扩展为 RGBA
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4]     = raw[i * 2];
      rgba[i * 4 + 1] = raw[i * 2 + 1];
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = 255;
    }

    // 统计非零速度
    let nonZeroCount = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== 0) { nonZeroCount++; }
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
    
    // 2. 回读速度数据（使用 Float32Array，Three.js 自动转换 half-float → float32）
    const velPixels = new Float32Array(w * h * 2); // RG 双通道，每个像素 2 个 float32
    const target = this.velocityGrid.readTarget;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, velPixels);
    this.renderer.setRenderTarget(prevTarget);
    
    // 直接转换为二维数组（无需手动 half-float 转换）
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


    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.pressureGrid?.dispose();

    this.colorGrid = new FluidGrid(
      this.config.resolution,
      colorCh as 1 | 2 | 3 | 4,
      'uint8',
    );
    this.velocityGrid = new FluidGrid(this.config.resolution, 2, 'float'); // 使用 float 而非 half-float，便于 readPixels
    this.pressureGrid = new FluidGrid(this.config.resolution, 1, 'half-float'); // 压力场：单通道半精度浮点
  }

  /** 初始化场数据：全透明空场 + 零速度 */
  public initFields(): void {
    const { w, h } = this.config.resolution;


    // 初始颜色场：完全透明（空场），依靠注入源产生动态流体
    // 注意：uint8 网格需要 Uint8Array，half-float 需要 Float32Array
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
   * 将 CPU 数据上传到 FluidGrid。
   * 使用临时 DataTexture + copy shader 渲染到 grid.write。
   * 
   * 注意：确保数据类型与目标网格匹配！
   * - uint8 网格：数据应在 [0, 255] 范围，使用 Uint8Array
   * - half-float/float 网格：数据应在 [-1, 1] 或 [0, 1] 范围，使用 Float32Array
   */
  private uploadToGrid(
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
        console.warn(`[FluidEditor.uploadToGrid] 警告: uint8 网格收到 Float32Array 数据，将进行转换`);
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
        console.warn(`[FluidEditor.uploadToGrid] 警告: float 网格收到 Uint8Array 数据，将进行转换`);
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
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

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
