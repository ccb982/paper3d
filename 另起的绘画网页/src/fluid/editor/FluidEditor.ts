import * as THREE from 'three';
import { FluidGrid } from '../core/FluidGrid';
import type { AdvectionMask } from '../core/FluidGrid';
import { AdvectionSolver } from '../solvers/AdvectionSolver';

// ============================================================
// 类型定义
// ============================================================

export type ViewMode = 'color' | 'velocity';

export interface FluidEditorConfig {
  resolution: { w: number; h: number };
  /** 逐通道平流开关（物理 RGBA，逻辑 HSLA：R=H, G=S, B=L, A=Alpha） */
  channels: { r: boolean; g: boolean; b: boolean; a: boolean };
  enableAdvection: boolean;
  enablePressure: boolean;   // 预留
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
// GPUOps 内辅类 —— 全屏四边形 + 材质缓存
// ============================================================

/**
 * 统一的全屏 GPU 渲染辅助类。
 * 持有一个全屏四边形 + 正交相机 + 场景，材质按 key 缓存。
 * 所有 Pass（copy、gravity、injection、boundary）共用这一套基础设施，
 * 避免每帧创建 / 销毁 ShaderMaterial / Scene / Quad 的巨额开销。
 */
class GPUOps {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private quadGeom: THREE.PlaneGeometry;

  private materials: Map<string, THREE.ShaderMaterial> = new Map();

  private static readonly VS = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeom = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeom);
    this.scene.add(this.quad);
  }

  /**
   * 获取或创建材质（按 key 缓存）。
   * 如果材质已存在则只更新 uniforms，避免重新编译着色器。
   */
  getMaterial(
    key: string,
    uniforms: Record<string, { value: unknown }>,
    fragmentShader: string,
  ): THREE.ShaderMaterial {
    let mat = this.materials.get(key);
    if (mat) {
      for (const [name, u] of Object.entries(uniforms)) {
        if (mat.uniforms[name]) mat.uniforms[name].value = u.value;
      }
      return mat;
    }
    mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: GPUOps.VS,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.materials.set(key, mat);
    return mat;
  }

  /**
   * 全屏渲染到 RenderTarget。
   */
  render(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    material: THREE.ShaderMaterial,
  ): void {
    const prevMat = this.quad.material;
    this.quad.material = material;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);

    this.quad.material = prevMat;
  }

  dispose(): void {
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.quadGeom.dispose();
  }
}

// ============================================================
// FluidEditor —— 核心管理层
// ============================================================

/**
 * FluidEditor 是流体模拟的"指挥中心"，持有所有场和求解器。
 *
 * 每帧流程（step）：
 *   重力 → 注入源 → 速度自平流 → 颜色平流 → 边界处理
 *   （压力和 Level Set 模块预留接口）
 *
 * 使用方式：
 *   const editor = new FluidEditor(renderer, config);
 *   editor.step(dt);  // 每帧调用
 *   const tex = editor.getColorTexture();  // 获取当前颜色纹理
 */
export class FluidEditor {
  private renderer: THREE.WebGLRenderer;
  private gpu: GPUOps;

  /** 可变的配置引用（通过 updateConfig 更新） */
  config: FluidEditorConfig;

  // 场
  colorGrid!: FluidGrid;
  velocityGrid!: FluidGrid;

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

  /** 执行一帧模拟 */
  step(dt: number): void {
    if (dt <= 0) return;

    this.frameCount++;
    
    // 每 30 帧输出一次详细调试信息
    if (this.frameCount % 30 === 1) {
    }

    // 0. 重力
    if (this.config.gravity !== 0) {
      this.applyGravity(dt);
    }

    // 1. 注入源
    if (this.config.injection.enabled) {
      const inj = this.config.injection;
      this.applyInjection(dt);
    }

    // 2. 平流
    if (this.config.enableAdvection) {
      this.advectVelocity(dt);
      this.advectColor(dt);
    }

    // 3. 压力投影（预留）
    // if (this.config.enablePressure) this.solvePressure();

    // 4. Level Set（预留）
    // if (this.config.enableLevelSet) this.solveLevelSet();

    // 5. 边界处理
    this.applyBoundary();

    this.time += dt;

    // ==================== 临时调试：打印中心点速度 ====================
    if (this.frameCount % 30 === 0) {
      const { w, h } = this.config.resolution;
      const centerX = Math.floor(w / 2);
      const centerY = Math.floor(h / 2);
      const velData = new Float32Array(2);
      const target = this.velocityGrid.readTarget;
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.readRenderTargetPixels(target, centerX, centerY, 1, 1, velData);
      this.renderer.setRenderTarget(prev);
    }
  }

