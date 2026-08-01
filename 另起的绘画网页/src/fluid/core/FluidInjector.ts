import * as THREE from 'three';
import type { FluidGrid } from './FluidGrid';
import { GPUOps } from './GPUOps';

// ============================================================
// 类型定义
// ============================================================

export interface InjectionOptions {
  /** 归一化位置 (0~1)，纹理坐标系（左下原点） */
  position?: { x: number; y: number };
  /** 归一化半径 */
  radius?: number;
  /** 可选外部掩码纹理（覆盖 position/radius） */
  mask?: THREE.Texture;
  /** 如果为 true，忽略 position/radius，作用于全场 */
  global?: boolean;
}

// ============================================================
// FluidInjector —— 底层注入器（第1层）
// ============================================================

/**
 * 底层注入器 —— 唯一直接修改 FluidGrid 的接口。
 *
 * 提供三个原子操作，是整个系统中唯一写入物理场的入口：
 *   1. injectDivergence —— 散度注入（源/汇）
 *   2. injectColor      —— 颜色注入（HSLA）
 *   3. injectVelocity   —— 速度注入
 *
 * 约束：任何代码不得绕过 FluidInjector 直接调用 gpu.render 或操作 write 目标。
 *       所有物理场修改必须通过这三个函数之一完成。
 */
export class FluidInjector {
  private renderer: THREE.WebGLRenderer;
  private gpu: GPUOps;
  /** 1×1 白色哑纹理，用于无 mask 时占位 sampler */
  private dummyWhiteTex: THREE.DataTexture | null = null;

  constructor(renderer: THREE.WebGLRenderer, gpu: GPUOps) {
    this.renderer = renderer;
    this.gpu = gpu;
  }

