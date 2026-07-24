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
  /** 重力加速度（像素/秒²），负值向下 */
  gravity: number;
  /** 恒定注入源配置 */
  injection: {
    enabled: boolean;
    position: { x: number; y: number };  // 归一化 (0~1)
    radius: number;                       // 归一化半径
    rate: number;                         // 每帧注入量 (0~1)
    velocity: { x: number; y: number };   // 注入速度（像素/秒）
    color: [number, number, number, number]; // RGBA
  };
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
      // 只重建网格（不重新初始化），保持已有状态
      // 注入源会在下一帧 step 中自动填充新网格
      this.rebuildGrids();
    }
  }

  // ==================== 每帧更新 ====================

  /** 执行一帧模拟 */
  step(dt: number): void {
    if (dt <= 0) return;

    // 0. 重力
    if (this.config.gravity !== 0) this.applyGravity(dt);

    // 1. 注入源
    if (this.config.injection.enabled) this.applyInjection(dt);

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
  }

  // ==================== GPU Pass 实现 ====================

  /**
   * 施加重力：向速度场 Y 分量累加 gravity * dt。
   */
  private applyGravity(dt: number): void {
    const g = this.config.gravity;

    const mat = this.gpu.getMaterial('gravity', {
      velTex: { value: this.velocityGrid.read },
      gDt: { value: g * dt },
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
   */
  private applyInjection(dt: number): void {
    const inj = this.config.injection;
    const rate = inj.rate * dt;

    // 颜色注入
    const colorMat = this.gpu.getMaterial('injectColor', {
      colorTex: { value: this.colorGrid.read },
      pos: { value: new THREE.Vector2(inj.position.x, inj.position.y) },
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
      pos: { value: new THREE.Vector2(inj.position.x, inj.position.y) },
      radius: { value: inj.radius },
      vel: { value: new THREE.Vector2(inj.velocity.x, inj.velocity.y) },
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
        gl_FragColor = vec4(old + (vel - old) * rate * mask, 0.0, 1.0);
      }
    `);
    this.gpu.render(this.renderer, this.velocityGrid.write, velMat);
    this.velocityGrid.swap();
  }

  /** 速度自平流 */
  private advectVelocity(dt: number): void {
    const mask: AdvectionMask = { r: true, g: true, b: false, a: false };
    this.advectionSolver.advect(
      this.velocityGrid,
      this.velocityGrid.read,
      dt,
      mask,
      { boundaryMode: 'clamp', subSteps: Math.max(1, Math.ceil(Math.abs(this.config.gravity) * dt / 50)) },
    );
  }

  /** 颜色平流（掩码由 config.channels 决定） */
  private advectColor(dt: number): void {
    const ch = this.config.channels;
    const mask: AdvectionMask = { r: ch.r, g: ch.g, b: ch.b, a: ch.a };
    if (!mask.r && !mask.g && !mask.b && !mask.a) return;

    this.advectionSolver.advect(
      this.colorGrid,
      this.velocityGrid.read,
      dt,
      mask,
      { boundaryMode: 'clamp', subSteps: 6 },
    );
  }

  /** 边界处理：将纹理边缘速度置零，防止能量泄露 */
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
        if (vUv.x < eps || vUv.x > 1.0 - eps ||
            vUv.y < eps || vUv.y > 1.0 - eps) {
          vel = vec2(0.0);
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
    return this.colorGrid.read;
  }

  /** 获取速度场纹理（RG 通道，需要可视化转换） */
  getVelocityTexture(): THREE.Texture {
    return this.velocityGrid.read;
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
   * 注意：velocityGrid 是 RG 双通道格式，readRenderTargetPixels 只返回 w*h*2 字节。
   * 此方法自动将其扩展为 w*h*4 字节的 RGBA 数据，以便 UI 直接构造 ImageData。
   */
  readVelocityPixels(): Uint8Array {
    const { w, h } = this.config.resolution;
    const raw = new Uint8Array(w * h * 2);
    const target = this.velocityGrid.readTarget;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    // Three.js readRenderTargetPixels 根据纹理格式决定读取字节数
    // RGFormat → w*h*2 字节
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, raw);
    this.renderer.setRenderTarget(prevTarget);

    // 扩展为 RGBA（ImageData 需要 4 字节/像素）
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4]     = raw[i * 2];     // R = velX
      rgba[i * 4 + 1] = raw[i * 2 + 1]; // G = velY
      rgba[i * 4 + 2] = 0;              // B = 0
      rgba[i * 4 + 3] = 255;            // A = 255
    }
    return rgba;
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
    this.velocityGrid = new FluidGrid(this.config.resolution, 2, 'uint8');
  }

  /** 初始化场数据：颜色 = 中心圆形水坑，速度 = 零 */
  private initFields(): void {
    const { w, h } = this.config.resolution;

    // 默认初始颜色：中心圆形蓝色水坑
    const colorData = new Float32Array(w * h * 4);
    const center = { x: 0.5, y: 0.5 };
    const radius = 0.2;
    const color: [number, number, number, number] = [0.2, 0.5, 0.8, 1.0];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x / w - center.x;
        const dy = y / h - center.y;
        const inside = dx * dx + dy * dy < radius * radius ? 1 : 0;
        const idx = (y * w + x) * 4;
        colorData[idx]     = color[0] * inside;
        colorData[idx + 1] = color[1] * inside;
        colorData[idx + 2] = color[2] * inside;
        colorData[idx + 3] = color[3] * inside;
      }
    }
    this.uploadToGrid(this.colorGrid, colorData, 4);

    // 零速度
    const velData = new Float32Array(w * h * 2);
    this.uploadToGrid(this.velocityGrid, velData, 2);
  }

  /**
   * 将 Float32Array CPU 数据上传到 FluidGrid。
   * 使用临时 DataTexture + copy shader 渲染到 grid.write。
   */
  private uploadToGrid(
    grid: FluidGrid,
    data: Float32Array,
    channels: number,
  ): void {
    const { w, h } = this.config.resolution;

    const tex = new THREE.DataTexture(
      data,
      w,
      h,
      channels === 4 ? THREE.RGBAFormat : THREE.RGFormat,
      THREE.FloatType,
    );
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const copyKey = `copy_${channels}ch`;
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
