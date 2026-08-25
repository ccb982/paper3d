import * as THREE from 'three';
import type { FluidGrid } from '../core/FluidGrid';
import { GPUOps } from '../core/GPUOps';

// ============================================================
// LevelSetSolver —— Level Set 方法独立模块
// ============================================================
//
// 设计原则：热插拔、零侵入、懒加载
//   - 本类不持有纹理资源（phiGrid 由 FluidSolver 管理，作为参数传入；
//     φ₀ 快照纹理为本类私有懒加载资源，reinit 时创建，dispose 释放）
//   - 仅负责 GPU Pass 编排，复用 GPUOps 的全屏渲染基础设施
//   - 着色器通过 gpu.getMaterial(key, uniforms, fragShader) 缓存，避免重复编译
//
// 三大功能：
//   1. advectPhi       —— Level Set 平流（半拉格朗日，复用 AdvectionSolver 风格）
//   2. reinit          —— ★ Godunov 上风格式重初始化（求解 ∂φ/∂τ = sign(φ₀)·(1-|∇φ|)）
//      （原中心差分不收敛/界面漂移；Godunov 上风 + φ₀ 快照才是标准做法）
//   3. applySurfaceTension —— 表面张力注入（CSF 模型，F_st = σ·κ·δ(φ)·n̂）
//   4. applyLiquidConstraint —— φ 直接约束液体（外部渐隐 → 液体紧凑圆润）
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
  /** φ₀ 快照纹理（reinit 符号基准，懒加载） */
  private phi0Tex: THREE.WebGLRenderTarget | null = null;

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

  // ==================== 2. 重初始化（Godunov 上风格式） ====================

  /**
   * ★ 重初始化：求解 ∂φ/∂τ = sign(φ₀)·(1-|∇φ|)，使 φ 成为带符号距离场（|∇φ|≈1）。
   *
   * 方案要点（修复原中心差分不收敛/界面漂移问题）：
   *   1. φ₀ 快照：迭代前复制当前 φ 到快照纹理，整个迭代过程符号固定（sign(φ₀)），
   *      防止符号在迭代中翻转导致界面漂移。
   *   2. Godunov 上风格式：|∇φ| 用「上风差分」离散（沿特征方向取一侧差分），
   *      距离信息从界面向外正确传播；中心差分在界面两侧对称 → 梯度≈0 → 传不出去。
   *   3. 显式 Euler 伪时间演化，dt_pseudo=0.5 满足 CFL（dt ≤ dx，dx=1 像素）。
   *
   * 注意：φ 场与注入同步在调用方（FluidEditor.step）负责——每 reinitInterval 帧
   *       先用当前 density/alpha 场重建 φ 初值（initPhiField）再 reinit，
   *       新注入的液体才会长出表面。
   */
  reinit(
    phiGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    iterations: number,
    dtPseudo: number = 0.5,
  ): void {
    // ① φ₀ 快照（复制当前 φ → phi0Tex）
    const snap = this.ensurePhi0Tex(phiGrid.resolution.w, phiGrid.resolution.h);
    const copyMat = this.gpu.getMaterial('levelset_copy_phi', {}, /* glsl */ `
      uniform sampler2D uPhi;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(uPhi, vUv);
      }
    `);
    copyMat.uniforms.uPhi = { value: phiGrid.read };
    this.gpu.render(this.renderer, snap, copyMat);

    for (let i = 0; i < iterations; i++) {
      this.runReinitPass(phiGrid, obstacleTex, true, dtPseudo);   // red
      this.runReinitPass(phiGrid, obstacleTex, false, dtPseudo);  // black
    }
  }

  private ensurePhi0Tex(w: number, h: number): THREE.WebGLRenderTarget {
    if (!this.phi0Tex || this.phi0Tex.width !== w || this.phi0Tex.height !== h) {
      this.phi0Tex?.dispose();
      this.phi0Tex = new THREE.WebGLRenderTarget(w, h, {
        format: THREE.RedFormat,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    return this.phi0Tex;
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
      `levelset_reinit_godunov_${isRed ? 'r' : 'b'}`,
      {
        uPhi: { value: phiGrid.read },
        uPhi0: { value: this.phi0Tex!.texture },
        uObstacle: { value: obstacleTex },
        uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
        uIsRed: { value: isRed ? 1 : 0 },
        uDtPseudo: { value: dtPseudo },
      },
      /* glsl */ `
        uniform sampler2D uPhi;
        uniform sampler2D uPhi0;
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

          // 邻居 φ（中心点 + 四邻）
          float pL = texture2D(uPhi, vUv + vec2(-ts.x, 0.0)).r;
          float pR = texture2D(uPhi, vUv + vec2( ts.x, 0.0)).r;
          float pT = texture2D(uPhi, vUv + vec2(0.0,  ts.y)).r;
          float pB = texture2D(uPhi, vUv + vec2(0.0, -ts.y)).r;
          float pC = texture2D(uPhi, vUv).r;

          // ★ sign(φ₀)：用快照（迭代全程固定，界面不漂移）
          float phi0 = texture2D(uPhi0, vUv).r;
          float s = phi0 > 0.0 ? 1.0 : (phi0 < 0.0 ? -1.0 : 0.0);

          // ★ Godunov 上风格式（一阶）：
          //   前向/后向差分（dx=1 像素）
          float Dmx = pC - pL;   // D⁻x
          float Dpx = pR - pC;   // D⁺x
          float Dmy = pC - pB;   // D⁻y
          float Dpy = pT - pC;   // D⁺y
          // 上风选取：|∇φ|² = Σ max(max(D⁻,0)², min(D⁺,0)²)（特征沿 φ 增大方向）
          float gx = max(max(Dmx, 0.0) * max(Dmx, 0.0), min(Dpx, 0.0) * min(Dpx, 0.0));
          float gy = max(max(Dmy, 0.0) * max(Dmy, 0.0), min(Dpy, 0.0) * min(Dpy, 0.0));
          float gradMag = sqrt(gx + gy);

          // 显式 Euler 伪时间演化
          float phiNew = pC - uDtPseudo * s * (gradMag - 1.0);

          gl_FragColor = vec4(phiNew, 0.0, 0.0, 1.0);
        }
      `,
    );

    this.gpu.render(this.renderer, phiGrid.write, mat);
    phiGrid.swap();
  }

  // ==================== 3. 表面张力（CSF 模型） ====================

  /**
   * ★ 连续表面力模型（Brackbill 1992）：
   *   F_st = σ · κ · δ(φ) · n̂
   *   n̂ = ∇φ/|∇φ|（界面法线），κ ≈ ∇²φ/|∇φ|（曲率）
   *   δ(φ) = (1/2ε)(1+cos(πφ/ε)) —— ★ 平滑 Dirac 窄带归一化：
   *     界面薄层内积分为 1，力集中在表面而非整条窄带均匀乱施
   *     （修复原实现无 δ 归一化 → 力在带宽内均匀分布、σ 无法调出表面感）
   *
   * 直接叠加到 velocityGrid.write（与 AdvectionSolver 风格一致）。
   *
   * @param velocityGrid  速度场双缓冲
   * @param phiTex        φ 场纹理
   * @param obstacleTex   障碍物纹理
   * @param sigma         表面张力系数
   * @param dt            时间步长
   * @param smoothingRadius 窄带半宽（像素，δ 的 ε；仅 |φ|<ε 区域施力）
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

    const mat = this.gpu.getMaterial('levelset_surface_tension_v2', {
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

      // 平滑 Dirac δ(φ)：|φ|<ε 内为余弦波，积分为 1（CSF 归一化）
      float smoothDelta(float phi, float eps) {
        float p = clamp(phi / eps, -1.0, 1.0);
        return (1.0 / (2.0 * eps)) * (1.0 + cos(3.14159265 * p));
      }

      void main() {
        // 墙内速度保持
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        float phi = texture2D(uPhi, vUv).r;

        // 只在表面窄带内施力（|φ| < ε）
        if (abs(phi) > uSmoothingRadius) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        vec2 ts = uInvRes;
        // ★ 差分间距取 1.5px（而非 1px）：宽距差分低通掉单像素级 φ 噪声，
        //   否则 κ 在噪声下正负乱跳，张力变成界面乱流发生器。
        //   公式做归一化：grad=Δφ/(2d)、lap=Σ/d² → κ 为真实曲率 1/R（与间距无关）
        vec2 d2 = ts * 1.5;
        float pL = texture2D(uPhi, vUv - vec2(d2.x, 0.0)).r;
        float pR = texture2D(uPhi, vUv + vec2(d2.x, 0.0)).r;
        float pT = texture2D(uPhi, vUv + vec2(0.0, d2.y)).r;
        float pB = texture2D(uPhi, vUv - vec2(0.0, d2.y)).r;
        float pC = phi;

        // 一阶梯度（中心差分，间距 d）
        vec2 gradPhi = vec2(pR - pL, pT - pB) / (2.0 * d2.x);
        float gradMag = length(gradPhi) + 1e-6;  // 防 0

        // 二阶导数（5 点 Laplacian，除以 d² 归一化）
        float lapPhi = (pL + pR + pT + pB - 4.0 * pC) / (d2.x * d2.y);

        // 曲率 κ = ∇²φ / |∇φ|（凸液面为正）
        float kappa = lapPhi / gradMag;

        // ★ CSF 体积力：F = -σ·κ·δ(φ)·n̂
        //   符号修正（Brackbill 正确方向）：本求解器约定 φ<0 为水、n̂ 指向空气侧，
        //   凸液面 κ≈+1/R>0 → 不取负号时力朝外，会把水滴推散成烟雾；
        //   取负后力指向曲率中心，水团才向内收缩（旧版丢负号导致 σ 越大越喷）。
        vec2 normal = gradPhi / gradMag;
        float delta = smoothDelta(phi, uSmoothingRadius);
        vec2 force = -uSigma * kappa * delta * normal;
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel += force * uDt;

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, velocityGrid.write, mat);
    velocityGrid.swap();
  }

  // ==================== 3.5 外向速度抑制（确定性收拢） ====================

  /**
   * ★ 界面窄带内削减指向外侧（空气）的法向速度。
   *
   *   v ← v − strength · max(v·n̂, 0) · n̂ ，n̂ = ∇φ/|∇φ|（指向空气）
   *
   * 与表面张力不同，这是**确定性**的收拢保证：
   *   - 不依赖 κ 的符号/精度 → φ 噪声、σ 正负都影响不到它
   *   - strength=1 → 界面完全不可外扩；0.5 → 外速削半；0 = 关闭
   *   - 只作用于 |φ|<band 窄带 → 内部环流保留
   */
  applyOutwardVelDamping(
    velocityGrid: FluidGrid,
    phiTex: THREE.Texture,
    obstacleTex: THREE.Texture,
    band: number,
    strength: number,
  ): void {
    if (strength <= 0) return;
    const w = velocityGrid.resolution.w;
    const h = velocityGrid.resolution.h;

    const mat = this.gpu.getMaterial('levelset_outward_damping_v1', {
      uVelocity: { value: velocityGrid.read },
      uPhi: { value: phiTex },
      uObstacle: { value: obstacleTex },
      uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
      uBand: { value: band },
      uStrength: { value: Math.min(1, strength) },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform sampler2D uPhi;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      uniform float uBand;
      uniform float uStrength;
      varying vec2 vUv;

      void main() {
        // 墙内速度保持
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        float phi = texture2D(uPhi, vUv).r;
        // 只在界面窄带内起作用
        if (abs(phi) > uBand) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        vec2 ts = uInvRes;
        float pL = texture2D(uPhi, vUv - vec2(ts.x, 0.0)).r;
        float pR = texture2D(uPhi, vUv + vec2(ts.x, 0.0)).r;
        float pT = texture2D(uPhi, vUv + vec2(0.0, ts.y)).r;
        float pB = texture2D(uPhi, vUv - vec2(0.0, ts.y)).r;

        // 法线（指向空气侧），退化时跳过
        vec2 n = vec2(pR - pL, pT - pB);
        float len = length(n);
        vec2 vel = texture2D(uVelocity, vUv).rg;
        if (len < 1e-6) {
          gl_FragColor = vec4(vel, 0.0, 1.0);
          return;
        }
        n /= len;

        float vn = dot(vel, n);          // 外法向速度分量
        if (vn > 0.0) vel -= n * vn * uStrength;   // 只削外向部分

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, velocityGrid.write, mat);
    velocityGrid.swap();
  }

  // ==================== 4. φ 直接约束液体 ====================

  /**
   * ★ 液体约束：用 φ 直接约束密度（scalar）或颜色 alpha（vector）。
   *   φ<0（液体内部）→ 保持原值；
   *   φ 从 0 过渡到 band（外部）→ 平滑渐隐到 fadeTo。
   *   效果：液体被 φ 收拢成紧凑圆润的团块，不再糊成一片。
   *
   * @param targetGrid  密度场（scalar 模式）或颜色场（vector 模式），双缓冲
   * @param phiTex      φ 场纹理
   * @param obstacleTex 障碍物纹理
   * @param mode        0 = density.R，1 = color.A
   * @param band        过渡带宽度（像素；φ>band 完全渐隐）
   * @param fadeTo      外部渐隐目标值（0=完全消失，建议 0~0.05）
   */
  applyLiquidConstraint(
    targetGrid: FluidGrid,
    phiTex: THREE.Texture,
    obstacleTex: THREE.Texture,
    mode: 0 | 1,
    band: number,
    fadeTo: number,
  ): void {
    const w = targetGrid.resolution.w;
    const h = targetGrid.resolution.h;

    const mat = this.gpu.getMaterial('levelset_liquid_constraint_v2', {
      uTarget: { value: targetGrid.read },
      uPhi: { value: phiTex },
      uObstacle: { value: obstacleTex },
      uBand: { value: band },
      uFadeTo: { value: fadeTo },
      uMode: { value: mode },
    }, /* glsl */ `
      uniform sampler2D uTarget;
      uniform sampler2D uPhi;
      uniform sampler2D uObstacle;
      uniform float uBand;
      uniform float uFadeTo;
      uniform int uMode;
      varying vec2 vUv;

      void main() {
        // 墙内保持原值
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uTarget, vUv);
          return;
        }

        vec4 cur = texture2D(uTarget, vUv);
        float phi = texture2D(uPhi, vUv).r;
        float v = (uMode == 0) ? cur.r : cur.a;

        // ★ 外部渐隐：φ<0（内部）保持；0→band 平滑过渡；>band 渐隐到 fadeTo
        float keep = 1.0 - smoothstep(0.0, uBand, phi);
        v = mix(v, uFadeTo, 1.0 - keep);

        if (uMode == 0) cur.r = v; else cur.a = v;
        gl_FragColor = cur;
      }
    `);

    this.gpu.render(this.renderer, targetGrid.write, mat);
    targetGrid.swap();
  }

  // ==================== 5. φ 场后处理修正（空气钳制 + 水体补偿） ====================

  /**
   * ★ φ 场后处理（老版本 FluidSimulator 的关键水感机制）：
   *   1. clampAirPhi      —— 空气区（φ>0）上限钳制：把空气区 φ 压回 maxAirPhi，
   *      防止空气"漏"进水体 / φ 场在空气侧漂移污染界面
   *   2. compensateWaterPhi —— 水体区（φ<0）负向补偿：每帧向负方向推 rate 像素，
   *      防止水体流失（平流/重初始化中 φ 逐渐被磨平、水越来越少）
   *
   * 与 initPhiField + reinit 配合使用：reinit 保持 |∇φ|≈1（SDF），
   * 后处理修正 φ 场的"符号平衡"——水不泄漏、不流失。
   *
   * @param phiGrid      φ 场双缓冲
   * @param obstacleTex  障碍物纹理
   * @param clampAir     是否启用空气钳制
   * @param maxAirPhi    空气区 φ 上限（0 = 空气区压到 0）
   * @param compensateWater 是否启用水体补偿
   * @param compRate     补偿速率（每帧向负方向推进的像素数，默认 0.1）
   */
  applyPhiCorrection(
    phiGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    clampAir: boolean,
    maxAirPhi: number,
    compensateWater: boolean,
    compRate: number,
  ): void {
    const mat = this.gpu.getMaterial('levelset_phi_correction_v1', {
      uPhi: { value: phiGrid.read },
      uObstacle: { value: obstacleTex },
      uClampAir: { value: clampAir ? 1 : 0 },
      uMaxAirPhi: { value: maxAirPhi },
      uCompensate: { value: compensateWater ? 1 : 0 },
      uCompRate: { value: compRate },
    }, /* glsl */ `
      uniform sampler2D uPhi;
      uniform sampler2D uObstacle;
      uniform int uClampAir;
      uniform float uMaxAirPhi;
      uniform int uCompensate;
      uniform float uCompRate;
      varying vec2 vUv;

      void main() {
        // 墙内 φ=0
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        float phi = texture2D(uPhi, vUv).r;

        // ① 空气区钳制：正 φ 上限压回（空气不泄漏进水）
        if (uClampAir == 1 && phi > uMaxAirPhi) {
          phi = uMaxAirPhi;
        }

        // ② 水体补偿：负 φ 向负方向推进（水不流失）
        if (uCompensate == 1 && phi < 0.0) {
          phi -= uCompRate;
        }

        gl_FragColor = vec4(phi, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, phiGrid.write, mat);
    phiGrid.swap();
  }

  // ==================== 6. φ 场初始化 ====================

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
    this.phi0Tex?.dispose();
    this.phi0Tex = null;
  }
}
