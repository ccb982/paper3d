import * as THREE from 'three';
import type { FluidGrid, AdvectionMask } from '../core/FluidGrid';

/** ★ 模块级 scratch（热路径零分配）：clear 前保存/恢复全局清屏色 */
const _prevClearColor = new THREE.Color();

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

  /**
   * 是否对 R 通道应用色相环包裹（fract(r+1)）。
   *
   * ⚠️ 仅当 R 通道语义为色相 H（即颜色场平流）时才设为 true。
   *    速度场平流时 R=vx（像素/秒），必须为 false，否则 fract 会把速度
   *    截断到 [0,1) 区间，横向速度瞬间被清零（仅剩小数残差），表现为
   *    "注入横向速度后只有竖向运动"。
   *
   * 默认 false（速度场等非色相场的安全默认值）。
   */
  wrapHue?: boolean;

  /**
   * 障碍物纹理（可选）。
   * 传入时，回溯点落在墙内（R>0.5）的像素将被阻止从墙内拉取流体。
   * 不传时内部使用 dummy 零纹理，不影响原有行为。
   */
  obstacleTexture?: THREE.Texture;
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
 * 障碍物支持：uObstacle uniform 始终存在，当回溯点落在墙内时，
 * 阻止从墙内拉取流体（flowVal 替换为 staticVal），形成不可穿透的墙体。
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

  /** 1×1 零纹理（R=0），用于无障碍物时的 dummy 采样 */
  private zeroObstacleTex: THREE.DataTexture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // 创建全屏渲染环境（与旧 FluidSimulator 模式一致）
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeometry);
    this.scene.add(this.quad);
  }

  /** 获取零纹理（R=0，无障碍） */
  private getZeroObstacleTex(): THREE.Texture {
    if (!this.zeroObstacleTex) {
      this.zeroObstacleTex = new THREE.DataTexture(
        new Uint8Array([0]),
        1, 1, THREE.RedFormat, THREE.UnsignedByteType,
      );
      this.zeroObstacleTex.minFilter = THREE.NearestFilter;
      this.zeroObstacleTex.magFilter = THREE.NearestFilter;
      this.zeroObstacleTex.needsUpdate = true;
    }
    return this.zeroObstacleTex;
  }

  /**
   * 执行一次半拉格朗日平流。
   *
   * @param grid - 双缓冲纹理网格（读取 grid.read，写入 grid.write，完成后 swap）
   * @param velocity - 速度场纹理（RG 通道，单位：像素/秒）
   * @param dt - 时间步长（秒）
   * @param mask - 逐通道平流掩码
   * @param options - 可选配置（子步数、边界模式、障碍物纹理）
   */
  advect(
    grid: FluidGrid,
    velocity: THREE.Texture,
    dt: number,
    mask: AdvectionMask,
    options: AdvectionOptions = {},
  ): void {
    const { subSteps = 1, boundaryMode = 'clamp', wrapHue = false, obstacleTexture } = options;
    const subDt = dt / subSteps;

    const material = this.getOrCreateMaterial(mask, boundaryMode, wrapHue);

    // 更新与帧无关的 uniform
    material.uniforms.uVelocity.value = velocity;
    material.uniforms.uResolution.value.set(grid.resolution.w, grid.resolution.h);
    // ★ 障碍物 uniform：每帧更新实际纹理（或零纹理）
    material.uniforms.uObstacle.value = obstacleTexture || this.getZeroObstacleTex();

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
   *
   * 缓存 key 包含 wrapHue：速度场（wrapHue=false）与颜色场（wrapHue=true）
   * 即便掩码相同也会生成不同的着色器，避免色相环包裹误伤速度场。
   *
   * 注意：障碍物 uniform 不在缓存 key 中——它是动态值，每帧通过
   * material.uniforms.uObstacle.value 更新，无需重新编译着色器。
   */
  private getOrCreateMaterial(
    mask: AdvectionMask,
    boundaryMode: 'clamp' | 'repeat' | 'zero',
    wrapHue: boolean,
  ): THREE.ShaderMaterial {
    const key = `${mask.r ? 1 : 0}${mask.g ? 1 : 0}${mask.b ? 1 : 0}${mask.a ? 1 : 0}_${boundaryMode}_${wrapHue ? 'h' : 'n'}`;

    let material = this.materialCache.get(key);
    if (material) return material;

    material = this.buildMaterial(mask, boundaryMode, wrapHue);
    this.materialCache.set(key, material);
    return material;
  }

  /**
   * 动态构建着色器材质（根据掩码、边界模式、色相包裹生成片段着色器）。
   * 始终包含 uObstacle uniform，墙体回溯拦截逻辑。
   */
  private buildMaterial(
    mask: AdvectionMask,
    boundaryMode: 'clamp' | 'repeat' | 'zero',
    wrapHue: boolean,
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

    // 色相环保护：仅当 wrapHue=true（颜色场，R=Hue）且 R 通道参与平流时启用。
    const hueWrap = (wrapHue && mask.r)
      ? '  result.r = fract(result.r + 1.0);\n'
      : '';

    const fragmentShader = /* glsl */ `
      uniform sampler2D uInput;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
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

        // 3. ★ 墙体回溯拦截：如果回溯点落在墙内，阻止从墙内拉取流体
        //    使用墙体当前像素的值作为 flowVal（不穿透墙体）
        vec4 staticVal = texture2D(uInput, uv);
        vec4 flowVal;
        if (texture2D(uObstacle, backUv).r > 0.5) {
          flowVal = staticVal;  // 墙内无流动，使用当前值
        } else {
          flowVal = texture2D(uInput, backUv);
        }

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
        uObstacle: { value: null },
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
    // ★ 数据纹理禁止让全局清屏色泄漏：强制黑/透明清屏后立即恢复（事故记录 #001）
    this.renderer.getClearColor(_prevClearColor);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(outputTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setClearColor(_prevClearColor, prevAlpha);
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
    this.zeroObstacleTex?.dispose();
    this.zeroObstacleTex = null;
    // scene 和 camera 无需特殊清理
  }
}
