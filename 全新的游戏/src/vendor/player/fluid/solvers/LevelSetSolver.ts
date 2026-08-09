import * as THREE from 'three';
import type { FluidGrid } from '../core/FluidGrid';
import { GPUOps } from '../core/GPUOps';

// ============================================================
// LevelSetSolver —— Level Set 方法独立模块
// ============================================================
//
// 设计原则：热插拔、零侵入、懒加载
//   - 本类不持有任何纹理资源（phiGrid 由 FluidSolver 管理，作为参数传入）
//   - 仅负责 GPU Pass 编排，复用 GPUOps 的全屏渲染基础设施
//   - 着色器通过 gpu.getMaterial(key, uniforms, fragShader) 缓存，避免重复编译
//
// 三大功能：
//   1. advectPhi       —— Level Set 平流（半拉格朗日，复用 AdvectionSolver 风格）
//   2. reinit          —— 轻量级重初始化（红-黑 SOR 风格，求解 ∂φ/∂τ = sign(φ₀)·(1-|∇φ|)）
//   3. applySurfaceTension —— 表面张力注入（CSF 模型，F_st = σ·κ·∇φ）
//
// Y-flip 约定：与所有 GPU Pass 一致，使用 vUv=uv（不翻转 Y）
// 障碍物约定：uObstacle 始终存在，R>0.5 表示墙，墙内 φ=0、速度保持原值

export interface LevelSetOptions {
  /** 重初始化迭代次数（默认 2，轻量化） */
  reinitIterations: number;
  /** 表面张力系数 σ（0=禁用张力） */
  surfaceTension: number;
  /** 表面张力作用半径（像素，仅 |φ|<radius 区域施力） */
  smoothingRadius: number;
  /** 重初始化伪时间步（默认 0.5，CFL 安全） */
  dtPseudo?: number;
}

export class LevelSetSolver {
  constructor(
    private renderer: THREE.WebGLRenderer,
    private gpu: GPUOps,
  ) {}

  // ==================== 1. Level Set 平流 ====================

