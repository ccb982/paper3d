import * as THREE from 'three';
import type { FluidGrid, AdvectionMask } from '../core/FluidGrid';

/**
 * 平流求解器选项。
 */
export interface AdvectionOptions {
  /**
   * 子步数。当速度极大时拆分为多个子步，避免单步反向追踪飞出纹理范围。
   * 默认 1（不分步），由管理层根据最大速度自动计算。
   *
   * 公式：subSteps = ceil(maxVelocity * dt / resolution * safetyFactor)
   */
  subSteps?: number;

  /**
   * 边界模式 —— 反向追踪越界时的处理方式。
   * - 'clamp'（默认）：钳制到纹理边缘
   * - 'repeat'：周期重复（回绕）
   * - 'zero'：越界返回 0
   */
  boundaryMode?: 'clamp' | 'repeat' | 'zero';
}

/**
 * AdvectionSolver —— 半拉格朗日平流求解器。
 *
 * 核心创新：逐通道平流掩码（AdvectionMask）。
 * 通过 mix(static, flow, mask) 对每个 RGBA 通道独立决策是否平流。
 * mask=0 的通道直传（像素原地不动），mask=1 的通道跟随速度场流动。
 *
 * 物理通道 = RGBA，逻辑语义 = HSLA（R=H, G=S, B=L, A=Alpha）。
 * 求解器不关心数据语义，只根据掩码搬运数据。
 * 唯一的语义感知：如果 R 通道被标记为平流，着色器会应用色相环保护（fract 包裹）。
 *
 * 使用方式：
 *   const solver = new AdvectionSolver(renderer);
 *   const grid = new FluidGrid({ w: 256, h: 256 }, 4, 'uint8');
 *   const mask: AdvectionMask = { r: false, g: true, b: true, a: false };
 *   solver.advect(grid, velocityTex, dt, mask);
 *   // 结果在 grid.read 中
 */
export class AdvectionSolver {
  private renderer: THREE.WebGLRenderer;

  // 全屏渲染所需的 Three.js 资源
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;
  private quadGeometry: THREE.PlaneGeometry;

  // 材质缓存：按掩码 key 缓存 ShaderMaterial，避免重复编译
  // key 格式: "1010" → r=1, g=0, b=1, a=0
  private materialCache: Map<string, THREE.ShaderMaterial> = new Map();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // 创建全屏渲染环境（与旧 FluidSimulator 模式一致）
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeometry);
    this.scene.add(this.quad);
  }

  /**
   * 执行一次半拉格朗日平流。
   *
   * @param grid - 双缓冲纹理网格（读取 grid.read，写入 grid.write，完成后 swap）
   * @param velocity - 速度场纹理（RG 通道，单位：像素/秒）
   * @param dt - 时间步长（秒）
   * @param mask - 逐通道平流掩码
   * @param options - 可选配置（子步数、边界模式）
   */
  advect(
    grid: FluidGrid,
    velocity: THREE.Texture,
    dt: number,
    mask: AdvectionMask,
    options: AdvectionOptions = {},
  ): void {
    const { subSteps = 1, boundaryMode = 'clamp' } = options;
    const subDt = dt / subSteps;

    const material = this.getOrCreateMaterial(mask, boundaryMode);

    // 更新与帧无关的 uniform
    material.uniforms.uVelocity.value = velocity;
    material.uniforms.uResolution.value.set(grid.resolution.w, grid.resolution.h);

    // 子步循环
    for (let step = 0; step < subSteps; step++) {
      material.uniforms.uInput.value = grid.read;
      material.uniforms.uDt.value = subDt;

      this.renderFullscreen(material, grid.write);
      grid.swap();
    }
  }

  /**
   * 获取或创建指定掩码的 ShaderMaterial（缓存）。
   */
  private getOrCreateMaterial(
    mask: AdvectionMask,
    boundaryMode: 'clamp' | 'repeat' | 'zero',
  ): THREE.ShaderMaterial {
    const key = `${mask.r ? 1 : 0}${mask.g ? 1 : 0}${mask.b ? 1 : 0}${mask.a ? 1 : 0}_${boundaryMode}`;

    let material = this.materialCache.get(key);
    if (material) return material;

    material = this.buildMaterial(mask, boundaryMode);
    this.materialCache.set(key, material);
    return material;
  }

  /**
   * 动态构建着色器材质（根据掩码和边界模式生成片段着色器）。
   */
  private buildMaterial(
    mask: AdvectionMask,
    boundaryMode: 'clamp' | 'repeat' | 'zero',
  ): THREE.ShaderMaterial {
    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // 动态生成片段着色器
    let boundaryFn: string;
    switch (boundaryMode) {
      case 'repeat':
        boundaryFn = 'backUv = fract(backUv);';
        break;
      case 'zero':
        boundaryFn = `
          if (backUv.x < 0.0 || backUv.x > 1.0 || backUv.y < 0.0 || backUv.y > 1.0) {
            gl_FragColor = vec4(0.0);
            return;
          }
        `;
        break;
      case 'clamp':
      default:
        boundaryFn = 'backUv = clamp(backUv, vec2(0.0), vec2(1.0));';
        break;
    }

    // 色相环保护：仅当 R 通道（Hue）参与平流时启用
    const hueWrap = mask.r
      ? '  result.r = fract(result.r + 1.0);\n'
      : '';

    const fragmentShader = /* glsl */ `
      uniform sampler2D uInput;
      uniform sampler2D uVelocity;
      uniform float uDt;
      uniform vec2 uResolution;
      uniform vec4 uMask;

      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;

        // 1. 反向追踪：从当前像素沿速度反方向回溯
        vec2 vel = texture2D(uVelocity, uv).rg;
        vec2 backUv = uv - vel * uDt / uResolution;

        // 2. 边界处理
        ${boundaryFn}

        // 3. 采样静止值和流动值
        vec4 staticVal = texture2D(uInput, uv);
        vec4 flowVal  = texture2D(uInput, backUv);

        // 4. 逐通道混合：mask=0 → 直传，mask=1 → 平流
        vec4 result;
        result.r = mix(staticVal.r, flowVal.r, uMask.r);
        result.g = mix(staticVal.g, flowVal.g, uMask.g);
        result.b = mix(staticVal.b, flowVal.b, uMask.b);
        result.a = mix(staticVal.a, flowVal.a, uMask.a);

        // 5. 色相环保护（仅 R=Hue 平流时）
        ${hueWrap}
        gl_FragColor = result;
      }
    `;

    return new THREE.ShaderMaterial({
      uniforms: {
        uInput: { value: null },
        uVelocity: { value: null },
        uDt: { value: 0 },
        uResolution: { value: new THREE.Vector2() },
        uMask: { value: new THREE.Vector4(
          mask.r ? 1.0 : 0.0,
          mask.g ? 1.0 : 0.0,
          mask.b ? 1.0 : 0.0,
          mask.a ? 1.0 : 0.0,
        ) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * 全屏渲染到 RenderTarget。
   * 模式与旧 FluidSimulator.renderFullscreen 一致。
   */
  private renderFullscreen(
    material: THREE.ShaderMaterial,
    outputTarget: THREE.WebGLRenderTarget,
  ): void {
    const prevMaterial = this.quad.material;
    this.quad.material = material;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(outputTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);

    this.quad.material = prevMaterial;
  }

  /**
   * 释放 GPU 资源。
   */
  dispose(): void {
    for (const material of this.materialCache.values()) {
      material.dispose();
    }
    this.materialCache.clear();
    this.quadGeometry.dispose();
    // scene 和 camera 无需特殊清理
  }
}