  // ==================== GPU Pass 实现 ====================

  /**
   * 施加重力：向速度场 Y 分量累加 gravity * dt。
   * 注意：用户接口 Y 向下为正，内部纹理坐标 Y 向上为正，所以需要取反。
   */
  private applyGravity(dt: number): void {
    const g = this.config.gravity;

    const mat = this.gpu.getMaterial('gravity', {
      velTex: { value: this.velocityGrid.read },
      gDt: { value: -g * dt }, // 取反：用户Y向下为正，纹理Y向上为正
    }, /* glsl */ `
      uniform sampler2D velTex;
      uniform float gDt;
      varying vec2 vUv;
      void main() {
        vec2 vel = texture2D(velTex, vUv).rg;
        vel.y += gDt;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, this.velocityGrid.write, mat);
    this.velocityGrid.swap();
  }

  /**
   * 恒定注入源：在指定位置持续注入颜色和速度。
   * 使用 smoothstep 混合旧值和新值，避免硬边缘。
   * 注意：用户接口 Y 向下为正，内部纹理坐标 Y 向上为正，所以位置Y和速度Y都需要取反。
   */
  private applyInjection(dt: number): void {
    const inj = this.config.injection;
    const rate = inj.rate * dt;

    // 位置Y取反：用户Y向下为正（0=顶部），纹理Y向上为正（0=底部）
    const texPosY = 1.0 - inj.position.y;
    // 速度Y取反：用户Y向下为正，纹理Y向上为正
    const texVelY = -inj.velocity.y;

    // 颜色注入
    const colorMat = this.gpu.getMaterial('injectColor', {
      colorTex: { value: this.colorGrid.read },
      pos: { value: new THREE.Vector2(inj.position.x, texPosY) },
      radius: { value: inj.radius },
      color: { value: new THREE.Vector4(inj.color[0], inj.color[1], inj.color[2], inj.color[3]) },
      rate: { value: rate },
    }, /* glsl */ `
      uniform sampler2D colorTex;
      uniform vec2 pos;
      uniform float radius;
      uniform vec4 color;
      uniform float rate;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, pos);
        float mask = smoothstep(radius, 0.0, d);
        vec4 old = texture2D(colorTex, vUv);
        gl_FragColor = old + (color - old) * rate * mask;
      }
    `);
    this.gpu.render(this.renderer, this.colorGrid.write, colorMat);
    this.colorGrid.swap();

    // 速度注入
    const velMat = this.gpu.getMaterial('injectVel', {
      velTex: { value: this.velocityGrid.read },
      pos: { value: new THREE.Vector2(inj.position.x, texPosY) },
      radius: { value: inj.radius },
      vel: { value: new THREE.Vector2(inj.velocity.x, texVelY) },
      rate: { value: rate },
    }, /* glsl */ `
      uniform sampler2D velTex;
      uniform vec2 pos;
      uniform float radius;
      uniform vec2 vel;
      uniform float rate;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, pos);
        float mask = smoothstep(radius, 0.0, d);
        vec2 old = texture2D(velTex, vUv).rg;
        gl_FragColor = vec4(old + vel * rate * mask, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, velMat);
    this.velocityGrid.swap();
  }

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

    this.colorGrid = new FluidGrid(
      this.config.resolution,
      colorCh as 1 | 2 | 3 | 4,
      'uint8',
    );
    this.velocityGrid = new FluidGrid(this.config.resolution, 2, 'float'); // 使用 float 而非 half-float，便于 readPixels
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

    const tex = new THREE.DataTexture(
      data,
      w,
      h,
      channels === 4 ? THREE.RGBAFormat : THREE.RGFormat,
      texType,
    );
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const copyKey = `copy_${channels}ch_${grid.dataType}`;
    const copyMat = this.gpu.getMaterial(copyKey, {
      tex: { value: tex },
    },
      channels === 4
        ? /* glsl */ `uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }`
        : /* glsl */ `uniform sampler2D tex; varying vec2 vUv; void main() { vec2 v = texture2D(tex, vUv).rg; gl_FragColor = vec4(v, 0.0, 1.0); }`,
    );

    this.gpu.render(this.renderer, grid.write, copyMat);
    grid.swap();
    tex.dispose();

  }

  // ==================== 销毁 ====================

  dispose(): void {
    this.colorGrid?.dispose();
    this.velocityGrid?.dispose();
    this.advectionSolver.dispose();
    this.gpu.dispose();
  }
}
