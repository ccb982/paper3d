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
  /**
   * 可选障碍物纹理（R通道）。
   * 传入时，墙内像素（R>0.5）将跳过注入，直传原值。
   */
  obstacle?: THREE.Texture;
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
  /** 1×1 零纹理（R=0），用于无障碍物时的 dummy 采样 */
  private zeroObstacleTex: THREE.DataTexture | null = null;

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

  // ---- 1. 散度注入（源/汇） ----

  /**
   * 在指定区域注入正/负散度，驱动流体发散或汇聚。
   */
  injectDivergence(
    grid: FluidGrid,
    divergence: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false, obstacle } = options;
    const key = `inj_div_${global ? 'global' : 'local'}_obst`;

    const mat = this.gpu.getMaterial(key, {
      uVelocity: { value: grid.read },
      uDivergence: { value: divergence },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
      uInvRes: { value: new THREE.Vector2(1.0 / grid.resolution.w, 1.0 / grid.resolution.h) },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform float uDivergence;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      varying vec2 vUv;

      void main() {
        // ★ 墙体屏蔽：墙内像素跳过注入，直传原值
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

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

  /**
   * ★ 散度源注入（正确物理）：把散度写入散度源场（divergenceGrid），
   * 作为压力方程源项 ∇²p = ∇·u + f。压力投影后压力梯度推动流体向外
   * （爆炸推力），而非直接改速度场（直接改会被投影反向抵消）。
   * 累积模式：叠加到源场现有值。
   */
  injectDivergenceSource(
    grid: FluidGrid,
    divergence: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false, obstacle } = options;
    const key = `inj_div_source_v1`;

    const mat = this.gpu.getMaterial(key, {
      uSource: { value: grid.read },
      uDivergence: { value: divergence },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
    }, /* glsl */ `
      uniform sampler2D uSource;
      uniform float uDivergence;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform sampler2D uObstacle;
      varying vec2 vUv;

      void main() {
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uSource, vUv);
          return;
        }
        float maskVal = 1.0;
        if (uGlobal == 0) {
          float d = distance(vUv, uPos);
          maskVal = smoothstep(uRadius, 0.0, d);
        }
        if (uHasMask == 1) {
          maskVal *= texture2D(uMask, vUv).r;
        }
        float cur = texture2D(uSource, vUv).r;
        gl_FragColor = vec4(cur + uDivergence * maskVal, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  /**
   * ★ 径向速度注入：圆形区域内沿"远离中心"方向注入速度（爆炸外推/内爆吸引）。
   *
   * 与 injectVelocity（均匀矢量戳）不同，本 pass 的方向是**逐像素径向**的：
   * dir = normalize(uv - center)，真正的向外推力而非单点平移。
   *
   * @param speed 带符号速度幅值（px/s）：正 = 向外推，负 = 向内吸。
   *              调用方负责完成 dt / 包络缩放。
   */
  injectRadialVelocity(
    grid: FluidGrid,
    speed: number,
    options: InjectionOptions = {},
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, obstacle } = options;

    const mat = this.gpu.getMaterial('inj_radial_vel_v1', {
      uVelocity: { value: grid.read },
      uSpeed: { value: speed },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform float uSpeed;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform sampler2D uObstacle;
      varying vec2 vUv;

      void main() {
        // 墙内不注入
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

        vec2 d = vUv - uPos;
        float dist = length(d);
        // 径向方向（中心点退化 → 不加成）
        vec2 dir = (dist > 1e-5) ? d / dist : vec2(0.0);
        float maskVal = smoothstep(uRadius, 0.0, dist);

        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel += dir * (uSpeed * maskVal);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  // ---- 2. 颜色注入（HSLA） ----

  /**
   * 在指定区域注入颜色，向目标 HSLA 值混合。
   *
   * @param channelMask 通道掩码：false 的通道保持原值不注入（冻结）。
   *   默认全 true（所有通道都注入）。从 FluidEditor.config.channels 同步。
   */
  injectColor(
    grid: FluidGrid,
    color: { h: number; s: number; l: number; a: number },
    rate: number,
    options: InjectionOptions = {},
    channelMask: { r: boolean; g: boolean; b: boolean; a: boolean } = { r: true, g: true, b: true, a: true },
  ): void {
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false, obstacle } = options;
    // ★ 新 key 强制重建材质（旧缓存无 uChannelMask uniform）
    const key = `inj_color_v2_${global ? 'global' : 'local'}_obst`;
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
      uChannelMask: { value: new THREE.Vector4(
        channelMask.r ? 1 : 0,
        channelMask.g ? 1 : 0,
        channelMask.b ? 1 : 0,
        channelMask.a ? 1 : 0,
      ) },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
    }, /* glsl */ `
      uniform sampler2D uColor;
      uniform vec4 uTargetColor;
      uniform float uRate;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform vec4 uChannelMask;  // 通道掩码：1=注入, 0=保持原值（冻结）
      uniform sampler2D uObstacle;
      varying vec2 vUv;

      // ★ 色相环形插值：取色相环上最短路径，避免 mix 线性插值跨越色相环边界产生彩虹色。
      float hueLerp(float a, float b, float t) {
        float d = b - a;
        if (d > 0.5) d -= 1.0;
        if (d < -0.5) d += 1.0;
        return fract(a + d * t);
      }

      void main() {
        // ★ 墙体屏蔽：墙内像素跳过注入，直传原值
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uColor, vUv);
          return;
        }

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
        // ★ 通道掩码：false 的通道保持原值（冻结，不注入）
        gl_FragColor = vec4(
          mix(current.r, mixed.r, uChannelMask.r),
          mix(current.g, mixed.g, uChannelMask.g),
          mix(current.b, mixed.b, uChannelMask.b),
          mix(current.a, mixed.a, uChannelMask.a)
        );
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
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false, obstacle } = options;
    const clampedValue = Math.min(1.0, Math.max(0.0, value));
    const clampedRate = Math.min(1.0, Math.max(0.0, rate));

    const mat = this.gpu.getMaterial(`inj_density_${global ? 'global' : 'local'}_obst`, {
      uDensity: { value: grid.read },
      uValue: { value: clampedValue },
      uRate: { value: clampedRate },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
    }, /* glsl */ `
      uniform sampler2D uDensity;
      uniform float uValue;
      uniform float uRate;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform sampler2D uObstacle;
      varying vec2 vUv;

      void main() {
        // ★ 墙体屏蔽：墙内像素跳过注入，直传原值
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uDensity, vUv);
          return;
        }

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
    const { position = { x: 0.5, y: 0.5 }, radius = 0.1, mask, global = false, obstacle } = options;
    const key = `inj_vel_${global ? 'global' : 'local'}_obst`;

    const mat = this.gpu.getMaterial(key, {
      uVelocity: { value: grid.read },
      uVel: { value: new THREE.Vector2(velocity.x, velocity.y) },
      uPos: { value: new THREE.Vector2(position.x, position.y) },
      uRadius: { value: radius },
      uGlobal: { value: global ? 1 : 0 },
      uHasMask: { value: mask ? 1 : 0 },
      uMask: { value: mask || this.getDummyWhiteTex() },
      uObstacle: { value: obstacle || this.getZeroObstacleTex() },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform vec2 uVel;
      uniform vec2 uPos;
      uniform float uRadius;
      uniform int uGlobal;
      uniform int uHasMask;
      uniform sampler2D uMask;
      uniform sampler2D uObstacle;
      varying vec2 vUv;

      void main() {
        // ★ 墙体屏蔽：墙内像素跳过注入，直传原值
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }

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

  // ---- 5. 全局速度缩放（无方向阻尼/加速） ----

  /**
   * 全局速度缩放。
   *
   * 对整个速度场乘以标量系数 scale，不改变方向：
   *   - scale < 1：阻尼（速度扣除），流体减速
   *   - scale > 1：加速（速度增加），流体加速
   *   - scale = 1：无影响
   *
   * @param grid 速度网格
   * @param scale 缩放系数
   */
  scaleVelocity(grid: FluidGrid, scale: number): void {
    if (scale === 1) return;

    const mat = this.gpu.getMaterial('scaleVelocity', {
      uVelocity: { value: grid.read },
      uScale: { value: scale },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform float uScale;
      varying vec2 vUv;

      void main() {
        vec2 vel = texture2D(uVelocity, vUv).rg;
        gl_FragColor = vec4(vel * uScale, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, grid.write, mat);
    grid.swap();
  }

  dispose(): void {
    this.dummyWhiteTex?.dispose();
    this.dummyWhiteTex = null;
    this.zeroObstacleTex?.dispose();
    this.zeroObstacleTex = null;
  }
}
