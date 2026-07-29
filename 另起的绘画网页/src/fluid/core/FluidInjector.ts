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
        vec4 mixed = mix(current, uTargetColor, uRate * maskVal);
        gl_FragColor = mixed;
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 3. 速度注入 ----

  /**
   * 在指定区域注入速度矢量。
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

  dispose(): void {
    this.dummyWhiteTex?.dispose();
    this.dummyWhiteTex = null;
  }
}