  /**
   * 半拉格朗日平流 φ 场。
   * 1 通道 half-float 专用 Pass，避免 4 通道 vec4 浪费带宽。
   *
   * @param phiGrid    φ 场双缓冲（读取 read，写入 write，调用方 swap）
   * @param velocityTex 速度场纹理（RG 通道，像素/秒）
   * @param dt         时间步长（秒）
   * @param obstacleTex 障碍物纹理
   */
  advectPhi(
    phiGrid: FluidGrid,
    velocityTex: THREE.Texture,
    dt: number,
    obstacleTex: THREE.Texture,
  ): void {
    const w = phiGrid.resolution.w;
    const h = phiGrid.resolution.h;

    const mat = this.gpu.getMaterial('levelset_advect', {
      uPhi: { value: phiGrid.read },
      uVelocity: { value: velocityTex },
      uObstacle: { value: obstacleTex },
      uDt: { value: dt },
      uResolution: { value: new THREE.Vector2(w, h) },
    }, /* glsl */ `
      uniform sampler2D uPhi;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform float uDt;
      uniform vec2 uResolution;
      varying vec2 vUv;

      void main() {
        // 1. 反向追踪
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vec2 backUv = vUv - vel * uDt / uResolution;
        backUv = clamp(backUv, vec2(0.0), vec2(1.0));

        // 2. 墙体回溯拦截：回溯点落在墙内时，使用当前值（不穿透）
        float staticVal = texture2D(uPhi, vUv).r;
        float flowVal = (texture2D(uObstacle, backUv).r > 0.5)
          ? staticVal
          : texture2D(uPhi, backUv).r;

        // 3. 墙内 φ 保持 0（不可穿透）
        if (texture2D(uObstacle, vUv).r > 0.5) {
          flowVal = 0.0;
        }

        gl_FragColor = vec4(flowVal, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, phiGrid.write, mat);
    phiGrid.swap();
  }

  // ==================== 2. 重初始化 ====================

  /**
   * 红-黑 SOR 风格重初始化，求解 ∂φ/∂τ = sign(φ₀)·(1-|∇φ|)。
   *
   * 显式 Euler 伪时间演化，dt_pseudo=0.5 满足 CFL（dt ≤ dx，dx=1 像素）。
   * 红黑迭代比纯 Jacobi 快约 2 倍。
   *
   * 注意：sign(φ) 用当前值而非 phi0 快照（reinitIterations=2 时漂移可忽略，
   *       保持"懒加载/零侵入"原则，不引入额外纹理）。
   *
   * @param phiGrid     φ 场
   * @param obstacleTex 障碍物纹理
   * @param iterations  迭代次数（每次包含 1 红 + 1 黑 Pass）
   * @param dtPseudo    伪时间步（默认 0.5）
   */
  reinit(
    phiGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    iterations: number,
    dtPseudo: number = 0.5,
  ): void {
    for (let i = 0; i < iterations; i++) {
      this.runReinitPass(phiGrid, obstacleTex, true, dtPseudo);   // red
      this.runReinitPass(phiGrid, obstacleTex, false, dtPseudo);  // black
    }
  }

  private runReinitPass(
    phiGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    isRed: boolean,
    dtPseudo: number,
  ): void {
    const w = phiGrid.resolution.w;
    const h = phiGrid.resolution.h;

    const mat = this.gpu.getMaterial(
      `levelset_reinit_${isRed ? 'r' : 'b'}`,
      {
        uPhi: { value: phiGrid.read },
        uObstacle: { value: obstacleTex },
        uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
        uIsRed: { value: isRed ? 1 : 0 },
        uDtPseudo: { value: dtPseudo },
      },
      /* glsl */ `
        uniform sampler2D uPhi;
        uniform sampler2D uObstacle;
        uniform vec2 uInvRes;
        uniform int uIsRed;
        uniform float uDtPseudo;
        varying vec2 vUv;

        void main() {
          // 墙内 φ=0
          if (texture2D(uObstacle, vUv).r > 0.5) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          vec2 ts = uInvRes;

          // 边界零梯度（自由流出 SDF，避免反射）
          if (vUv.x < ts.x || vUv.x > 1.0 - ts.x ||
              vUv.y < ts.y || vUv.y > 1.0 - ts.y) {
            vec2 nb = vUv;
            if (vUv.x < ts.x) nb.x += ts.x;
            else if (vUv.x > 1.0 - ts.x) nb.x -= ts.x;
            if (vUv.y < ts.y) nb.y += ts.y;
            else if (vUv.y > 1.0 - ts.y) nb.y -= ts.y;
            gl_FragColor = texture2D(uPhi, nb);
            return;
          }

          // 红-黑判断（与 FluidSolver.runSORPass 完全一致的 parity 计算）
          vec2 pixel = vUv / ts;
          ivec2 ipixel = ivec2(int(pixel.x), int(pixel.y));
          int parity = (ipixel.x + ipixel.y) & 1;
          if (uIsRed == 1) {
            if (parity == 0) { gl_FragColor = texture2D(uPhi, vUv); return; }
          } else {
            if (parity == 1) { gl_FragColor = texture2D(uPhi, vUv); return; }
          }

          // 邻居 φ
          float pL = texture2D(uPhi, vUv + vec2(-ts.x, 0.0)).r;
          float pR = texture2D(uPhi, vUv + vec2( ts.x, 0.0)).r;
          float pT = texture2D(uPhi, vUv + vec2(0.0,  ts.y)).r;
          float pB = texture2D(uPhi, vUv + vec2(0.0, -ts.y)).r;
          float pC = texture2D(uPhi, vUv).r;

          // 梯度（中心差分，dx=1像素）
          vec2 grad = vec2(pR - pL, pT - pB) * 0.5;
          float gradMag = length(grad);

          // sign(φ)：用当前像素 φ 的符号
          float s = pC > 0.0 ? 1.0 : (pC < 0.0 ? -1.0 : 0.0);

          // 显式 Euler 伪时间演化
          float rhs = s * (1.0 - gradMag);
          float phiNew = pC + uDtPseudo * rhs;

          gl_FragColor = vec4(phiNew, 0.0, 0.0, 1.0);
        }
      `,
    );

    this.gpu.render(this.renderer, phiGrid.write, mat);
    phiGrid.swap();
  }

  // ==================== 3. 表面张力（CSF 模型） ====================

  /**
   * 连续表面力模型（Brackbill 1992）：
   *   F_st = σ · κ · ∇φ
   *   κ ≈ ∇²φ / |∇φ|  （重初始化保证 |∇φ|≈1，近似误差极小）
   *
   * 直接叠加到 velocityGrid.write（与 AdvectionSolver 风格一致）。
   *
   * @param velocityGrid  速度场双缓冲
   * @param phiTex        φ 场纹理
   * @param obstacleTex   障碍物纹理
   * @param sigma         表面张力系数
   * @param dt            时间步长
   * @param smoothingRadius 作用半径（像素，仅 |φ|<radius 区域施力）
   */
  applySurfaceTension(
    velocityGrid: FluidGrid,
    phiTex: THREE.Texture,
    obstacleTex: THREE.Texture,
    sigma: number,
    dt: number,
    smoothingRadius: number,
  ): void {
    const w = velocityGrid.resolution.w;
    const h = velocityGrid.resolution.h;

    const mat = this.gpu.getMaterial('levelset_surface_tension', {
      uVelocity: { value: velocityGrid.read },
      uPhi: { value: phiTex },
      uObstacle: { value: obstacleTex },
      uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
      uSigma: { value: sigma },
      uDt: { value: dt },
      uSmoothingRadius: { value: smoothingRadius },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform sampler2D uPhi;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      uniform float uSigma;
      uniform float uDt;
      uniform float uSmoothingRadius;
      varying vec2 vUv;

      void main() {
        // 墙内速度保持
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        float phi = texture2D(uPhi, vUv).r;

        // 只在表面附近（|φ| < smoothingRadius 像素）施加力
        // 远离表面时 ∇φ≈0，力自然为 0，但显式跳过避免数值噪声
        if (abs(phi) > uSmoothingRadius) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        vec2 ts = uInvRes;
        float pL = texture2D(uPhi, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPhi, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPhi, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPhi, vUv + vec2(0.0, -ts.y)).r;
        float pC = phi;

        // 一阶梯度（中心差分）
        vec2 gradPhi = vec2(pR - pL, pT - pB) * 0.5;
        float gradMag = length(gradPhi) + 1e-6;  // 防 0

        // 二阶导数（5 点 Laplacian，dx=1 故不除 dx²）
        float lapPhi = (pL + pR + pT + pB - 4.0 * pC);

        // 曲率 κ ≈ ∇²φ / |∇φ|
        float kappa = lapPhi / gradMag;

        // CSF 体积力 → 速度增量（ρ=1）
        vec2 force = uSigma * kappa * gradPhi;
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel += force * uDt;

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, velocityGrid.write, mat);
    velocityGrid.swap();
  }

  // ==================== 4. φ 场初始化 ====================

  /**
   * 基于密度场（scalar 模式）或颜色场 alpha（vector 模式）推断初始 SDF。
   *
   *   density > 0.5 → φ < 0（内部）
   *   density < 0.5 → φ > 0（外部）
   *
   * 只是粗略初始化，需配合 reinit 才能得到真正的 SDF。
   *
   * @param phiGrid     φ 场
   * @param sourceTex   源纹理（density 或 colorGrid）
   * @param mode        0=density(R), 1=alpha(A)
   * @param scale       尺度（=smoothingRadius）
   */
  initPhiField(
    phiGrid: FluidGrid,
    sourceTex: THREE.Texture,
    mode: 0 | 1,
    scale: number,
  ): void {
    const mat = this.gpu.getMaterial('levelset_init', {
      uSource: { value: sourceTex },
      uMode: { value: mode },
      uScale: { value: scale },
    }, /* glsl */ `
      uniform sampler2D uSource;
      uniform int uMode;
      uniform float uScale;
      varying vec2 vUv;

      void main() {
        float v = (uMode == 0)
          ? texture2D(uSource, vUv).r
          : texture2D(uSource, vUv).a;
        // 内部 φ<0，外部 φ>0
        float phi = (0.5 - v) * uScale * 2.0;
        gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, phiGrid.write, mat);
    phiGrid.swap();
  }

  // ==================== 资源释放 ====================

  /**
   * GPUOps 持有材质缓存，本类无额外资源。
   * 保留 dispose 接口与 AdvectionSolver 风格一致。
   */
  dispose(): void {
    // 无操作
  }
}