  private getDummyWhiteTex(): THREE.Texture {
    if (!this.dummyWhiteTex) {
      this.dummyWhiteTex = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1, 1, THREE.RGBAFormat, THREE.UnsignedByteType,
      );
      this.dummyWhiteTex.needsUpdate = true;
    }
    return this.dummyWhiteTex;
  }

  // ---- 1. 散度注入（源/汇） ----

  /**
   * 在指定区域注入正/负散度，驱动流体发散或汇聚。
   */
  injectDivergence(
    grid: FluidGrid,
    divergence: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false } = options;
    const key = `inj_div_${global ? 'global' : 'local'}`;

    const mat = this.gpu.getMaterial(key, {
      uVelocity: { value: grid.read },
      uDivergence: { value: divergence },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
      uInvRes: { value: new THREE.Vector2(1.0 / grid.resolution.w, 1.0 / grid.resolution.h) },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform float uDivergence;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform vec2 uInvRes;
      varying vec2 vUv;

      void main() {
        float maskVal = 1.0;
        if (uGlobal == 0) {
          float d = distance(vUv, uPos);
          maskVal = smoothstep(uRadius, 0.0, d);
        }
        if (uHasMask == 1) {
          maskVal *= texture2D(uMask, vUv).r;
        }

        vec2 vel = texture2D(uVelocity, vUv).rg;
        vec2 dir = vUv - uPos;
        float len = length(dir);
        if (len > 0.0) {
          vec2 radial = dir / len;
          float delta = uDivergence * maskVal * uInvRes.x;
          vel += radial * delta;
        }

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 2. 颜色注入（HSLA） ----

  /**
   * 在指定区域注入颜色，向目标 HSLA 值混合。
   */
  injectColor(
    grid: FluidGrid,
    color: { h: number; s: number; l: number; a: number },
    rate: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false } = options;
    const key = `inj_color_${global ? 'global' : 'local'}`;
    const clampedRate = Math.min(1.0, Math.max(0.0, rate));

    const mat = this.gpu.getMaterial(key, {
      uColor: { value: grid.read },
      uTargetColor: { value: new THREE.Vector4(color.h, color.s, color.l, color.a) },
      uRate: { value: clampedRate },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
    }, /* glsl */ `
      uniform sampler2D uColor;
      uniform vec4 uTargetColor;
      uniform float uRate;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      varying vec2 vUv;

      // ★ 色相环形插值：取色相环上最短路径，避免 mix 线性插值跨越色相环边界产生彩虹色。
      //   例：current.H=0.95(品红) → target.H=0.05(红)，线性 mix 会经过 0.5(青)，
      //       环形插值走 0.0/1.0 边界，过渡自然。
      //   ⚠️ 仅适用于 R 通道语义为色相 H 的颜色场；速度场 R=vx 绝不可用。
      float hueLerp(float a, float b, float t) {
        float d = b - a;
        if (d > 0.5) d -= 1.0;
        if (d < -0.5) d += 1.0;
        return fract(a + d * t);
      }

      void main() {
        float maskVal = 1.0;
        if (uGlobal == 0) {
          float d = distance(vUv, uPos);
          maskVal = smoothstep(uRadius, 0.0, d);
        }
        if (uHasMask == 1) {
          maskVal *= texture2D(uMask, vUv).r;
        }

        vec4 current = texture2D(uColor, vUv);
        float rate = uRate * maskVal;
        // ★ H 通道用色相环形插值，S/L/A 保持线性
        vec4 mixed;
        mixed.r = hueLerp(current.r, uTargetColor.r, rate);
        mixed.g = mix(current.g, uTargetColor.g, rate);
        mixed.b = mix(current.b, uTargetColor.b, rate);
        mixed.a = mix(current.a, uTargetColor.a, rate);
        gl_FragColor = mixed;
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 2.5. 纹理注入（残差印章） ----

  /**
   * 将一张颜色纹理通过掩码混合注入到颜色场中。
   * 用于"残差印章"模式：从 FTX 原始残差纹理采样生成的 colorTex，
   * 按 maskTex 指定的区域（白色=注入），以 rate 为混合率写入颜色场。
   *
   * @param grid 颜色网格
   * @param colorTex 要注入的颜色纹理（RGBA, uint8）
   * @param maskTex 掩码纹理（R通道：0=不注入，255=完全注入）
   * @param rate 混合率 [0,1]，1=完全覆盖，0=不注入
   */
  injectColorTexture(
    grid: FluidGrid,
    colorTex: THREE.Texture,
    maskTex: THREE.Texture,
    rate: number,
  ): void {
    const clampedRate = Math.min(1.0, Math.max(0.0, rate));

    const mat = this.gpu.getMaterial('inj_color_texture', {
      uColor: { value: grid.read },
      uColorTex: { value: colorTex },
      uMaskTex: { value: maskTex },
      uRate: { value: clampedRate },
    }, /* glsl */ `
      uniform sampler2D uColor;
      uniform sampler2D uColorTex;
      uniform sampler2D uMaskTex;
      uniform float uRate;
      varying vec2 vUv;

      void main() {
        float maskVal = texture2D(uMaskTex, vUv).r;
        vec4 current = texture2D(uColor, vUv);
        vec4 injected = texture2D(uColorTex, vUv);
        vec4 mixed = mix(current, injected, uRate * maskVal);
        gl_FragColor = mixed;
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 2.6. density 注入（MCSDA 标量浓度模式专用） ----

  /**
   * 在指定区域注入 density 浓度值。
   *
   * MCSDA 方案：scalar 模式下，摇杆/注入源同时注入 density（被速度场推动流动），
   * 合成时 density × 通道系数 调制残差强度。
   *
   * 着色器只写 R 通道（densityGrid 是单通道 RedFormat）：
   *   gl_FragColor.r = mix(current.r, value, rate × maskVal)
   *
   * @param grid density 网格（1 通道 Uint8）
   * @param value 目标浓度值 [0,1]
   * @param rate 混合率 [0,1]
   * @param options 注入选项（位置、半径、掩码）
   */
  injectDensity(
    grid: FluidGrid,
    value: number,
    rate: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false } = options;
    const clampedValue = Math.min(1.0, Math.max(0.0, value));
    const clampedRate = Math.min(1.0, Math.max(0.0, rate));

    const mat = this.gpu.getMaterial(`inj_density_${global ? 'global' : 'local'}`, {
      uDensity: { value: grid.read },
      uValue: { value: clampedValue },
      uRate: { value: clampedRate },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
    }, /* glsl */ `
      uniform sampler2D uDensity;
      uniform float uValue;
      uniform float uRate;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      varying vec2 vUv;

      void main() {
        float maskVal = 1.0;
        if (uGlobal == 0) {
          float d = distance(vUv, uPos);
          maskVal = smoothstep(uRadius, 0.0, d);
        }
        if (uHasMask == 1) {
          maskVal *= texture2D(uMask, vUv).r;
        }

        float current = texture2D(uDensity, vUv).r;
        float mixed = mix(current, uValue, uRate * maskVal);
        gl_FragColor = vec4(mixed, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();

    // ★ 诊断：前 5 次注入回读中心点，确认 density 真正写入（排查合成空白）
    if ((FluidInjector as any)._densityDiagCount === undefined) {
      (FluidInjector as any)._densityDiagCount = 0;
    }
    if ((FluidInjector as any)._densityDiagCount < 5) {
      (FluidInjector as any)._densityDiagCount++;
      const { w, h } = grid.resolution;
      const cx = Math.max(0, Math.min(w - 1, Math.floor(position.x * w)));
      const cy = Math.max(0, Math.min(h - 1, Math.floor(position.y * h)));
      const buf = new Uint8Array(4);
      const prevRT = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(grid.readTarget);
      this.renderer.readRenderTargetPixels(grid.readTarget, cx, cy, 1, 1, buf);
      this.renderer.setRenderTarget(prevRT);
      console.log(`[diag] inj_density readback @(${cx},${cy}): density=${buf[0]}/255, value=${clampedValue}, rate=${clampedRate}`);
    }
  }

  /**
   * 在指定区域注入速度矢量。
   *
   * ⚠️ 参数语义（重要）：
   *   velocity 的单位是 像素/秒（px/s），表示速度值。
   *   着色器中直接执行 current += uVel，即每帧将 velocity 直接叠加到速度场。
   *
   * ⚠️ 物理一致性说明：
   *   - 对于"持续注入源"（水龙头效果），调用方应直接传入完整的速度值（px/s），
   *     不乘以 dt，确保注入的速度足够大，能够与重力抗衡。
   *   - 对于"重力"等加速度场，调用方应传入 gravity * dt（加速度×时间=速度增量），
   *     因为重力是持续的加速度，每帧只应增加一个时间步长对应的速度增量。
   *   - 对于"一次性注入/瞬时冲量"，调用方直接传入瞬时速度增量即可，无需乘 dt。
   *
   * @param grid 速度网格
   * @param velocity 注入的速度矢量（px/s），直接叠加到速度场
   * @param options 注入选项（位置、半径、掩码等）
   */
  injectVelocity(
    grid: FluidGrid,
    velocity: { x: number; y: number },
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false } = options;
    const key = `inj_vel_${global ? 'global' : 'local'}`;

    const mat = this.gpu.getMaterial(key, {
      uVelocity: { value: grid.read },
      uVel: { value: new THREE.Vector2(velocity.x, velocity.y) },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform vec2 uVel;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      varying vec2 vUv;

      void main() {
        float maskVal = 1.0;
        if (uGlobal == 0) {
          float d = distance(vUv, uPos);
          maskVal = smoothstep(uRadius, 0.0, d);
        }
        if (uHasMask == 1) {
          maskVal *= texture2D(uMask, vUv).r;
        }

        vec2 current = texture2D(uVelocity, vUv).rg;
        vec2 added = uVel * maskVal;
        gl_FragColor = vec4(current + added, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 4. 速度限幅（防止速度爆炸） ----

  /**
   * 全局速度限幅。
   *
   * 遍历速度场，将所有速度矢量的长度限制在 maxSpeed 以内。
   * 用于防止持续注入、压力投影误差累积等导致的速度爆炸。
   *
   * @param grid 速度网格
   * @param maxSpeed 最大速度（px/s），默认 5000
   */
  clampVelocity(grid: FluidGrid, maxSpeed: number = 5000): void {
    if (!isFinite(maxSpeed) || maxSpeed <= 0) return;

    const mat = this.gpu.getMaterial('clampVelocity', {
      uVelocity: { value: grid.read },
      uMaxSpeed: { value: maxSpeed },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform float uMaxSpeed;
      varying vec2 vUv;

      void main() {
        vec2 vel = texture2D(uVelocity, vUv).rg;
        float len = length(vel);
        if (len > uMaxSpeed) {
          vel = vel / len * uMaxSpeed;
        }
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  dispose(): void {
    this.dummyWhiteTex?.dispose();
    this.dummyWhiteTex = null;
  }
}
